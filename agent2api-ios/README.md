# Agent2API · iOS 17.0（越狱）移植工程

把 `agent2api-ksu-module.zip`（Android/KernelSU 模块）搬到 iOS 的完整落地件。
先读 `方案报告.md`（结论、证据链、可行性矩阵、风险表），这里是"怎么用"。

## 一句话

Android 模块里的二进制是 ELF（glibc / bionic），iOS 只认 Mach-O，**不能打包、只能重编译**；
网关本体是纯 Rust 独立 crate，重编译后 100% 可用；`plugins-bin/*` 那两个 ELF 插件不可用。

## 组件对照

| Android 模块 | iOS 对应 | 文件 |
|---|---|---|
| `service.sh` / `boot-completed.sh` | LaunchDaemon `RunAtLoad` | `daemon/com.chiyu.agent2api.plist` |
| `supervisor.sh`（守护 + 退避重启） | `KeepAlive{SuccessfulExit=false}` + `ThrottleInterval=5` | 同上 |
| `control.sh start/stop/status` | `launchctl bootstrap / bootout / kickstart -k / print` | `scripts/install-daemon.sh` |
| `bin/agent2api-server`（glibc ELF + `glibc/` 运行时） | `cargo build --target aarch64-apple-ios`（Mach-O，无运行时依赖） | — |
| `ui/`（面板静态资源） | 守护进程托管 `AGENT2API_UI_DIR`；A2 形态打进 bundle | `UI_SRC` |
| `webroot/`（KernelSU WebUI） | WKWebView 壳 | `app/Agent2API/PanelViewController.swift` |
| `apk/Agent2Login.apk`（隔离登录器） | `WKWebsiteDataStore.nonPersistent()` 容器 | `app/Agent2API/LoginContainer.swift` |
| `patch-ui.sh`（sed 注入 `A2A_LOGIN_OPEN`） | `WKUserScript` 在 document-start 锁死该函数 | `app/Agent2API/Bridge.swift` |
| `dns.sh`（resolv.conf 三件套） | 不需要（iOS 走 mDNSResponder） | — |
| `sepolicy.rule` | 不需要（越狱无 SELinux） | — |
| `ksud module config` | plist 的 `EnvironmentVariables` | 同上 |

## 三步上手

### 0. 环境自检（手机上）

```sh
uname -a; sw_vers; id; ls -d /var/jb; which ldid launchctl
sysctl -n hw.cputype hw.cpusubtype     # 16777228/0=arm64  /2=arm64e
```

### 1. 编守护进程（macOS）

```bash
git clone https://github.com/aimod-cc/Agent2API.git
cd Agent2API/desktop-tauri/src-tauri
rustup target add aarch64-apple-ios
# 先按 方案报告.md §5 Step 2 打两个 iOS 补丁（reqwest system-proxy / 子进程 cfg）
IPHONEOS_DEPLOYMENT_TARGET=15.0 cargo build -p agent2api-server --release --target aarch64-apple-ios
file target/aarch64-apple-ios/release/agent2api-server   # → Mach-O 64-bit executable arm64
```

### 2. 装到手机

```bash
DEV=root@<手机IP> UI_SRC=<解压出来的>/ui ./scripts/install-daemon.sh
# 期望最后打印 ✅ {"status":"ok"}
```

### 3. 编 IPA

```bash
EMBED=0 ./scripts/build-ipa.sh     # 纯客户端壳（推荐先跑这个，验证面板渲染）
EMBED=1 ./scripts/build-ipa.sh     # 内嵌网关（离线形态，需先编 ios-ffi）
appinst build/Agent2API.ipa        # 或 TrollStore
```

## 形态速查

| 形态 | 后端在哪 | IPA 需要 Rust | 熄屏常驻 | 适用 |
|---|---|---|---|---|
| A1（默认） | LaunchDaemon | 不需要 | ✅ | 当成"手机上的网关"长期用 |
| A2 | App 进程内（`ios-ffi`） | 需要（staticlib） | ❌ | 临时用、无越狱权限装守护进程时 |
| B | 另一台机器（Android/PC/VPS） | 不需要 | — | 立刻能用，`baseURL` 改一行 |
| C（PWA） | 另一台机器 | 不需要 | — | Safari 添加到主屏幕，零代码 |

## 会掉的功能（白纸黑字）

1. **插件 provider**：`plugins-bin/agent2api-providers`、`agent2api-web-providers` 是 Android/Linux ELF，iOS 无法 exec。面板里插件页请隐藏，或删掉 `plugins/` 目录。
2. **订阅内核（mihomo sidecar）**：`core/sub_kernel` 下载后 spawn 独立二进制。iOS 上点"下载内核"会报错（已在补丁里改成显式 `Err`）。要这个功能走 `方案报告.md` §7 的 Linux VM 路线。
3. **Qoder 国际版签到的 `runtime-info` 子进程**：同理，降级为"需重登"。
4. **面板自更新**：`AGENT2API_SELF_UPDATE` 必须为 `0`（它会拉 glibc ELF 覆盖自身）。升级方式 = 重编 + `launchctl kickstart -k system/com.chiyu.agent2api`。

## 常见故障

| 现象 | 原因 | 处理 |
|---|---|---|
| App 白屏，控制台报 ATS blocked cleartext | `Info.plist` 的 ATS 例外没生效 | 确认 `NSExceptionDomains → 127.0.0.1 → NSExceptionAllowsInsecureHTTPLoads` |
| `curl health` 通，App 白屏 | App 在加载 `/` 桌面版布局 | 用 `/m`（`PanelViewController.reload()` 已指向 `/m`） |
| 守护进程起来就 exit | AMFI 拒签名 | `ldid -S /var/jb/usr/local/bin/agent2api-server`；看 `launchctl print system/com.chiyu.agent2api` 的 last exit reason |
| 面板能开但写库失败 | 数据目录属主不对 | `chown -R mobile:mobile /var/mobile/Library/agent2api`（plist 里 `UserName=mobile` 必须与之一致） |
| 面板卡在"等待账号登录完成…" | 登录容器没接管 | 检查 `Bridge.loginOpenScript` 是否注入；`window.A2A_LOGIN_OPEN` 应打印 `function` |
| 重启后网关不在 | plist 权限/属主不对 | `chown root:wheel`、`chmod 644`，`launchctl bootstrap system ...` |
