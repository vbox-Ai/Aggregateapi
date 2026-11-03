//! Agent2API 宿主能力抽象（L1 层的平台边界）。
//!
//! ── 这个 crate 解决什么问题 ────────────────────────────────
//! 网关本体是纯业务（axum / providers / SQLite / rustls），但历史实现里
//! 有四处把「平台」漏了出来：
//!   1. `core/sub_kernel/runtime.rs`（mihomo sidecar）—— `std::process::Command`
//!   2. `providers/qoder/risk.rs`（runtime-info 子进程）—— 同上
//!   3. 插件 loader（`{plugins}/android-bin/<id>/…`）—— 直接 exec ELF
//!   4. `providers/autoclaw/crypto.rs` —— `cfg(windows)` 的 DPAPI 导入
//! 这四处一旦放进业务代码，iOS / Web 就没法编、也没法优雅降级。
//!
//! 本 crate 的做法：**能力表（Capabilities）+ 六个动作（Host trait）**。
//!   · 能做的平台：实现对应方法；
//!   · 不能做的平台：什么都不写，直接用 trait 默认实现 → `Unsupported`；
//!   · 路由层把 `Unsupported` 统一映射成 **HTTP 501** + 机读的 `feature` 字段，
//!     界面据此渲染"该功能在本端不可用"，而不是抛 500 或静默假成功。
//!
//! ── 为什么用「能力表」而不是 `cfg!(target_os)` 判断 ─────────
//! `cfg!` 是编译期的，**同一份产物在不同形态下能力不同**（最典型：iOS 的
//! daemon 形态能开回环端口、App 沙盒形态也能，但两者都不能 exec 子进程；
//! Android 的 KSU 形态能 exec 插件、APK 形态不能）。所以能力必须是**运行期
//! 可查询的**，由壳在启动时声明，再由 `GET /api/host` 暴露给 UI。

use std::path::PathBuf;

// ─────────────────────────────────────────────────────────────
// 平台与形态
// ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Platform {
    Windows,
    MacOs,
    Linux,
    Android,
    Ios,
    Web,
    Unknown,
}

impl Platform {
    pub fn as_str(self) -> &'static str {
        match self {
            Platform::Windows => "windows",
            Platform::MacOs => "macos",
            Platform::Linux => "linux",
            Platform::Android => "android",
            Platform::Ios => "ios",
            Platform::Web => "web",
            Platform::Unknown => "unknown",
        }
    }

    /// 编译期推断的默认值（运行期可由壳用 `AGENT2API_HOST_PLATFORM` 覆盖）
    pub fn detect() -> Self {
        if cfg!(target_os = "windows") {
            Platform::Windows
        } else if cfg!(target_os = "macos") {
            Platform::MacOs
        } else if cfg!(target_os = "ios") {
            Platform::Ios
        } else if cfg!(target_os = "android") {
            Platform::Android
        } else if cfg!(target_arch = "wasm32") {
            Platform::Web
        } else if cfg!(target_os = "linux") {
            Platform::Linux
        } else {
            Platform::Unknown
        }
    }
}

/// 宿主形态：同一个平台可能有多种形态（Android 有 KSU 与 APK，iOS 有 daemon 与壳内嵌）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Form {
    /// 独立常驻进程（Windows 托盘 / macOS LaunchAgent / Linux systemd / Android KSU / iOS launchd）
    Daemon,
    /// 跑在 GUI 进程里（Tauri 壳 / App 内嵌 staticlib）
    Embedded,
    /// 纯浏览器（无壳、无本地后端）
    Browser,
    /// 未知
    Unknown,
}

impl Form {
    pub fn as_str(self) -> &'static str {
        match self {
            Form::Daemon => "daemon",
            Form::Embedded => "embedded",
            Form::Browser => "browser",
            Form::Unknown => "unknown",
        }
    }
}

/// 本地密钥库形态：决定「导入桌面端登录态」这类功能能不能做
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SecureStore {
    /// Windows DPAPI（`CryptUnprotectData`）
    Dpapi,
    /// Apple Keychain / Secure Enclave 包一层
    Keychain,
    /// 文件 + 进程内派生密钥（`account.key`，现有实现）
    File,
    /// 浏览器 IndexedDB / localStorage（最弱，仅避免明文落盘）
    Browser,
    None,
}

impl SecureStore {
    pub fn as_str(self) -> &'static str {
        match self {
            SecureStore::Dpapi => "dpapi",
            SecureStore::Keychain => "keychain",
            SecureStore::File => "file",
            SecureStore::Browser => "browser",
            SecureStore::None => "none",
        }
    }
}

// ─────────────────────────────────────────────────────────────
// 能力表
// ─────────────────────────────────────────────────────────────

/// 六端能力表。字段名与 `GET /api/host` 的 JSON 一一对应，
/// UI 侧（`ui/host.js`）据此决定渲染什么、灰掉什么。
#[derive(Debug, Clone)]
pub struct Capabilities {
    pub platform: Platform,
    pub form: Form,

    /// 能否 exec 外部二进制：插件、mihomo sidecar、qoder runtime-info 全靠它
    pub exec_helpers: bool,
    /// 插件系统（provider pack）可用。iOS/Web 恒 false
    pub plugins: bool,
    /// 订阅内核（mihomo sidecar）可用
    pub sidecar: bool,
    /// 能否提供"一次性 cookie 罐"的隔离登录窗口
    pub isolated_login: bool,
    /// 文件对话框（导入 .a2ab / 导入客户端配置 / 选目录）
    pub file_dialogs: bool,
    /// 系统通知（后台任务完成、账号需重登）
    pub notifications: bool,
    /// 能否原地自更新（iOS/Android APK 恒 false；KSU 走重刷 zip）
    pub self_update: bool,
    /// 能否"跟随系统代理"（iOS 上 `system-configuration` 不可用，恒 false）
    pub system_proxy: bool,
    /// 能否在界面上改监听端口并重启生效
    pub port_change: bool,
    /// 能否绑定回环端口（Web 恒 false）
    pub loopback_bind: bool,
    /// 本地密钥库形态
    pub secure_store: SecureStore,
}

impl Default for Capabilities {
    fn default() -> Self {
        let platform = Platform::detect();
        Self::for_platform(platform, Form::Daemon)
    }
}

impl Capabilities {
    /// 各平台的"合理默认"：壳可以在此基础上覆盖（例如 Android APK 形态要关掉 plugins）
    pub fn for_platform(platform: Platform, form: Form) -> Self {
        let desktop = matches!(platform, Platform::Windows | Platform::MacOs | Platform::Linux);
        let mobile_native = matches!(platform, Platform::Android | Platform::Ios);

        Self {
            platform,
            form,
            // 移动端沙盒禁止 exec 任意可执行体；Android 的 KSU 形态由壳显式打开
            exec_helpers: desktop,
            plugins: desktop,
            sidecar: desktop,
            // 桌面壳/移动壳都能开一次性容器；纯浏览器只能新标签 + 轮询
            isolated_login: !matches!(form, Form::Browser),
            file_dialogs: !matches!(form, Form::Browser),
            notifications: !matches!(form, Form::Browser),
            self_update: desktop,
            system_proxy: !matches!(platform, Platform::Ios),
            port_change: !matches!(form, Form::Browser),
            loopback_bind: !matches!(form, Form::Browser),
            secure_store: match platform {
                Platform::Windows => SecureStore::Dpapi,
                Platform::MacOs | Platform::Ios => SecureStore::Keychain,
                Platform::Linux | Platform::Android => SecureStore::File,
                Platform::Web => SecureStore::Browser,
                Platform::Unknown => SecureStore::None,
            },
        }
        .with_form_adjustments(mobile_native)
    }

    fn with_form_adjustments(mut self, mobile_native: bool) -> Self {
        if mobile_native {
            // 移动端默认关掉"需要子进程/自更新"的能力，等壳显式声明
            self.exec_helpers = false;
            self.plugins = false;
            self.sidecar = false;
            self.self_update = false;
        }
        if matches!(self.form, Form::Browser) {
            self.exec_helpers = false;
            self.plugins = false;
            self.sidecar = false;
            self.loopback_bind = false;
            self.port_change = false;
        }
        self
    }

    /// 手写 JSON（本 crate 零依赖）；字段顺序即文档顺序
    pub fn to_json(&self) -> String {
        format!(
            concat!(
                "{{\"platform\":\"{}\",\"form\":\"{}\",",
                "\"execHelpers\":{},\"plugins\":{},\"sidecar\":{},",
                "\"isolatedLogin\":{},\"fileDialogs\":{},\"notifications\":{},",
                "\"selfUpdate\":{},\"systemProxy\":{},\"portChange\":{},",
                "\"loopbackBind\":{},\"secureStore\":\"{}\"}}"
            ),
            self.platform.as_str(),
            self.form.as_str(),
            self.exec_helpers,
            self.plugins,
            self.sidecar,
            self.isolated_login,
            self.file_dialogs,
            self.notifications,
            self.self_update,
            self.system_proxy,
            self.port_change,
            self.loopback_bind,
            self.secure_store.as_str(),
        )
    }

    /// 给路由层做"功能闸门"用：能力不足时返回 `Err(Unsupported)`
    pub fn require(&self, feature: Feature) -> Result<(), HostError> {
        let ok = match feature {
            Feature::Plugins => self.plugins,
            Feature::Sidecar => self.sidecar,
            Feature::ExecHelpers => self.exec_helpers,
            Feature::IsolatedLogin => self.isolated_login,
            Feature::FileDialogs => self.file_dialogs,
            Feature::Notifications => self.notifications,
            Feature::SelfUpdate => self.self_update,
            Feature::SystemProxy => self.system_proxy,
            Feature::PortChange => self.port_change,
            Feature::LoopbackBind => self.loopback_bind,
        };
        if ok {
            Ok(())
        } else {
            Err(HostError::Unsupported {
                feature: feature.as_str(),
                platform: self.platform.as_str(),
            })
        }
    }
}

/// 能力项（与 `Capabilities` 字段一一对应，供 `require()` 用）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Feature {
    Plugins,
    Sidecar,
    ExecHelpers,
    IsolatedLogin,
    FileDialogs,
    Notifications,
    SelfUpdate,
    SystemProxy,
    PortChange,
    LoopbackBind,
}

impl Feature {
    pub fn as_str(self) -> &'static str {
        match self {
            Feature::Plugins => "plugins",
            Feature::Sidecar => "sidecar",
            Feature::ExecHelpers => "execHelpers",
            Feature::IsolatedLogin => "isolatedLogin",
            Feature::FileDialogs => "fileDialogs",
            Feature::Notifications => "notifications",
            Feature::SelfUpdate => "selfUpdate",
            Feature::SystemProxy => "systemProxy",
            Feature::PortChange => "portChange",
            Feature::LoopbackBind => "loopbackBind",
        }
    }
}

// ─────────────────────────────────────────────────────────────
// 错误：一处定义，路由层统一映射 HTTP 状态
// ─────────────────────────────────────────────────────────────

#[derive(Debug)]
pub enum HostError {
    /// 本平台/本形态不支持该能力 —— 路由层映射 501，不算 bug
    Unsupported { feature: &'static str, platform: &'static str },
    /// 系统调用失败（spawn 失败、路径不可写…）—— 映射 500
    Io(String),
    /// 平台明确拒绝（用户取消对话框、沙盒禁止）—— 映射 403
    Denied(String),
}

impl HostError {
    pub fn http_status(&self) -> u16 {
        match self {
            HostError::Unsupported { .. } => 501,
            HostError::Denied(_) => 403,
            HostError::Io(_) => 500,
        }
    }

    /// 机读错误体：`{"error":"unsupported","feature":"sidecar","platform":"ios"}`
    pub fn to_json(&self) -> String {
        match self {
            HostError::Unsupported { feature, platform } => format!(
                "{{\"error\":\"unsupported\",\"feature\":\"{feature}\",\"platform\":\"{platform}\"}}"
            ),
            HostError::Denied(msg) => {
                format!("{{\"error\":\"denied\",\"message\":\"{}\"}}", escape(msg))
            }
            HostError::Io(msg) => format!("{{\"error\":\"io\",\"message\":\"{}\"}}", escape(msg)),
        }
    }
}

fn escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n")
}

// ─────────────────────────────────────────────────────────────
// 宿主 trait：六个动作
// ─────────────────────────────────────────────────────────────

/// 外部 helper 的启动规格（插件 / sidecar / runtime-info 共用）
#[derive(Debug, Clone)]
pub struct HelperSpec {
    /// 绝对路径
    pub program: PathBuf,
    pub args: Vec<String>,
    /// 额外环境变量（例如插件的 `AGENT2API_PLUGIN_HOME`）
    pub env: Vec<(String, String)>,
    /// 是否把 stdio 接成管道（插件是帧协议，必须 true）
    pub piped_stdio: bool,
    /// 可读的标识，只用于日志与错误信息（`plugin:atomcode`、`sidecar:mihomo`）
    pub label: String,
}

/// 启动成功的句柄：`pid` 用于杀进程，`label` 用于日志
#[derive(Debug, Clone)]
pub struct ChildHandle {
    pub pid: u32,
    pub label: String,
}

/// 宿主抽象。**默认实现全部返回 Unsupported**——平台只要实现自己能做的，
/// 做不了的自然退化到 501，不需要在每个平台上写一堆 `#[cfg]` 空函数。
pub trait Host: Send + Sync {
    fn capabilities(&self) -> &Capabilities;

    /// 数据目录（`AGENT2API_PROXY_HOME` 优先，其次平台约定目录）
    fn data_dir(&self) -> PathBuf;

    /// 起一个外部 helper。iOS / Web 恒返回 Unsupported。
    fn exec_helper(&self, spec: &HelperSpec) -> Result<ChildHandle, HostError> {
        Err(HostError::Unsupported {
            feature: "execHelpers",
            platform: self.capabilities().platform.as_str(),
        })
    }

    /// 杀掉 helper（面板"停插件"、sidecar 重启用）
    fn kill_helper(&self, _pid: u32) -> Result<(), HostError> {
        Err(HostError::Unsupported {
            feature: "execHelpers",
            platform: self.capabilities().platform.as_str(),
        })
    }

    /// 导入平台专有加密的登录态（目前只有 Windows DPAPI 的 Electron `os_crypt`）
    fn import_secret(&self, _kind: SecretKind, _blob: &[u8]) -> Result<Vec<u8>, HostError> {
        Err(HostError::Unsupported {
            feature: "secureStore",
            platform: self.capabilities().platform.as_str(),
        })
    }

    /// 系统通知
    fn notify(&self, _title: &str, _body: &str) -> Result<(), HostError> {
        Err(HostError::Unsupported {
            feature: "notifications",
            platform: self.capabilities().platform.as_str(),
        })
    }

    /// 用系统浏览器/默认应用打开 URL（登录兜底、更新说明页）
    fn open_external(&self, _url: &str) -> Result<(), HostError> {
        Err(HostError::Unsupported {
            feature: "openExternal",
            platform: self.capabilities().platform.as_str(),
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SecretKind {
    /// Electron safeStorage 的 `os_crypt`（AES-256-GCM + DPAPI 包 key）
    ElectronOsCrypt,
    /// Chromium 的 `Local State` 加密段
    ChromiumLocalState,
    /// 明文（不应出现，仅用于统一入口）
    Plain,
}

// ─────────────────────────────────────────────────────────────
// 通用实现：一个"原生进程"宿主，能力表由构造函数注入
// ─────────────────────────────────────────────────────────────

/// 适用于所有"本机能跑进程"的形态：Win / macOS / Linux / Android(KSU) / iOS(daemon)。
/// 唯一差别就是构造时传进来的 `Capabilities`。
pub struct NativeHost {
    caps: Capabilities,
    data_dir: PathBuf,
}

impl NativeHost {
    pub fn new(caps: Capabilities, data_dir: PathBuf) -> Self {
        Self { caps, data_dir }
    }

    /// 从环境推断：`AGENT2API_PROXY_HOME`（数据目录）+ `AGENT2API_HOST_FORM`（形态）
    pub fn from_env() -> Self {
        let platform = std::env::var("AGENT2API_HOST_PLATFORM")
            .ok()
            .and_then(|v| match v.as_str() {
                "windows" => Some(Platform::Windows),
                "macos" => Some(Platform::MacOs),
                "linux" => Some(Platform::Linux),
                "android" => Some(Platform::Android),
                "ios" => Some(Platform::Ios),
                "web" => Some(Platform::Web),
                _ => None,
            })
            .unwrap_or_else(Platform::detect);

        let form = std::env::var("AGENT2API_HOST_FORM")
            .ok()
            .and_then(|v| match v.as_str() {
                "daemon" => Some(Form::Daemon),
                "embedded" => Some(Form::Embedded),
                "browser" => Some(Form::Browser),
                _ => None,
            })
            .unwrap_or(Form::Daemon);

        let mut caps = Capabilities::for_platform(platform, form);
        // KSU 形态：壳显式声明"我可以 exec 插件二进制"
        if std::env::var("AGENT2API_HOST_EXEC").map(|v| v.trim() == "1").unwrap_or(false) {
            caps.exec_helpers = true;
            caps.plugins = true;
        }
        let data_dir = crate_data_dir();
        Self::new(caps, data_dir)
    }
}

fn crate_data_dir() -> PathBuf {
    for key in ["AGENT2API_PROXY_HOME", "WORKBUDDY_PROXY_HOME"] {
        if let Ok(value) = std::env::var(key) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return PathBuf::from(trimmed);
            }
        }
    }
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".agent2api")
}

impl Host for NativeHost {
    fn capabilities(&self) -> &Capabilities {
        &self.caps
    }

    fn data_dir(&self) -> PathBuf {
        self.data_dir.clone()
    }

    fn exec_helper(&self, spec: &HelperSpec) -> Result<ChildHandle, HostError> {
        self.caps.require(Feature::ExecHelpers)?;

        let mut cmd = std::process::Command::new(&spec.program);
        cmd.args(&spec.args);
        for (k, v) in &spec.env {
            cmd.env(k, v);
        }
        if spec.piped_stdio {
            cmd.stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped());
        }

        let child = cmd.spawn().map_err(|e| {
            HostError::Io(format!("启动 {} 失败：{e}（{}）", spec.label, spec.program.display()))
        })?;
        Ok(ChildHandle { pid: child.id(), label: spec.label.clone() })
    }

    fn kill_helper(&self, pid: u32) -> Result<(), HostError> {
        self.caps.require(Feature::ExecHelpers)?;
        #[cfg(unix)]
        {
            // SAFETY: kill(2) 对任意 pid 都是安全的；pid 来自我们自己 spawn 的 child
            unsafe { libc_kill(pid as i32, 15) };
            Ok(())
        }
        #[cfg(windows)]
        {
            // Windows 侧用 `taskkill /PID` 兜底（上游已因杀软误报改成 Win32 API，
            // 这里留 TODO：照抄 `desktop-tauri` 里 TerminateProcess 那段）
            let _ = pid;
            Err(HostError::Io("Windows 侧 kill 待接入 TerminateProcess".into()))
        }
        #[cfg(not(any(unix, windows)))]
        {
            let _ = pid;
            Err(HostError::Unsupported { feature: "execHelpers", platform: "unknown" })
        }
    }

    fn notify(&self, title: &str, body: &str) -> Result<(), HostError> {
        self.caps.require(Feature::Notifications)?;
        // 各端实现留给壳（Tauri notification plugin / UILocalNotification / Android Notification），
        // 网关只负责把"要通知什么"表达出来：先写日志，壳可轮询 /api/logs?level=notify
        eprintln!("[notify] {title}: {body}");
        Ok(())
    }
}

#[cfg(unix)]
extern "C" {
    #[link_name = "kill"]
    fn libc_kill(pid: i32, sig: i32) -> i32;
}

// ─────────────────────────────────────────────────────────────
// 测试：能力表与闸门的语义必须与文档一致
// ─────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ios_daemon_has_no_exec_but_has_login() {
        let caps = Capabilities::for_platform(Platform::Ios, Form::Daemon);
        assert!(!caps.exec_helpers);
        assert!(!caps.plugins);
        assert!(!caps.sidecar);
        assert!(!caps.self_update);
        assert!(caps.isolated_login);
        assert!(caps.loopback_bind);
        assert!(caps.require(Feature::Plugins).is_err());
        assert!(caps.require(Feature::LoopbackBind).is_ok());
    }

    #[test]
    fn android_ksu_can_exec_after_explicit_opt_in() {
        let mut caps = Capabilities::for_platform(Platform::Android, Form::Daemon);
        assert!(!caps.plugins);
        caps.exec_helpers = true;
        caps.plugins = true;
        assert!(caps.require(Feature::Plugins).is_ok());
    }

    #[test]
    fn browser_cannot_bind_or_exec() {
        let caps = Capabilities::for_platform(Platform::Web, Form::Browser);
        assert!(!caps.loopback_bind);
        assert!(!caps.plugins);
        assert!(!caps.isolated_login);
        assert!(!caps.file_dialogs);
    }

    #[test]
    fn unsupported_maps_to_501_and_has_feature_field() {
        let err = HostError::Unsupported { feature: "sidecar", platform: "ios" };
        assert_eq!(err.http_status(), 501);
        assert!(err.to_json().contains("\"feature\":\"sidecar\""));
    }

    #[test]
    fn capabilities_json_is_stable() {
        let caps = Capabilities::for_platform(Platform::Windows, Form::Daemon);
        let json = caps.to_json();
        assert!(json.starts_with("{\"platform\":\"windows\",\"form\":\"daemon\""));
        assert!(json.contains("\"secureStore\":\"dpapi\""));
    }
}
