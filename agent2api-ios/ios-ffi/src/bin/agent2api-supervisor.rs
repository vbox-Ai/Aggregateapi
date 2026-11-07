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

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

const HEARTBEAT_TIMEOUT_MS: i64 = 15_000;
const START_TIMEOUT: Duration = Duration::from_secs(15);

struct State {
    child: Mutex<Option<Child>>,
    last_heartbeat: AtomicI64,
    server_bin: PathBuf,
    home: PathBuf,
    ui: PathBuf,
    gateway_port: u16,
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

    log(&format!("starting gateway {}", state.server_bin.display()));
    let mut command = Command::new(&state.server_bin);
    command
        .env("AGENT2API_PROXY_HOME", &state.home)
        .env("HOME", &state.home)
        .env("AGENT2API_UI_DIR", &state.ui)
        .env("AGENT2API_HOST", "127.0.0.1")
        .env("AGENT2API_PROXY_PORT", state.gateway_port.to_string())
        .env("AGENT2API_ALLOW_EXEC", "1")
        .env("AGENT2API_INPROC", "1")
        .env("AGENT2API_ALLOW_UNSIGNED_PLUGIN_INSTALL", "1")
        .env("AGENT2API_DEPLOY", "ios")
        .env("AGENT2API_SELF_UPDATE", "0")
        .stdout(Stdio::from(log_file))
        .stderr(Stdio::from(log_err));
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

fn status_json(state: &State) -> String {
    let mut running = false;
    if let Ok(mut guard) = state.child.lock() {
        let mut child_state = 0u8;
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
    format!(
        "{{\"supervisor\":\"ok\",\"gateway\":\"{}\",\"port\":{},\"heartbeat\":{}}}",
        if running { "running" } else { "stopped" },
        state.gateway_port,
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
