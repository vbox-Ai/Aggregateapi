//! Agent2API 网关的 iOS C ABI 封装（形态 A2）。
//!
//! ── 为什么是库而不是进程 ──────────────────────────────────────
//! iOS 的 App 沙盒禁止 `fork/exec` 任意可执行体，内核也拒绝加载非 Mach-O，
//! 所以 Android 模块那套「supervisor 拉一个独立进程」在这里必须换成
//! 「网关作为静态库跑在 App 进程里」；需要熄屏常驻时改走标准答案：
//! 编 `aarch64-apple-ios` 的 Mach-O 二进制 + LaunchDaemon（形态 A1）。
//!
//! ── 与 headless 二进制的时序完全一致 ──────────────────────────
//! 本文件的 `a2a_start` 逐行对照上游 `server/src/bin/agent2api-server.rs`：
//!   bootstrap → access 句柄/令牌 → 面板闸门 → set_ui_dir → start
//! 差别只有三处：
//!   1. 监听地址固定回环（App 场景没有容器端口映射需求）；
//!   2. 用环境变量把 home / ui_dir 指进 App 容器（`paths::config_dir` 认
//!      `AGENT2API_PROXY_HOME`）；
//!   3. 面板自更新硬关（`AGENT2API_SELF_UPDATE=0`）—— 它会下载 glibc ELF
//!      覆盖自身，在 iOS 上等于自杀。

use std::ffi::{c_char, CStr};
use std::net::{IpAddr, Ipv4Addr};
use std::path::PathBuf;
use std::sync::Mutex;

use agent2api_server::server::{access, logging, start, ServerState};
use tokio::sync::oneshot;

/// 停机信号发送端：`start()` 返回后由主线程持有，`a2a_stop` 里 send 触发优雅停机。
static SHUTDOWN: Mutex<Option<oneshot::Sender<()>>> = Mutex::new(None);

/// 最近一次失败原因。Swift 侧通过 `a2a_last_error()` 取走并显示在界面上，
/// 这样没有终端也能看到"为什么没起来"（返回码只有 -1/-2，不足以定位）。
static LAST_ERROR: Mutex<Option<String>> = Mutex::new(None);

fn set_last_error(message: impl Into<String>) {
    if let Ok(mut slot) = LAST_ERROR.lock() {
        *slot = Some(message.into());
    }
}

fn c_path(p: *const c_char) -> Option<PathBuf> {
    if p.is_null() {
        return None;
    }
    // SAFETY: 调用方保证传入的是 NUL 结尾的 UTF-8 C 字符串（Swift 侧用
    // `withCString` 生成，生命周期覆盖本次调用）。
    let s = unsafe { CStr::from_ptr(p) };
    s.to_str().ok().filter(|v| !v.trim().is_empty()).map(PathBuf::from)
}

fn log(tag: &str, msg: &str) {
    // logging::log 会同时进 stderr 与 {config_dir}/server.log
    logging::log(tag, msg);
}

/// 启动网关。返回 0 成功，负数为失败码。
///
/// # 参数
/// * `home`    —— 数据目录（`Documents` 或 `Library/Application Support/agent2api`）
/// * `ui_dir`  —— 面板静态目录（ipa 里是 `Bundle.main.resourceURL/ui`）
/// * `port`    —— 监听端口，0 表示用默认 3065
///
/// # 失败码
/// * `-1` bootstrap 失败（目录不可写 / 库 schema 高于本程序）
/// * `-2` 端口占用或 bind 失败
/// * `-3` 已在运行（幂等保护，Swfit 侧按成功处理即可）
#[no_mangle]
pub extern "C" fn a2a_start(home: *const c_char, ui_dir: *const c_char, port: u16) -> i32 {
    if SHUTDOWN.lock().map(|g| g.is_some()).unwrap_or(false) {
        return -3;
    }

    // ── 环境变量：全部在 bootstrap 之前落定（paths::config_dir 只读一次）──
    if let Some(home) = c_path(home) {
        if let Err(e) = std::fs::create_dir_all(&home) {
            log("[iOS]", &format!("数据目录创建失败 {}: {e}", home.display()));
            return -1;
        }
        std::env::set_var("AGENT2API_PROXY_HOME", &home);
        std::env::set_var("HOME", &home); // reqwest/chrono 等的 home 推断兜底
    }
    std::env::set_var("AGENT2API_HOST", "127.0.0.1"); // App 内无对外暴露需求
    std::env::set_var("AGENT2API_CAPTCHA_ENABLED", "1");
    std::env::set_var("AGENT2API_SELF_UPDATE", "0"); // iOS 上原地自更新 = 砖
    std::env::set_var("AGENT2API_DEPLOY", "ios");

    // ── 允许 spawn 插件进程 ───────────────────────────────────────
    // App 本体的 entitlements 里已经打开 `com.apple.private.security.no-sandbox`
    // （去沙盒），所以进程内网关与桌面端同权，可以 exec App 容器里 ldid 签名过的
    // 插件 Mach-O。没有这个 env，网关的 spawn 闸门会先一步拒绝并提示
    // 「iOS 形态未声明 AGENT2API_ALLOW_EXEC=1」——用户实测就是这条。
    // 如果安装环境（例如没成功注入 no-sandbox）导致 exec 仍被拒，错误会变成
    // spawn 失败并写入日志，届时回退到"LaunchDaemon + 客户端 IPA"方案。
    if std::env::var("AGENT2API_NO_EXEC").map(|v| v.trim() == "1").unwrap_or(false) {
        std::env::remove_var("AGENT2API_ALLOW_EXEC");
    } else {
        std::env::set_var("AGENT2API_ALLOW_EXEC", "1");
    }

    let port = if port == 0 { 3065 } else { port };
    let host = IpAddr::from(Ipv4Addr::LOCALHOST);

    // ── 1. bootstrap：开库、迁移、读配置、装日志后端 ──────────────
    let mut state = match ServerState::bootstrap(port, host) {
        Ok(state) => state,
        Err(reason) => {
            let message = format!("bootstrap 失败: {reason}");
            log("[iOS]", &message);
            set_last_error(message);
            return -1;
        }
    };

    // ── 2. 面板访问控制：库句柄 + 双令牌载入 + env 管理员同步 ──────
    // 与 headless 一致：App 场景也保留「未注册窗口期只放行注册端点」的闸门，
    // 避免局域网内有人先抢注（iOS 上还可能被同 Wi-Fi 的其它设备访问到）。
    access::set_panel_gate(true);
    access::attach_db(state.db().cloned());
    access::load_refresh_tokens();
    access::load_access_tokens();
    access::sync_env_admin_to_store();

    // ── 3. 转发面 fail-closed：没 Key 就拒绝 /v1/* ───────────────
    // 与 headless 的差异：App 只监听回环，裸跑风险可控，所以只在显式要求时
    // 关闭闸门；默认保持与 headless 相同的 fail-closed 语义，行为可预期。
    if !agent2api_server::server::config::current().active_api_keys().is_empty() {
        log("[Security]", "API Key 认证已启用");
    } else if std::env::var("AGENT2API_ALLOW_NO_KEY").map(|v| v.trim() == "1").unwrap_or(false) {
        access::set_panel_gate(false);
        log("[Security]", "⚠️ AGENT2API_ALLOW_NO_KEY=1：未配置 API Key，网关完全开放");
    } else {
        access::set_v1_fail_closed(true);
        log(
            "[Security]",
            "尚未配置 API Key：登录面板在「网关 Key」页创建第一把，/v1/* 在此之前拒绝服务",
        );
    }

    // ── 4. 面板静态目录 ──────────────────────────────────────────
    if let Some(dir) = c_path(ui_dir) {
        if dir.is_dir() {
            state.set_ui_dir(dir);
        } else {
            log("[iOS]", &format!("UI 目录不存在（面板将 404）: {}", dir.display()));
        }
    }

    // ── 5. 起服务（同步 bind + 后台 spawn，内部走 spawn_task 兜底运行时）──
    match start(&state) {
        Ok(tx) => {
            if let Ok(mut g) = SHUTDOWN.lock() {
                *g = Some(tx);
            }
            log("[iOS]", &format!("网关已就绪：http://127.0.0.1:{port}/ ｜ API /v1"));
            0
        }
        Err(conflict) => {
            log("[iOS]", &format!("网关启动失败: {}", conflict.message));
            -2
        }
    }
}

/// 优雅停机。返回 0 表示已发出停机信号，`-1` 表示当前未运行。
#[no_mangle]
pub extern "C" fn a2a_stop() -> i32 {
    let tx = SHUTDOWN.lock().ok().and_then(|mut g| g.take());
    match tx {
        Some(tx) => {
            // 接收端在 serve 循环里，send 失败说明它已经自己退了，两种情况都算停
            let _ = tx.send(());
            log("[iOS]", "已发出停机信号");
            0
        }
        None => -1,
    }
}

/// 探测当前是否由本库启动过（App 从后台回前台时用来决定要不要重启）。
#[no_mangle]
pub extern "C" fn a2a_is_running() -> i32 {
    match SHUTDOWN.lock() {
        Ok(g) => i32::from(g.is_some()),
        Err(_) => -1,
    }
}

/// 数据目录里 SQLite 库文件路径，供 Swift 侧展示/备份。调用方负责 free。
#[no_mangle]
pub extern "C" fn a2a_db_path() -> *mut c_char {
    let path = agent2api_server::paths::config_dir().join("agent2api.db");
    match std::ffi::CString::new(path.to_string_lossy().to_string()) {
        Ok(s) => s.into_raw(),
        Err(_) => std::ptr::null_mut(),
    }
}

/// 释放 `a2a_db_path` 返回的字符串。
#[no_mangle]
/// 取走并清空最近一次失败原因；调用方负责 `a2a_free_string` 释放。
pub extern "C" fn a2a_last_error() -> *mut c_char {
    let text = LAST_ERROR
        .lock()
        .ok()
        .and_then(|mut slot| slot.take())
        .unwrap_or_default();
    match std::ffi::CString::new(text) {
        Ok(value) => value.into_raw(),
        Err(_) => std::ptr::null_mut(),
    }
}

#[no_mangle]
pub extern "C" fn a2a_free_string(p: *mut c_char) {
    if !p.is_null() {
        // SAFETY: 指针必须来自本库的 CString::into_raw
        unsafe {
            let _ = std::ffi::CString::from_raw(p);
        }
    }
}
