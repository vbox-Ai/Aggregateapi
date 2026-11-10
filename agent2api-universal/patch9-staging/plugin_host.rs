//! 脚本插件宿主源码的 HTTP 面（阶段 0：iOS 上由手机本地运行宿主时取用）。
//!
//! ── 为什么由网关提供，而不是手机自带一份 ──────────────────────
//! 宿主是「网关侧的一等公民」：它跟着网关版本走（`script_files()` 把这 29 个
//! 模块 `include_str!` 进二进制）。手机若自带一份，两边迟早漂移，而宿主与网关
//! 之间的 NDJSON 协议、帧形状、方法名都是**成对**的 —— 版本不一致会表现成
//! 莫名其妙的运行期错误，而不是启动失败。所以这里把「网关当前用的那份」原样给出。
//!
//! ── 手机拿它做什么 ────────────────────────────────────────────
//! iOS 上没有 Bun（`plugin_host/script/bun.rs` 的 `asset()` 没有 ios 分支），
//! 网关侧起不了脚本宿主。手机改为在 Worker 里跑这些源码，插件的网络请求仍经
//! 网关出网（`script.http.*`）。取源码走的就是本接口。
//!
//! ── 与 `api::plugins` 的关系 ──────────────────────────────────
//! 同构：处理函数签名、`ok_json` 的用法照那一份写；路由挂在 `protected` 分组下，
//! 鉴权由分组负责（见 `http.rs`）。

use agent2api_provider_protocol as proto;
use axum::body::{Body, Bytes};
use axum::extract::State;
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use serde_json::json;

use crate::server::core::plugin_host::script;
use crate::server::http::ok_json;
use crate::server::ServerState;

/// 桥上的失败要能一眼看出是哪一层（缺宿主 / 会话没开 / 内部错）
fn error_response(message: &str, status: StatusCode) -> Response {
    (status, Json(json!({ "error": message }))).into_response()
}

/// 返回宿主源码全量（含 `bunfig.toml` / `package.json` 两个小文件）。
///
/// 体积很小：29 个模块合计约 90 KB，一次给全比按文件取更省事，也免掉「手机记
/// 不清哪些取过」这一类状态。协议与宿主版本用 `hostId` 标识。
pub async fn source(State(_state): State<ServerState>, _headers: HeaderMap) -> Response {
    let files: Vec<serde_json::Value> = script::script_files()
        .iter()
        .map(|(path, text)| json!({ "path": path, "text": text }))
        .collect();
    ok_json(json!({ "hostId": script::HOST_ID, "files": files }))
}


// ── 远端宿主桥（iOS：宿主跑在手机里）────────────────────────────────
//
// 宿主与网关之间是「一行一个 JSON 帧」的 NDJSON，正常走子进程的 stdin/stdout。
// iOS 上没有 Bun（`script/bun.rs` 的 `asset()` 没有 ios 分支），宿主改在手机的
// Worker 里跑，于是同一份协议改走 HTTP：
//   · 上行：手机把宿主发出的帧 POST 到 /api/plugins/host/frames
//   · 下行：手机 GET /api/plugins/host/stream，长连接收网关（与插件）发出的帧
//
// ── 为什么不用 WebSocket ────────────────────────────────────────
// 网关的 axum 只开了 multipart（Cargo.toml:80），没有 ws 特性；开特性等于改依赖面。
// 这两个端点用现成的 `Body::from_stream` 就够（写法照 api/backup_api.rs:158-173）。
//
// ── 会话是单例 ──────────────────────────────────────────────────
// 一台网关同一时刻只服务一个面板（宿主本身也是单实例），所以用一个全局槽持有
// 出站接收端，由 `GET /stream` 取走。重复 open 会替换旧会话。

static REMOTE_INBOX: std::sync::OnceLock<
    std::sync::Mutex<Option<tokio::sync::mpsc::UnboundedReceiver<proto::Frame>>>,
> = std::sync::OnceLock::new();

fn inbox() -> &'static std::sync::Mutex<Option<tokio::sync::mpsc::UnboundedReceiver<proto::Frame>>> {
    REMOTE_INBOX.get_or_init(|| std::sync::Mutex::new(None))
}

fn host_or_error() -> Result<std::sync::Arc<crate::server::core::plugin_host::Host>, Response> {
    script::script_host().ok_or_else(|| {
        error_response(
            "这台网关没有脚本宿主（脚本插件可能未启用）",
            StatusCode::SERVICE_UNAVAILABLE,
        )
    })
}

/// 打开远端宿主会话：挂上出站口，交由手机发 `init` 完成握手。
pub async fn open_remote(State(_state): State<ServerState>, _headers: HeaderMap) -> Response {
    let host = match host_or_error() {
        Ok(host) => host,
        Err(response) => return response,
    };
    match host.attach_remote() {
        Some(receiver) => {
            if let Ok(mut slot) = inbox().lock() {
                *slot = Some(receiver);
            }
            ok_json(json!({ "hostId": script::HOST_ID }))
        }
        None => error_response("插件宿主状态不可用", StatusCode::INTERNAL_SERVER_ERROR),
    }
}

#[derive(Deserialize)]
pub struct FramesBody {
    /// 宿主发出的帧（与子进程 stdout 上的完全一致，一行一个）
    lines: Vec<String>,
}

/// 上行：把手机端宿主发出的帧交给同一套回调处理。
pub async fn frames(
    State(_state): State<ServerState>,
    _headers: HeaderMap,
    Json(body): Json<FramesBody>,
) -> Response {
    let host = match host_or_error() {
        Ok(host) => host,
        Err(response) => return response,
    };
    // 拼成一个流再按帧读：proto 的读取接口吃的是 AsyncRead（lifecycle.rs:238 就是这么用的），
    // 逐行自己解析等于重写一遍协议。
    let payload = body.lines.join("\n");
    let bytes = payload.as_bytes();
    let mut reader = tokio::io::BufReader::new(bytes);
    let mut accepted = 0usize;
    loop {
        match proto::read_frame(&mut reader).await {
            Ok(Some(frame)) => {
                host.serve_remote_frame(frame).await;
                accepted += 1;
            }
            Ok(None) => break,
            Err(error) => {
                return error_response(
                    &format!("宿主帧读取失败：{error}"),
                    StatusCode::BAD_REQUEST,
                )
            }
        }
    }
    ok_json(json!({ "accepted": accepted }))
}

/// 下行：把网关（与插件）发出的帧流给手机。
pub async fn stream(State(_state): State<ServerState>, _headers: HeaderMap) -> Response {
    let taken = inbox().lock().ok().and_then(|mut slot| slot.take());
    let Some(mut receiver) = taken else {
        return error_response("远端宿主会话还没打开", StatusCode::CONFLICT);
    };
    let body = Body::from_stream(futures::stream::unfold(receiver, |mut receiver| async move {
        match receiver.recv().await {
            Some(frame) => {
                // 用同一套写入器编码，保证与子进程路径逐字节一致
                let mut out: Vec<u8> = Vec::new();
                match proto::write_frame(&mut out, &frame).await {
                    Ok(()) => Some((Ok::<_, std::io::Error>(Bytes::from(out)), receiver)),
                    // 编码失败：不静默丢帧，把原因作为流错误交给客户端
                    Err(error) => Some((Err(std::io::Error::other(error.to_string())), receiver)),
                }
            }
            None => None,
        }
    }));
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/x-ndjson")
        .header(header::CACHE_CONTROL, "no-store")
        .body(body)
        .unwrap_or_else(|_| error_response("下行流构造失败", StatusCode::INTERNAL_SERVER_ERROR))
}

/// 关闭远端宿主会话（面板退出或手机断开）。
pub async fn close_remote(State(_state): State<ServerState>, _headers: HeaderMap) -> Response {
    if let Some(host) = script::script_host() {
        host.detach_remote();
    }
    if let Ok(mut slot) = inbox().lock() {
        *slot = None;
    }
    ok_json(json!({ "ok": true }))
}
