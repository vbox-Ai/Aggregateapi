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

use axum::extract::State;
use axum::http::HeaderMap;
use axum::response::Response;
use serde_json::json;

use crate::server::core::plugin_host::script;
use crate::server::http::ok_json;
use crate::server::ServerState;

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
