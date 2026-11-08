//! Agent2API iOS supervisor.
//!
//! The supervisor is the only LaunchDaemon. It does not bind the gateway port.
//! The App calls `POST /start` when it becomes active and `POST /stop` when it
//! enters the background. A heartbeat stops the gateway if the App is killed
//! without sending `/stop`.
//!
//! Control API (127.0.0.1:3066):
//!   GET  /status
//!   POST /start
//!   POST /stop
//!   POST /heartbeat
//!   GET  /health
//!   GET  /lan             —— 读局域网访问开关
//!   POST /lan?enabled=0|1 —— 写开关并按需重启网关
//!   POST /factory-reset   —— 删库重注册（忘记面板管理员密码时的唯一出路，
//!                            见上游 api/panel.rs「重置说明」）。会清空账号、
//!                            网关 Key、日志与设置，调用方必须先让用户二次确认。
//!
//! ── 局域网访问（默认关）──────────────────────────────────────
//! 默认网关只听 127.0.0.1（单机安全边界）。开关打开后：
//!   · 网关改听 0.0.0.0，同一局域网内其它设备可把 API 地址指向本机 IP；
//!   · **面板搬到独立端口并钉在回环**（`AGENT2API_PANEL_PORT/HOST`），
//!     所以局域网里只有 `/v1` 网关可见（要网关 Key），管理面不出网。
//! 这与桌面端「局域网访问」同一口径，但**更严**：桌面端默认只出网关、把
//! 「同时开放网页管理面板」做成第二个默认关的开关；这里干脆不提供那个开关
//! —— 少一个开关就少一种配错的可能，而手机上的管理面本来也没必要给局域网。
//!
//! `AGENT2API_PANEL_HOST` 由 `agent2api-universal/patches/0006` 引入；网关
//! 二进制与 supervisor 同一次发布一起装（同一个 deb / IPA），所以这里不需要
//! 探测网关版本。开关落在 `<home>/supervisor.json`，本 bin 自己读自己写。

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

const HEARTBEAT_TIMEOUT_MS: i64 = 15_000;
const START_TIMEOUT: Duration = Duration::from_secs(15);
/// 开局域网时面板搬到的独立端口（**绑回环**，局域网看不到它）
const PANEL_LOOPBACK_PORT: u16 = 3067;
/// 局域网开关的持久化文件（本 bin 自己读自己写；网关不读它）
const SETTINGS_FILE: &str = "supervisor.json";

struct State {
    child: Mutex<Option<Child>>,
    last_heartbeat: AtomicI64,
    server_bin: PathBuf,
    home: PathBuf,
    ui: PathBuf,
    gateway_port: u16,
}

fn settings_path(home: &Path) -> PathBuf {
    home.join(SETTINGS_FILE)
}

/// 读局域网开关。文件不存在 / 读不动 / 解析失败一律按**关**处理 ——
/// 这是一条安全默认值：宁可少开一个网卡，也不要因为读文件失败而对外暴露。
fn lan_enabled(home: &Path) -> bool {
    let Ok(text) = std::fs::read_to_string(settings_path(home)) else {
        return false;
    };
    serde_json::from_str::<serde_json::Value>(&text)
        .ok()
        .and_then(|value| value.get("lan").and_then(serde_json::Value::as_bool))
        .unwrap_or(false)
}

/// 网关实际监听的地址：开局域网时是 0.0.0.0，否则沿用 `AGENT2API_HOST`
/// （plist 里设的，默认 127.0.0.1）。
fn gateway_host(lan: bool) -> String {
    if lan {
        return "0.0.0.0".to_string();
    }
    std::env::var("AGENT2API_HOST").unwrap_or_else(|_| "127.0.0.1".to_string())
}

/// 面板该在哪个端口：开局域网时搬到独立端口，否则与网关同端口（默认形态）。
fn panel_port(gateway_port: u16, lan: bool) -> u16 {
    if lan { PANEL_LOOPBACK_PORT } else { gateway_port }
}

/// 网关子进程是否在跑。顺带把已退出的句柄收掉（与 `start_child` 里的口径一致）。
///
/// 注意写法：`child` 是从 `guard` 借出来的，**借还没结束就不能再 `guard.take()`**
/// （E0499）。所以先只记结论，出了 `if let` 再动 `guard` —— 原 `status_json` 里
/// 那个 `child_state` 变量就是为这件事存在的。
fn is_running(state: &State) -> bool {
    let Ok(mut guard) = state.child.lock() else {
        return false;
    };
    let mut running = false;
    let mut exited = false;
    if let Some(child) = guard.as_mut() {
        match child.try_wait() {
            Ok(None) => running = true,
            _ => exited = true,
        }
    }
    if exited {
        guard.take();
    }
    running
}

/// 从 `path?key=value` 里取一个布尔开关（本控制口的 POST 不带请求体，
/// 参数走查询串 —— 与 `/start`、`/stop` 那种「无参数」风格保持一致）。
fn query_flag(path: &str, key: &str) -> Option<bool> {
    let query = path.split_once('?')?.1;
    for pair in query.split('&') {
        if let Some((name, value)) = pair.split_once('=') {
            if name == key {
                return Some(value == "1" || value == "true");
            }
        }
    }
    None
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis() as i64)
        .unwrap_or(0)
}

fn log(message: &str) {
    let line = format!("[{}] [Supervisor] {message}\n", now_ms());
    eprintln!("{}", line.trim_end());
    let path = std::env::var("AGENT2API_PROXY_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/var/mobile/Library/agent2api"))
        .join("supervisor.log");
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        let _ = file.write_all(line.as_bytes());
    }
}

fn health(port: u16) -> bool {
    let address = format!("127.0.0.1:{port}");
    let Ok(address) = address.parse::<std::net::SocketAddr>() else {
        return false;
    };
    let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_millis(300)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
    let request = b"GET /health HTTP/1.0\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n";
    if stream.write_all(request).is_err() {
        return false;
    }
    let mut body = String::new();
    let _ = stream.read_to_string(&mut body);
    body.contains("\"ok\"")
}

fn kill_group(pid: u32, signal: &str) {
    let _ = Command::new("/bin/kill")
        .arg(format!("-{signal}"))
        .arg(format!("-{pid}"))
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

fn stop_child(state: &State) -> Result<(), String> {
    let mut guard = state.child.lock().map_err(|_| "child lock poisoned".to_string())?;
    let Some(mut child) = guard.take() else {
        state.last_heartbeat.store(0, Ordering::SeqCst);
        return Ok(());
    };
    let pid = child.id();
    log(&format!("stopping gateway pid={pid}"));
    kill_group(pid, "TERM");

    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        match child.try_wait() {
            Ok(Some(_)) => {
                state.last_heartbeat.store(0, Ordering::SeqCst);
                return Ok(());
            }
            Ok(None) => thread::sleep(Duration::from_millis(100)),
            Err(error) => {
                log(&format!("try_wait failed: {error}"));
                break;
            }
        }
    }
    kill_group(pid, "KILL");
    let _ = child.wait();
    state.last_heartbeat.store(0, Ordering::SeqCst);
    log("gateway killed");
    Ok(())
}

fn start_child(state: &State) -> Result<(), String> {
    let mut running = false;
    {
        let mut guard = state.child.lock().map_err(|_| "child lock poisoned".to_string())?;
        let mut child_state = 0u8; // 0 = none, 1 = running, 2 = exited
        if let Some(child) = guard.as_mut() {
            child_state = match child.try_wait() {
                Ok(None) => 1,
                _ => 2,
            };
        }
        if child_state == 2 {
            guard.take();
        } else if child_state == 1 {
            running = true;
        }
    }
    if running {
        if health(state.gateway_port) {
            return Ok(());
        }
        // A process exists but the gateway is not healthy. Stop it before
        // spawning a replacement; otherwise 3065 would stay occupied.
        stop_child(state)?;
    }

    std::fs::create_dir_all(&state.home).map_err(|error| error.to_string())?;
    let log_path = state.home.join("server.log");
    let log_file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|error| format!("open {}: {error}", log_path.display()))?;
    let log_err = log_file.try_clone().map_err(|error| error.to_string())?;

    let lan = lan_enabled(&state.home);
    let host = gateway_host(lan);
    log(&format!(
        "starting gateway {} (lan={lan}, host={host})",
        state.server_bin.display()
    ));
    let mut command = Command::new(&state.server_bin);
    command
        .env("AGENT2API_PROXY_HOME", &state.home)
        .env("HOME", &state.home)
        .env("AGENT2API_UI_DIR", &state.ui)
        .env("AGENT2API_HOST", &host)
        .env("AGENT2API_PROXY_PORT", state.gateway_port.to_string())
        .env("AGENT2API_ALLOW_EXEC", "1")
        .env("AGENT2API_INPROC", "1")
        .env("AGENT2API_ALLOW_UNSIGNED_PLUGIN_INSTALL", "1")
        .env("AGENT2API_DEPLOY", "ios")
        .env("AGENT2API_SELF_UPDATE", "0")
        .stdout(Stdio::from(log_file))
        .stderr(Stdio::from(log_err));
    if lan {
        // 面板搬到独立端口并钉在回环：局域网里只有网关可见（见文件头说明）。
        // 这两个变量必须成对出现 —— 只给端口不给地址的话，面板会跟着
        // AGENT2API_HOST 一起听 0.0.0.0，等于把管理面也出了网。
        command
            .env("AGENT2API_PANEL_PORT", PANEL_LOOPBACK_PORT.to_string())
            .env("AGENT2API_PANEL_HOST", "127.0.0.1");
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }

    let child = command
        .spawn()
        .map_err(|error| format!("spawn gateway: {error}"))?;
    let pid = child.id();
    {
        let mut guard = state.child.lock().map_err(|_| "child lock poisoned".to_string())?;
        *guard = Some(child);
    }
    state.last_heartbeat.store(now_ms(), Ordering::SeqCst);

    let deadline = Instant::now() + START_TIMEOUT;
    while Instant::now() < deadline {
        if health(state.gateway_port) {
            log(&format!("gateway ready pid={pid}"));
            return Ok(());
        }
        thread::sleep(Duration::from_millis(200));
    }

    let _ = stop_child(state);
    Err("gateway did not become healthy before timeout".to_string())
}

/// 删库重注册：停网关 → 删库与密钥文件 → 重新拉起。
///
/// 为什么是「删库」而不是「改密码」：上游网关没有「忘记密码」接口
/// （`api/panel.rs` 明确写着那是删库重注册）。面板管理员的 bcrypt 哈希就在库里，
/// 清掉库就回到首次注册。
///
/// 会连带清空：账号、网关 Key、GitHub 令牌、日志、设置。调用方必须先确认。
fn factory_reset(state: &State) -> Result<(), String> {
    log("factory reset requested: stopping gateway");
    stop_child(state)?;

    let mut removed = 0usize;
    if let Ok(entries) = std::fs::read_dir(&state.home) {
        for entry in entries.flatten() {
            let path = entry.path();
            let Some(name) = path.file_name().and_then(|value| value.to_str()) else { continue };
            // 只删库文件与库外密钥：账号/配置都在 agent2api.db，密钥是 *.key。
            // supervisor.log / server.log 保留，排障还要看。
            let target = name == "agent2api.db"
                || name.starts_with("agent2api.db-")
                || name.ends_with(".key");
            if !target || !path.is_file() {
                continue;
            }
            match std::fs::remove_file(&path) {
                Ok(()) => {
                    removed += 1;
                    log(&format!("removed {}", path.display()));
                }
                Err(error) => return Err(format!("remove {}: {error}", path.display())),
            }
        }
    }
    log(&format!("factory reset removed {removed} file(s)"));

    // 起来的是一台空库网关：管理员未注册，App 打开就是首次注册页。
    start_child(state)
}

/// 写局域网开关并按需重启网关。
///
/// 改动只在网关重启后生效（与桌面端「改动需要重启应用生效」同一口径）；这里
/// 顺手把重启做完 —— 网关在跑就 stop + start，没在跑就只落盘。这样 App 一次
/// 调用就够，不必自己编排 stop/start 再去处理「停成功、起失败」的中间态。
fn set_lan(state: &State, enabled: bool) -> Result<(), String> {
    let path = settings_path(&state.home);
    let text = serde_json::json!({ "lan": enabled }).to_string();
    std::fs::write(&path, text).map_err(|error| format!("write {}: {error}", path.display()))?;
    log(&format!(
        "lan access = {enabled} (saved to {})",
        path.display()
    ));
    if is_running(state) {
        stop_child(state)?;
        start_child(state)?;
    }
    Ok(())
}

fn status_json(state: &State) -> String {
    let running = is_running(state);
    let lan = lan_enabled(&state.home);
    format!(
        "{{\"supervisor\":\"ok\",\"gateway\":\"{}\",\"port\":{},\"panelPort\":{},\"lan\":{},\"host\":\"{}\",\"heartbeat\":{}}}",
        if running { "running" } else { "stopped" },
        state.gateway_port,
        panel_port(state.gateway_port, lan),
        lan,
        gateway_host(lan),
        state.last_heartbeat.load(Ordering::SeqCst)
    )
}

fn handle(mut stream: TcpStream, state: Arc<State>) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(3)));
    let mut buffer = [0u8; 8192];
    let size = stream.read(&mut buffer).unwrap_or(0);
    let request = String::from_utf8_lossy(&buffer[..size]);
    let first = request.lines().next().unwrap_or("");
    let mut parts = first.split_whitespace();
    let method = parts.next().unwrap_or("");
    let path = parts.next().unwrap_or("");

    let (code, body) = match (method, path) {
        ("GET", "/health") | ("GET", "/status") => (200, status_json(&state)),
        ("GET", "/lan") => (200, format!("{{\"lan\":{}}}", lan_enabled(&state.home))),
        ("POST", "/lan") => match query_flag(path, "enabled") {
            Some(enabled) => match set_lan(&state, enabled) {
                Ok(()) => (200, status_json(&state)),
                Err(error) => {
                    log(&format!("set lan failed: {error}"));
                    (500, format!("{{\"supervisor\":\"error\",\"error\":{:?}}}", error))
                }
            },
            None => (
                400,
                "{\"supervisor\":\"error\",\"error\":\"missing enabled=0|1\"}".to_string(),
            ),
        },
        ("POST", "/start") => {
            state.last_heartbeat.store(now_ms(), Ordering::SeqCst);
            match start_child(&state) {
                Ok(()) => (200, status_json(&state)),
                Err(error) => {
                    log(&format!("start failed: {error}"));
                    (500, format!("{{\"supervisor\":\"error\",\"error\":{:?}}}", error))
                }
            }
        }
        ("POST", "/stop") => {
            state.last_heartbeat.store(0, Ordering::SeqCst);
            match stop_child(&state) {
                Ok(()) => (200, status_json(&state)),
                Err(error) => (500, format!("{{\"supervisor\":\"error\",\"error\":{:?}}}", error)),
            }
        }
        ("POST", "/heartbeat") => {
            state.last_heartbeat.store(now_ms(), Ordering::SeqCst);
            let result = start_child(&state);
            match result {
                Ok(()) => (200, status_json(&state)),
                Err(error) => {
                    log(&format!("heartbeat start failed: {error}"));
                    (500, format!("{{\"supervisor\":\"error\",\"error\":{:?}}}", error))
                }
            }
        }
        // 删库重注册。**破坏性操作**：App 侧必须让用户明确确认后再调用。
        ("POST", "/factory-reset") => {
            state.last_heartbeat.store(now_ms(), Ordering::SeqCst);
            match factory_reset(&state) {
                Ok(()) => (200, status_json(&state)),
                Err(error) => {
                    log(&format!("factory reset failed: {error}"));
                    (500, format!("{{\"supervisor\":\"error\",\"error\":{:?}}}", error))
                }
            }
        }
        _ => (404, "{\"error\":\"not found\"}".to_string()),
    };

    let response = format!(
        "HTTP/1.1 {code} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        if code == 200 { "OK" } else { "ERROR" },
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes());
}

fn main() {
    let gateway_port = std::env::var("AGENT2API_PROXY_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(3065);
    let control_port = std::env::var("AGENT2API_SUPERVISOR_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(3066);
    let home = std::env::var("AGENT2API_PROXY_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/var/mobile/Library/agent2api"));
    let _ = std::fs::create_dir_all(&home);

    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|parent| parent.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("/usr/local/bin"));
    let server_bin = std::env::var("AGENT2API_SERVER_BIN")
        .map(PathBuf::from)
        .unwrap_or_else(|_| exe_dir.join("agent2api-server"));
    let server_bin = if server_bin.is_file() {
        server_bin
    } else {
        PathBuf::from("/usr/local/bin/agent2api-server")
    };
    let ui = std::env::var("AGENT2API_UI_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/usr/local/share/agent2api/ui"));

    // Clear a gateway orphaned by a previous supervisor crash. The App will
    // send /start when it is active.
    let _ = Command::new("/usr/bin/killall")
        .args(["-9", "agent2api-server", "agent2api-providers", "agent2api-web-providers"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();

    let state = Arc::new(State {
        child: Mutex::new(None),
        last_heartbeat: AtomicI64::new(0),
        server_bin,
        home,
        ui,
        gateway_port,
    });

    let monitor = state.clone();
    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(2));
        let heartbeat = monitor.last_heartbeat.load(Ordering::SeqCst);
        if heartbeat > 0 && now_ms() - heartbeat > HEARTBEAT_TIMEOUT_MS {
            log("heartbeat timeout; stopping gateway");
            let _ = stop_child(&monitor);
        }
    });

    let listener = match TcpListener::bind(("127.0.0.1", control_port)) {
        Ok(listener) => listener,
        Err(error) => {
            log(&format!("bind control port {control_port}: {error}"));
            std::process::exit(1);
        }
    };
    log(&format!("listening on 127.0.0.1:{control_port}; gateway port {gateway_port}"));

    for stream in listener.incoming() {
        match stream {
            Ok(stream) => {
                let state = state.clone();
                thread::spawn(move || handle(stream, state));
            }
            Err(error) => log(&format!("accept: {error}")),
        }
    }
}
