//! 助手文件库：zip 导入的落地处。
//!
//! ── 为什么需要它（与 `assistant_images` 的区别）────────────────
//! `assistant_images` 解决的是"图片字节不进上下文"；这里解决的是**体量**：
//! 操作者会丢进来上百个文件、上百 MB 的 zip。这类东西**不能内联进消息**
//! （前端 `MAX_TEXT_FILES = 3` / `MAX_TEXT_FILE_BYTES = 512 KiB` 那套上限
//! 是内联通路的必然边界，不是随便定的）。所以：
//!
//!   zip 上传 → 网关侧解包 → **逐条入库** → 助手按需**分页**读取
//!
//! 消息历史里只留文件 ID，字节全在库里；读取用 SQLite 的 `substr(bytes, …)`
//! **在库内切片**，一次只把请求的那一段带回内存 —— 于是"峰值内存不随包体
//! 增长"，这是能在手机上处理 100 MB 包的关键。
//!
//! ── 与 `assistant_images` 同构的部分（刻意照抄，别自创）──────────
//! `OnceLock<Option<Db>>` + `install/database/available` 三件套、
//! `Db::with` / `with_mut`、32 字节随机 → 64 位 hex ID、`logging::now_ms()`、
//! `GatewayError::new` / `with_status`、以及"总量上限 + 507"的语义。
//! 两个库的表都集中在 `db/schema.rs` 的版本化 DDL 里建（v30），
//! 不在本文件里写 `CREATE TABLE`。

use std::sync::OnceLock;

use rusqlite::{params, OptionalExtension};

use crate::server::db::Db;
use crate::server::errors::GatewayError;
use crate::server::logging;

static DB: OnceLock<Option<Db>> = OnceLock::new();

/// 文件库总量上限。比图片库（512 MiB）大得多：这里的用途就是装大包。
const MAX_STORAGE_BYTES: i64 = 2 * 1024 * 1024 * 1024;

/// 单次分页读取的上限。助手侧一次读不完就多读几页 —— 上限存在的意义是
/// **不让一次工具调用把上百 MB 拉进上下文**，而不是限制文件本身的大小。
pub const MAX_READ_BYTES: i64 = 256 * 1024;

pub fn install(db: Option<Db>) {
    let _ = DB.set(db);
}

fn database() -> Result<&'static Db, GatewayError> {
    DB.get()
        .and_then(Option::as_ref)
        .ok_or_else(|| GatewayError::with_status(503, "助手文件库不可用"))
}

/// 可用性：库能读、且没到总量上限。
pub fn available() -> Result<(), GatewayError> {
    let used = database()?
        .with(|conn| {
            conn.query_row(
                "SELECT COALESCE(SUM(length(bytes)), 0) FROM assistant_files",
                [],
                |row| row.get::<_, i64>(0),
            )
        })
        .ok_or_else(|| GatewayError::with_status(503, "助手文件库数据库不可用"))?
        .map_err(|_| GatewayError::with_status(503, "助手文件库无法读取"))?;
    if used >= MAX_STORAGE_BYTES {
        return Err(GatewayError::with_status(
            507,
            "助手文件库已满（上限 2 GiB），请先删除不再需要的导入",
        ));
    }
    Ok(())
}

/// 库内一个文件的元信息（不含字节）。
#[derive(Clone, serde::Serialize)]
pub struct FileMeta {
    pub id: String,
    pub name: String,
    pub mime: String,
    pub size: i64,
    pub created_at: i64,
}

fn random_id() -> Result<String, GatewayError> {
    let mut random = [0u8; 32];
    getrandom::getrandom(&mut random).map_err(|_| GatewayError::new("无法生成助手文件 ID"))?;
    Ok(random.iter().map(|byte| format!("{byte:02x}")).collect())
}

/// 把解包出来的条目**逐条入库**，返回各自的 ID（顺序与入参一致）。
///
/// 入参已经是"一条一条"的形态：调用方（`api::assistant_files::upload`）是
/// 从临时文件里的 `ZipArchive` 逐条读出来喂进来的，所以这里**不会**同时持有
/// 整个包的字节。整批走一个事务：要么全进，要么全不进。
pub fn store_unpacked(
    session: &str,
    entries: Vec<(String, String, Vec<u8>)>,
) -> Result<Vec<String>, GatewayError> {
    let mut prepared = Vec::with_capacity(entries.len());
    for (name, mime, bytes) in entries {
        prepared.push((random_id()?, name, mime, bytes));
    }
    let ids: Vec<String> = prepared.iter().map(|(id, ..)| id.clone()).collect();
    database()?
        .with_mut(|conn| -> Result<(), GatewayError> {
            let tx = conn
                .transaction()
                .map_err(|_| GatewayError::new("无法保存助手文件"))?;
            let used: i64 = tx
                .query_row(
                    "SELECT COALESCE(SUM(length(bytes)), 0) FROM assistant_files",
                    [],
                    |row| row.get(0),
                )
                .map_err(|_| GatewayError::new("无法读取助手文件库用量"))?;
            let added: i64 = prepared.iter().map(|(_, _, _, bytes)| bytes.len() as i64).sum();
            if used.saturating_add(added) > MAX_STORAGE_BYTES {
                return Err(GatewayError::with_status(
                    507,
                    "助手文件库已满（上限 2 GiB），本次导入未保存，请先删除不再需要的导入",
                ));
            }
            for (id, name, mime, bytes) in &prepared {
                tx.execute(
                    "INSERT INTO assistant_files (id, session_id, name, mime, bytes, created_at) \
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    params![id, session, name, mime, bytes, logging::now_ms()],
                )
                .map_err(|_| GatewayError::new("助手文件保存失败，请勿自动重发"))?;
            }
            tx.commit()
                .map_err(|_| GatewayError::new("助手文件保存失败，请勿自动重发"))
        })
        .ok_or_else(|| GatewayError::with_status(503, "助手文件库数据库不可用"))??;
    Ok(ids)
}

/// 列出某个会话导入的全部文件（**不含字节**：列表接口不该把 100 MB 拉出来）。
pub fn list(session: &str) -> Result<Vec<FileMeta>, GatewayError> {
    database()?
        .with(|conn| -> Result<Vec<FileMeta>, GatewayError> {
            let mut stmt = conn
                .prepare(
                    "SELECT id, name, mime, length(bytes), created_at FROM assistant_files \
                     WHERE session_id = ?1 ORDER BY created_at, id",
                )
                .map_err(|_| GatewayError::with_status(500, "助手文件列表读取失败"))?;
            let rows = stmt
                .query_map(params![session], |row| {
                    Ok(FileMeta {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        mime: row.get(2)?,
                        size: row.get(3)?,
                        created_at: row.get(4)?,
                    })
                })
                .map_err(|_| GatewayError::with_status(500, "助手文件列表读取失败"))?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|_| GatewayError::with_status(500, "助手文件列表读取失败"))?;
            Ok(rows)
        })
        .ok_or_else(|| GatewayError::with_status(503, "助手文件库数据库不可用"))?
}

/// 分页读取一个文件的一段。返回 `(名字, MIME, 总字节数, 这一段字节)`。
///
/// `offset` 从 0 开始；`limit` 超过 [`MAX_READ_BYTES`] 时按上限截断（调用方
/// 需要更多就多调几次）。**在 SQL 里切片**：`substr(bytes, offset+1, limit)`，
/// 所以内存占用只与这一次请求的 `limit` 有关，与文件大小无关。
pub fn read(
    id: &str,
    session: Option<&str>,
    offset: i64,
    limit: i64,
) -> Option<(String, String, i64, Vec<u8>)> {
    if id.len() != 64 || !id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }
    let offset = offset.max(0);
    let limit = limit.clamp(1, MAX_READ_BYTES);
    database()
        .ok()?
        .with(|conn| {
            conn.query_row(
                "SELECT name, mime, length(bytes), substr(bytes, ?3, ?4) FROM assistant_files \
                 WHERE id = ?1 AND (?2 IS NULL OR session_id = ?2)",
                params![id, session, offset + 1, limit],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, Vec<u8>>(3)?,
                    ))
                },
            )
            .optional()
            .ok()
            .flatten()
        })
        .flatten()
}

/// 删除一个会话导入的全部文件。会话被删时由调用方触发（与图片库同一时机）。
pub fn delete_session(session: &str) -> Result<usize, GatewayError> {
    database()?
        .with(|conn| conn.execute("DELETE FROM assistant_files WHERE session_id = ?1", params![session]))
        .ok_or_else(|| GatewayError::with_status(503, "助手文件库数据库不可用"))
        .map(|n| n.unwrap_or(0))
}

/// 删除单个文件（操作者在导入结果里手工清掉某一个）。
pub fn delete(id: &str, session: Option<&str>) -> Result<usize, GatewayError> {
    if id.len() != 64 || !id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Ok(0);
    }
    database()?
        .with(|conn| {
            conn.execute(
                "DELETE FROM assistant_files WHERE id = ?1 AND (?2 IS NULL OR session_id = ?2)",
                params![id, session],
            )
        })
        .ok_or_else(|| GatewayError::with_status(503, "助手文件库数据库不可用"))
        .map(|n| n.unwrap_or(0))
}
