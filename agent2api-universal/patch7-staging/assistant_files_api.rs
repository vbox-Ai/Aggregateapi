//! 助手文件库的 HTTP 面：导入（zip 上传）/ 列表 / 分页读取 / 删除。
//!
//! ── 为什么上传要落临时文件 ────────────────────────────────────
//! 目标体量是上百 MB 的 zip。**绝不能**把请求体整个读进内存再解包：手机上
//! 那一步直接 OOM。所以走 `tempfile::NamedTempFile` 落盘 → `ZipArchive`
//! 从文件读 → **一次只把一个条目读进内存** → 立刻入库。峰值内存 = 单个条目
//! 的大小，与包体无关。
//!
//! ── 为什么读取走 query 分页而不是流式响应 ──────────────────────
//! 助手侧的需求是"读一段、看一段、再读下一段"（`read_attachment` 的语义），
//! 不是"下载整个文件"。同一组 `offset`/`limit` 参数既服务助手的工具调用，
//! 也够手工排查；`limit` 由 `core::assistant_files::MAX_READ_BYTES` 兜底，
//! 一次调用不可能把上百 MB 拉进上下文。
//!
//! ── 与 `api::assistant_images` 的关系 ──────────────────────────
//! 同构：处理函数签名、`GatewayError`、`ok_json` 的用法都照那一份写；
//! 路由挂进同一个 `protected` 分组（鉴权由分组负责，见 `http.rs`）。

use axum::body::Bytes;
use axum::extract::{Multipart, Path, Query, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use serde::Deserialize;
use serde_json::json;
use std::io::{Read, Seek, Write};

use crate::server::core::assistant_files;
use crate::server::errors::GatewayError;
use crate::server::http::ok_json;
use crate::server::ServerState;

/// zip 包体积上限：100 MB 留出余量。
const MAX_PACKAGE_BYTES: u64 = 128 * 1024 * 1024;
/// 条目数上限。操作者说"有时上百个文件"，留到 2000。
const MAX_ENTRIES: usize = 2000;
/// 单个条目上限。超过就跳过并报原因（不因为一个巨型文件废掉整次导入）。
const MAX_ENTRY_BYTES: u64 = 32 * 1024 * 1024;
/// 一次事务里入库多少条。分小批是为了让"入库"这一步的内存占用也有上界。
const BATCH: usize = 32;

#[derive(Deserialize)]
pub struct ReadQuery {
    session: Option<String>,
    offset: Option<i64>,
    limit: Option<i64>,
}

#[derive(Deserialize)]
pub struct SessionQuery {
    session: Option<String>,
}

/// `POST /api/assistant/files`：收一个 zip，解包入库，返回导入结果。
///
/// 返回 `{ imported, ids, skipped: [{ name, reason }] }`：**跳过的东西一定带原因**
/// —— 静默丢弃会让人以为"传上去了"，而助手那边读不到，最难排查。
pub async fn upload(
    State(_state): State<ServerState>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> Response {
    let session = session_id(&headers).unwrap_or_else(|| "default".to_string());
    match import_zip(&session, &mut multipart).await {
        Ok((ids, skipped)) => ok_json(json!({
            "imported": ids.len(),
            "ids": ids,
            "skipped": skipped,
        })),
        Err(err) => err.into_response(),
    }
}

/// 把 multipart 里的 zip 落到临时文件再解包。
async fn import_zip(
    session: &str,
    multipart: &mut Multipart,
) -> Result<(Vec<String>, Vec<serde_json::Value>), GatewayError> {
    assistant_files::available()?;

    let mut spool = tempfile::NamedTempFile::new()
        .map_err(|_| GatewayError::with_status(500, "无法创建导入临时文件"))?;
    let mut total: u64 = 0;
    let mut got_field = false;
    while let Some(mut field) = multipart
        .next_field()
        .await
        .map_err(|_| GatewayError::with_status(400, "上传内容不是合法的 multipart"))?
    {
        // 只收文件字段；普通表单字段（例如 session）忽略。
        if field.file_name().is_none() {
            continue;
        }
        got_field = true;
        while let Some(chunk) = field
            .chunk()
            .await
            .map_err(|_| GatewayError::with_status(400, "上传中断"))?
        {
            total = total.saturating_add(chunk.len() as u64);
            if total > MAX_PACKAGE_BYTES {
                return Err(GatewayError::with_status(
                    413,
                    "压缩包超过 128 MB，请拆分后再导入",
                ));
            }
            spool
                .write_all(&chunk)
                .map_err(|_| GatewayError::with_status(500, "写入导入临时文件失败"))?;
        }
    }
    if !got_field {
        return Err(GatewayError::with_status(400, "没有收到压缩包文件"));
    }
    spool
        .flush()
        .map_err(|_| GatewayError::with_status(500, "写入导入临时文件失败"))?;

    // 从临时文件解包：一次一个条目，读完立刻入库。
    let mut file = spool
        .reopen()
        .map_err(|_| GatewayError::with_status(500, "无法读取导入临时文件"))?;
    file.seek(std::io::SeekFrom::Start(0))
        .map_err(|_| GatewayError::with_status(500, "无法读取导入临时文件"))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|_| GatewayError::with_status(400, "这不是一个可读的 zip 压缩包"))?;

    let mut ids: Vec<String> = Vec::new();
    let mut skipped: Vec<serde_json::Value> = Vec::new();
    let mut batch: Vec<(String, String, Vec<u8>)> = Vec::with_capacity(BATCH);
    let count = archive.len().min(MAX_ENTRIES);
    if archive.len() > MAX_ENTRIES {
        skipped.push(json!({ "name": "(其余条目)", "reason": format!("超过 {MAX_ENTRIES} 个条目上限，未导入") }));
    }
    for index in 0..count {
        let name = {
            let entry = archive
                .by_index(index)
                .map_err(|_| GatewayError::with_status(400, "压缩包条目无法读取"))?;
            if entry.is_dir() {
                continue;
            }
            entry.name().to_string()
        };
        // 目录穿越与绝对路径：只取基名，绝不按包内路径落任何地方。
        let safe_name = name
            .rsplit(['/', '\\'])
            .next()
            .unwrap_or(&name)
            .trim_matches('\u{0}')
            .to_string();
        if safe_name.is_empty() {
            skipped.push(json!({ "name": name, "reason": "条目名为空" }));
            continue;
        }
        let mut entry = archive
            .by_index(index)
            .map_err(|_| GatewayError::with_status(400, "压缩包条目无法读取"))?;
        if entry.size() > MAX_ENTRY_BYTES {
            skipped.push(json!({
                "name": safe_name,
                "reason": format!("单文件超过 {} MB 上限", MAX_ENTRY_BYTES / 1024 / 1024),
            }));
            continue;
        }
        let mut bytes = Vec::with_capacity(entry.size().min(MAX_ENTRY_BYTES) as usize);
        // 用 take 兜住"声明大小与实际不符"的包：读到的绝不会超过上限。
        entry
            .by_ref()
            .take(MAX_ENTRY_BYTES)
            .read_to_end(&mut bytes)
            .map_err(|_| GatewayError::with_status(400, "压缩包条目解压失败（可能已损坏）"))?;
        if bytes.is_empty() {
            skipped.push(json!({ "name": safe_name, "reason": "空文件" }));
            continue;
        }
        batch.push((safe_name, mime_of(&name), bytes));
        if batch.len() >= BATCH {
            let stored = assistant_files::store_unpacked(session, std::mem::take(&mut batch))?;
            ids.extend(stored);
        }
    }
    if !batch.is_empty() {
        let stored = assistant_files::store_unpacked(session, batch)?;
        ids.extend(stored);
    }
    Ok((ids, skipped))
}

/// `GET /api/assistant/files?session=`：列出这个会话导入的文件（不含字节）。
pub async fn list(
    State(_state): State<ServerState>,
    headers: HeaderMap,
    Query(query): Query<SessionQuery>,
) -> Response {
    let session = query.session.or_else(|| session_id(&headers));
    let session = session.unwrap_or_else(|| "default".to_string());
    match assistant_files::list(&session) {
        Ok(items) => ok_json(json!({ "files": items })),
        Err(err) => err.into_response(),
    }
}

/// `GET /api/assistant/files/{id}?offset=&limit=`：分页读取一段字节。
///
/// 响应带 `X-Total-Bytes` 与 `X-Name`，调用方据此翻页；`limit` 会被
/// `core::assistant_files::MAX_READ_BYTES` 截断（读不完就再来一页）。
pub async fn read(
    State(_state): State<ServerState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Query(query): Query<ReadQuery>,
) -> Response {
    let session = query.session.or_else(|| session_id(&headers));
    let offset = query.offset.unwrap_or(0);
    let limit = query.limit.unwrap_or(assistant_files::MAX_READ_BYTES);
    match assistant_files::read(&id, session.as_deref(), offset, limit) {
        Some((name, mime, total, bytes)) => {
            let mut response = bytes.into_response();
            let headers = response.headers_mut();
            if let Ok(value) = HeaderValue::from_str(&mime) {
                headers.insert(header::CONTENT_TYPE, value);
            }
            if let Ok(value) = HeaderValue::from_str(&total.to_string()) {
                headers.insert("x-total-bytes", value);
            }
            if let Ok(value) = HeaderValue::from_str(&offset.to_string()) {
                headers.insert("x-offset", value);
            }
            if let Ok(value) = HeaderValue::from_str(&url_encode(&name)) {
                headers.insert("x-name", value);
            }
            response
        }
        None => GatewayError::with_status(404, "助手文件不存在").into_response(),
    }
}

/// `DELETE /api/assistant/files/{id}?session=`
pub async fn delete(
    State(_state): State<ServerState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Query(query): Query<SessionQuery>,
) -> Response {
    let session = query.session.or_else(|| session_id(&headers));
    match assistant_files::delete(&id, session.as_deref()) {
        Ok(removed) => ok_json(json!({ "removed": removed })),
        Err(err) => err.into_response(),
    }
}

/// multipart 之外的会话标识：优先 `X-Session-Id`，其次 `X-Assistant-Session`。
fn session_id(headers: &HeaderMap) -> Option<String> {
    for key in ["x-session-id", "x-assistant-session"] {
        if let Some(value) = headers.get(key).and_then(|v| v.to_str().ok()) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

/// 按扩展名给 MIME。只用于让助手/下载端知道自己拿到的是什么，不参与判定。
fn mime_of(name: &str) -> String {
    let lower = name.to_ascii_lowercase();
    let ext = lower.rsplit('.').next().unwrap_or("");
    match ext {
        "json" => "application/json",
        "md" | "markdown" => "text/markdown",
        "txt" | "log" | "csv" | "tsv" | "yml" | "yaml" | "toml" | "ini" | "conf" => "text/plain",
        "xml" => "application/xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    }
    .to_string()
}

/// 头部里放文件名时的最小百分号编码（非 ASCII 与分隔符一律转义）。
fn url_encode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char)
            }
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}
