//! Agent2API 网关 · iOS 守护进程入口（launchd 常驻形态）。
//!
//! ── 为什么需要它 ──────────────────────────────────────────────
//! 上游把 headless 二进制目标（`agent2api-server` bin）从 `server` crate 里移除了，
//! 但 iOS 必须有一个**无沙盒的独立进程**来跑网关，原因有二：
//!   1. App 沙盒禁止 `posix_spawn` 子进程 → 插件永远起不来；
//!   2. App 被挂起/回收时网关会跟着停 → 面板随 App 一起死。
//! 所以这里用同一份 `agent2api_server` 库，补一个 30 行的 launchd 入口，
//! 编到 `aarch64-apple-ios` 得到 Mach-O，由 LaunchDaemon 常驻拉起。
//!
//! ── 与 headless main 的差异 ───────────────────────────────────
//! · 不接 SIGTERM/SIGINT 做优雅停机（launchd `KeepAlive` 负责重启；停了就是重启）；
//! · 主线程 park 而不是 block_on：服务器自己的运行时在 `start()` 里已经起好了；
//! · 监听地址默认 127.0.0.1（App 与 daemon 同机，不需要对局域网放开；
//!   要放开就设 `AGENT2API_HOST=0.0.0.0`）。
//!
//! ── 环境变量（与 headless 完全一致）──────────────────────────
//!   AGENT2API_PROXY_HOME   数据目录（默认 $HOME/.agent2api）
//!   AGENT2API_HOST         监听地址（默认 127.0.0.1）
//!   AGENT2API_PROXY_PORT   端口（默认 3065）
//!   AGENT2API_UI_DIR       面板静态目录
//!   AGENT2API_ALLOW_EXEC   置 1 才允许 spawn 插件（iOS 上必须显式声明）
//!   AGENT2API_NO_EXEC      置 1 强制禁止 spawn 插件
//!   AGENT2API_ALLOW_NO_KEY 置 1 关闭全部闸门（纯本机自用）

use std::net::{IpAddr, Ipv4Addr};
use std::process::ExitCode;

use agent2api_server::server::{access, config, logging, start, ServerState};

fn env_port(key: &str) -> Option<u16> {
    std::env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .and_then(|value| value.parse().ok())
}

fn main() -> ExitCode {
    let port = env_port("AGENT2API_PROXY_PORT")
        .or_else(|| env_port("WORKBUDDY_PROXY_PORT"))
        .unwrap_or(3065);

    let host: IpAddr = std::env::var("AGENT2API_HOST")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .and_then(|value| value.parse().ok())
        .unwrap_or(IpAddr::from(Ipv4Addr::LOCALHOST));

    // ── bootstrap：开库、迁移、读配置、装日志后端 ──────────────
    let mut state = match ServerState::bootstrap(port, host) {
        Ok(state) => state,
        Err(reason) => {
            eprintln!("❌ 网关初始化失败: {reason}");
            return ExitCode::FAILURE;
        }
    };

    // ── 面板访问控制：库句柄 + 双令牌 + env 管理员同步 ────────
    access::set_panel_gate(true);
    access::attach_db(state.db().cloned());
    access::load_refresh_tokens();
    access::load_access_tokens();
    access::sync_env_admin_to_store();

    // ── 安全闸门：无 Key 时 fail-closed，除非显式声明裸跑 ────
    if !config::current().active_api_keys().is_empty() {
        logging::log("[Security]", "API Key 认证已启用");
    } else if std::env::var("AGENT2API_ALLOW_NO_KEY")
        .map(|value| value.trim() == "1")
        .unwrap_or(false)
    {
        access::set_panel_gate(false);
        logging::log("[Security]","⚠️ AGENT2API_ALLOW_NO_KEY=1：未配置 API Key，网关完全开放");
    } else {
        access::set_v1_fail_closed(true);
        logging::log(
            "[Security]",
            "尚未配置 API Key：在面板「网关 Key」页创建第一把，/v1/* 在此之前拒绝服务",
        );
    }

    // ── 面板静态目录 ────────────────────────────────────────────
    // 优先读环境变量；但 launchd 的 EnvironmentVariables 只在**首次加载 plist** 时生效，
    // 旧 job 被 KeepAlive 重新拉起时会沿用旧环境（表现为：ui 文件明明在磁盘上，
    // /m 却一直 404）。所以这里再做两条路径兜底：rootless 标准位置 + 可执行文件同级。
    let mut ui_dir = std::env::var("AGENT2API_UI_DIR")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(std::path::PathBuf::from);

    if ui_dir.as_ref().map(|dir| !dir.is_dir()).unwrap_or(false) {
        ui_dir = None;
    }
    if ui_dir.is_none() {
        let candidates = [
            std::path::PathBuf::from("/var/jb/usr/local/share/agent2api/ui"),
            std::path::PathBuf::from("/usr/local/share/agent2api/ui"),
        ];
        ui_dir = candidates.into_iter().find(|dir| dir.is_dir());
    }
    if ui_dir.is_none() {
        if let Ok(exe) = std::env::current_exe() {
            if let Some(parent) = exe.parent() {
                for guess in [parent.join("ui"), parent.join("../share/agent2api/ui")] {
                    if guess.is_dir() {
                        ui_dir = Some(guess);
                        break;
                    }
                }
            }
        }
    }

    match ui_dir {
        Some(dir) => {
            logging::log("[UI]", &format!("面板静态目录: {}", dir.display()));
            state.set_ui_dir(dir);
        }
        None => logging::log(
            "[UI]",
            "⚠ 找不到面板静态目录（/m 会 404）：请确认 /var/jb/usr/local/share/agent2api/ui 存在",
        ),
    }

    // ── 起服务 ────────────────────────────────────────────────
    let shutdown = match start(&state) {
        Ok(tx) => tx,
        Err(conflict) => {
            eprintln!("❌ 网关启动失败：{}", conflict.message);
            return ExitCode::FAILURE;
        }
    };

    logging::log(
        "[Server]",
        &format!("iOS daemon 运行中：面板 http://{host}:{port}/ ｜ API /v1 ｜ 插件 spawn 由 AGENT2API_ALLOW_EXEC 控制"),
    );

    // 保持运行：服务器运行时在自己的线程里，这里只需要不退出。
    // 收到 shutdown 发送端的信号（例如未来的热重启）时也不退出——交给 launchd 处理重启。
    let mut ticker = 0u64;
    loop {
        std::thread::sleep(std::time::Duration::from_secs(30));
        ticker += 1;
        // 每小时打一条心跳，方便确认 daemon 没被系统挂起
        if ticker % 120 == 0 {
            logging::log("[Server]", "heartbeat：daemon 仍在运行");
        }
        // 保留 shutdown 句柄的所有权（drop 会触发停机）
        std::hint::black_box(&shutdown);
    }
}
