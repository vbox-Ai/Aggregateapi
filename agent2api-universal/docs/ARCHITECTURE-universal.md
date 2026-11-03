# Agent2API 全平台通用架构（Windows / macOS / Linux / Android / iOS / Web）

> 目标：**一份网关 + 一份 UI + N 个薄壳**。同一份 Rust 代码编到六个平台，同一份面板代码跑在六个壳里，
> 数据（`.a2ab` 备份）能跨端互导。不是"六套代码各写一遍"。

---

## 0. 先纠正一个前提（否则后面全是白工）

"六端通用"里有一端必须重新定义：**Web（纯浏览器）不能跑后端**。

| 想在浏览器里跑网关 | 现实 |
|---|---|
| 需要监听本地端口 | 浏览器没有 listen API |
| 需要直连各上游（WorkBuddy/ZCode/Qoder…） | 全部撞 CORS + 三方 Cookie 限制（第三方站点不会给你 `Access-Control-Allow-Origin`） |
| 需要伪造客户端指纹/风控头 | `fetch` 里能设的 header 是受限集合，`User-Agent`、`Cookie`、`Referer` 都被禁 |
| 需要 SQLite | 只能 IndexedDB/WASM sqlite，且无法与 `reqwest` 那套 TLS/连接池共用代码 |

结论：**Web 端的正确定位是"远程客户端 + 自托管面板"**，不是"浏览器里跑网关"。
所以六端不是"六个后端"，而是：

```
后端 1 份  ── 原生跑在 Win / macOS / Linux / Android(root) / iOS(daemon) 上，或跑在 Docker/VPS 里给 Web 端用
UI   1 份  ── 随后端自托管（浏览器直接访问，本来就是 PWA）
壳   N 个  ── 只负责：起停后端、给 WebView 容器、提供平台能力（隔离登录/文件对话框/通知/更新）
```

---

## 1. 上游已经给了你 80% 的地基（这是最容易忽略的好消息）

我读了上游源码，`window.workbuddyDesktop` **就是现成的宿主抽象层**，而且已经有两套实现：

| 文件 | 角色 |
|---|---|
| `desktop-tauri/src-tauri/src/bridge.rs` | 桌面壳实现：Tauri IPC → 壳 → 网关 |
| `desktop-tauri/server/src/web_shim.rs`（127 KB） | **无壳实现**：纯 HTTP 的 `window.workbuddyDesktop`，由 `static_files` 注入 index.html |

`web_shim.rs` 的模块注释把设计原则写得很清楚：

> 界面代码只依赖 `window.workbuddyDesktop` 这个接口 … headless 形态没有壳：本模块生成一份**纯 HTTP** 的同接口实现 … 「界面不感知壳」的既有设计在这里兑现。

它还已经把"壳才能做的事"逐个降级了（窗口主题、托盘、改端口、更新安装、文件对话框 → 能映射则映射，不能就明确拒绝并给可读文案，**绝不静默假成功**）。

我从 `web_shim.rs` 里提取到 **约 170 个方法**，按性质分两类：

**A. 平台无关（≈155 个）**：全部是 `fetch → /api/*` 的薄包装
`getAccounts / startLogin / createKey / getRoutingConfig / saveAutoCheckin / runCheckinSchedule / getStatsRequests / exportAccounts / importDatabase / getUpgrade / startAutoclawOauth …`

**B. 真正平台相关（≈15 个）**：六个端各写一份，一共就这些

| 方法 | Win | macOS | Linux | Android(KSU) | Android(APK) | iOS(daemon+App) | Web |
|---|---|---|---|---|---|---|---|
| `pickFolder` / `importAgentClient`（文件对话框） | ✅ | ✅ | ✅ | 降级为路径输入 | ✅ SAF | ✅ UIDocumentPicker | ❌ 拒绝 |
| `windowClose / windowToggleMaximize / setWindowTheme` | ✅ | ✅ | ✅ | ❌ 无窗口 | ✅ | ✅ | ❌ |
| `restartApp / restartService` | ✅ | ✅ | ✅ | `control.sh`→`launchctl` 等价 | 重启前台 Service | `launchctl kickstart` | ❌ |
| `changePort` | ✅ | ✅ | ✅ | ksud config | 设置页 | 写 plist + kickstart | ❌ |
| `runInstaller / downloadUpdate / checkUpdate` | ✅ | ✅ | ✅ | 重刷 zip | APK 更新 | 重编 + 重签 | ❌ |
| `startLogin`（**隔离登录容器**） | 壳开子窗口 | 壳开子窗口 | 同 | `agent2api://login` intent | 同 | `nonPersistent` WKWebView | 新标签 + 轮询 |
| `getPortOccupant / endPortOccupant` | Win32 API | lsof | lsof | /proc | 无 | lsof | ❌ |
| `getLoginState`（壳侧登录态） | 进程内 | 进程内 | 进程内 | localStorage | localStorage | localStorage | localStorage |

也就是说：**要做"六端通用"，不需要重写 UI，只需要把 B 类那 15 个方法按端补齐 + 把能力做成可查询的**。
上游 `patch-ui.sh` 之所以要 sed 打补丁，本质就是因为 iOS/Android 壳当时没有 B 类里的 `startLogin` 原生实现，只能靠注入 `A2A_LOGIN_OPEN` 绕。这个绕法应当被"正式接口"取代。

---

## 2. 目标架构（三层 + 一份契约）

```
┌──────────────────────────────────────────────────────────────────────┐
│ L3  壳层（每个端一份，只做平台能力，不含业务）                          │
│  Win/macOS/Linux/Android/iOS: Tauri 2 单壳代码（src-tauri）            │
│  Android(root): 另加 KSU 模块形态（supervisor/launch 等价 + 插件 exec） │
│  iOS(sandbox): 另加 LaunchDaemon 形态（网关不能死在挂起里）             │
│  Web: 无壳，浏览器直连后端                                             │
├──────────────────────────────────────────────────────────────────────┤
│ L2  契约层（唯一的平台接口）：window.workbuddyDesktop + HostCapabilities│
│  · 155 个平台无关方法：一律 HTTP → /api/*                              │
│  · 15 个平台相关方法：壳实现，缺能力时返回 { unsupported, feature }     │
│  · 能力表：GET /api/host → 用于能力驱动 UI（隐藏/灰掉而不是报错）       │
├──────────────────────────────────────────────────────────────────────┤
│ L1  网关层（一份 Rust crate，编到 6 个 target）                        │
│  axum 路由 / 23 家 provider / SQLite / rustls / 调度 / 报表             │
│  平台差异全部收敛到 host-api：exec_helper / 密钥库 / system-proxy / 路径 │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.1 L1 平台差异收敛（这是唯一需要动 Rust 本体的地方）

现状（我读代码确认的四处"漏出"）：

| 位置 | 现状 | 改成 |
|---|---|---|
| `paths.rs` | `AGENT2API_PROXY_HOME` > `WORKBUDDY_PROXY_HOME` > `$HOME/.agent2api` | 保留（已经很干净）；壳侧统一注入，不需要改 |
| `core/sub_kernel/runtime.rs`、`providers/qoder/risk.rs` | 直接 `std::process::Command` spawn | `Host::exec_helper(spec)`，不支持 → `HostError::Unsupported` |
| 插件 loader（`{plugins}/android-bin/<id>/…`） | 直接 exec ELF | 同上，且加 `capabilities.plugins` 判定 |
| `core/providers/autoclaw/crypto.rs` | `cfg(windows)` DPAPI | 收进 `SecretImporter`，其它平台返回 `Unsupported`（现在已是桩，统一错误码即可） |
| `Cargo.toml` 的 `reqwest/system-proxy` | 全平台一份 | `cfg(target_os="ios")` 关闭（`system-configuration` 在 iOS SDK 上易挂） |

工程落法（不 fork 上游也能做）：

```
新 crate: crates/host-api          ← 本次已交付骨架
  pub trait Host { capabilities() / data_dir() / exec_helper() / import_secret() / notify() / open_external() }
  pub struct Capabilities { platform, form, exec_helpers, sidecar, isolated_login,
                            file_dialogs, notifications, self_update, system_proxy, port_change,
                            secure_store, loopback_bind }
  pub enum HostError { Unsupported { feature: &'static str }, Io(...), ... }
  impl HostError { pub fn http_status(&self) -> u16 { match self { Unsupported{..} => 501, ... } } }
```

然后在 `server` 里加 `host: Arc<dyn Host>` 到 `ServerState`（或全局 `OnceLock`，与 `proxy_pool::install` / `sub_kernel::install` 同形态——上游已有这种"进程级句柄"范式，照抄即可）。

### 2.2 L2 契约层（能力驱动，而不是 UA 判断）

现在面板里有 `navigator.userAgent.indexOf('Android')`、`window.ksu.exec` 这类散落判断（`patch-ui.sh` 注入的脚本就是），六端会越来越乱。改造：

**新增 `GET /api/host`**（无需鉴权，返回能力表）：

```json
{
  "platform": "ios",
  "form": "daemon",
  "version": "3.3.0-beta.6",
  "caps": {
    "plugins": false,
    "sidecar": false,
    "execHelpers": false,
    "isolatedLogin": true,
    "fileDialogs": false,
    "notifications": false,
    "selfUpdate": false,
    "systemProxy": false,
    "portChange": false,
    "loopbackBind": true,
    "secureStore": "file"
  },
  "ui": { "mobileFirst": true, "defaultRoute": "/m" }
}
```

**新增 `ui/host.js`（本次已交付）**：UI 只跟它打交道——

```js
A2AHost.caps.plugins                 // → 决定是否渲染「插件」入口
A2AHost.guard('plugins')             // → 不可用时给统一文案 + 打点，不抛异常
A2AHost.login.open(url, state)       // → 原生隔离容器 / 新标签 / intent，内部按端分发
A2AHost.call('getAccounts')          // → 转发到 window.workbuddyDesktop.getAccounts
A2AHost.on('login:state', cb)        // → 事件统一（桌面 push / 网页轮询 / iOS messageHandler）
```

配套 UI 规范（三行规则，六端一致）：

1. **能力不足不渲染**（`data-cap-require="plugins"` 的节点在 `host.js` 初始化时直接移除）；
2. **能力不足但用户可能点到**（如深层链接进来）→ `A2AHost.guard()` 给一句人能读懂的话 + 上报 `/api/logs`；
3. **绝不静默假成功**（沿用 `web_shim.rs` 既有原则）。

---

## 3. 六端产物矩阵

| 端 | 后端产物 | 壳产物 | 保活机制 | 端口 | 插件/sidecar | 安装方式 |
|---|---|---|---|---|---|---|
| **Windows** | `agent2api-server.exe`（+ 托盘常驻） | `Agent2API_3.3.0_x64-setup.msi`（Tauri 2） | 托盘 + 自启（`tauri-plugin-autostart`，上游已有） | 127.0.0.1:3065 | ✅ | 双击 msi |
| **macOS** | 同上（universal: arm64+x86_64） | `.dmg`（Tauri 2，`tauri-plugin-single-instance` 已有） | LaunchAgent（`~/Library/LaunchAgents`） | 同上 | ✅ | 拖进 Applications |
| **Linux** | 同上 | AppImage / `.deb` / **Docker 镜像** | systemd user unit | 同上 | ✅ | 包管理 / `docker compose up` |
| **Android(root)** | `aarch64-linux-android` glibc 或 bionic 二进制 | **KSU/Magisk 模块 zip**（现有这套，最完整） | `service.sh` + `supervisor.sh` | 同上 | ✅（android-bin 优先） | 刷模块 |
| **Android(APK)** | `libagent2api_ios.so` 等价 → `libagent2api_android.so`（staticlib + JNI） | 普通 APK（前台 Service + 通知） | 前台 Service + 电池白名单 | 同上（>1024 无需 root） | ❌ exec 受限 | 侧载/商店 |
| **iOS(越狱)** | `aarch64-apple-ios` Mach-O | `.ipa`（WKWebView 壳）+ LaunchDaemon | launchd `KeepAlive` | 同上 | ❌ | TrollStore / appinst |
| **iOS(非越狱)** | ❌ 无法常驻 | 只有纯客户端壳（连别的机器） | — | — | ❌ | 7 天签名 |
| **Web** | 无（用上面任一端或 Docker 的后端） | 无（PWA，`manifest.webmanifest` + `sw.js` 现成） | 后端负责 | 后端地址 | 取决于后端所在机器 | 打开 URL → 添加到主屏幕 |

---

## 4. 需要的改动清单（按风险从低到高，含工作量）

| # | 改动 | 文件 | 端 | 工作量 | 风险 |
|---|---|---|---|---|---|
| 1 | 新增 `crates/host-api`（trait + Capabilities + 501 映射） | 新 crate | 全 | 0.5 d | 低 |
| 2 | `GET /api/host` 端点（返回能力表 + 版本 + 默认路由） | `server/src/server/api/mod.rs` 新增 `host.rs` | 全 | 0.3 d | 低 |
| 3 | `reqwest` 的 `system-proxy` 按 target 关 | `server/Cargo.toml` | iOS | 0.1 d | 低 |
| 4 | `ui/host.js` 接入 `index.html` / `m.html`（cap 驱动渲染 + `login.open` 分发） | UI | 全 | 0.5 d | 低 |
| 5 | 清掉 UI 里散落的 `userAgent/ksu.exec/A2A_LOGIN_OPEN` 判断，统一走 `A2AHost` | `ui/m/mobile.js`（构建期 sed 或上游改源码） | 全 | 0.5 d | 中（面广） |
| 6 | `exec_helper` 收敛：插件 loader、mihomo sidecar、qoder `runtime-info` | `core/sub_kernel/*`、`providers/qoder/risk.rs`、插件模块 | iOS/Web | 1.0 d | 中 |
| 7 | DPAPI 导入改为 `SecretImporter` + 明示 `Unsupported` | `providers/autoclaw/crypto.rs` | 非 Win | 0.3 d | 低 |
| 8 | Android APK 形态（staticlib + JNI + 前台 Service） | 新 `android/` 工程 | Android | 2.0 d | 中 |
| 9 | iOS 壳接入 `hook + deep link`（`agent2api://login` → 隔离容器）、`UIDocumentPicker`、能力注入 | `app/Agent2API/*`（本次已交付骨架） | iOS | 1.0 d | 中 |
| 10 | 六端 CI 矩阵（`matrix.yml`） | `.github/workflows/` | 全 | 0.5 d | 低 |
| 11 | `.a2ab` 跨端导入导出自检（含 schema 版本校验） | `server/src/server/db/backup.rs` | 全 | 0.5 d | 低 |
| 12 | 端口占用处理：iOS 用 `lsof` 等价（`sysctl` + `proc_pidinfo`），Android 用 `/proc/net/tcp` | `port_conflict.rs` | 移动端 | 0.5 d | 中 |

合计 ≈ **8 人日**（不含上游 provider 适配器的持续维护）。核心结论：**改动量集中在"平台能力"这 12 项，业务代码一行不用动。**

---

## 5. 分阶段落地（每一步都能独立交付、独立验收）

### M0 · 冻结契约（0.5 d）
- 从 `web_shim.rs` 提取的 170 方法整理成 `docs/bridge-contract.md`：标 A 类 / B 类，B 类写清"缺能力时的返回"。
- 产出 `Capabilities` 字段表（本次已在 `crates/host-api` 里给出）。
- 验收：六端壳开发者只看这一份文档就能实现。

### M1 · 网关侧收敛（1.5 d）
- `host-api` 落地 + `ServerState.host` 注入 + `/api/host`。
- `exec_helper` 三条链路改造，`Unsupported` → HTTP 501 `{"error":"unsupported","feature":"sidecar"}`。
- 验收：iOS 编出来的网关，`/api/host` 里 `plugins:false, sidecar:false`，点插件/订阅只报文案不崩（G-1）。

### M2 · UI 能力驱动（1.0 d）
- `ui/host.js` 接入，`data-cap-require` 规则落地，UA 判断清除。
- 验收：同一份 UI，在 iOS（无插件）与 Windows（有插件）下渲染出**不同但都正确**的面板；控制台无 JS 报错。

### M3 · 六端产物（3.0 d）
- Tauri 2 单壳工程接 iOS/Android 目标（`cargo tauri ios init` / `android init`），复用上游 `desktop-tauri` 的壳代码。
- KSU 模块形态保留（root 场景），与 APK 形态共用同一份网关二进制。
- 验收矩阵（每个端都要过）：

| 门禁 | 判据 |
|---|---|
| G-1 | `GET /health` → `{"status":"ok"}` |
| G-2 | 面板首屏渲染（移动端 `/m`，桌面 `/`） |
| G-3 | 注册管理员 → 建 Key → `/v1/models` 200 |
| G-4 | `/v1/chat/completions` 流式正常 |
| G-5 | 隔离登录容器可开、可回调、cookie 不串 |
| G-6 | 后端被杀后 ≤10 s 自动恢复（各端保活机制） |
| G-7 | 冷启动（重启设备）后无需开 App 即可 curl 到 health |
| G-8 | `.a2ab` 从 A 端导出 → B 端导入，账号/Key/设置一致 |
| G-9 | `/api/host` 能力表与本端实际能力一致（无虚报） |

### M4 · 数据可迁移（0.5 d）
- `.a2ab` 里写 `schemaVersion` + `platform`；导入时校验 `user_version` 不高过本程序。
- 验收 G-8。

---

## 6. 关键取舍（写清楚，免得后面返工）

| 取舍 | 决定 | 理由 |
|---|---|---|
| Web 端要不要 WASM 后端 | **不要** | 浏览器直连上游会撞 CORS + 三方 Cookie + header 限制；能跑的只有"转发器"角色，等于没意义 |
| iOS 要不要 App 内嵌网关 | **默认不要**，只做离线可选 | App 挂起即停，`KeepAlive` 只能在 daemon 形态做 |
| Android 要不要放弃 KSU 模块 | **不要** | 插件 exec、绑低端口、后台免冻结只有 root 形态能给；APK 形态是"无 root 用户"的降级入口 |
| 壳要不要统一用 Tauri 2 | **要**（Win/macOS/Linux/Android/iOS 五端一份壳代码） | 上游已经是 Tauri 2 + `bridge.rs`，继续用它成本最低；iOS 的 WKWebView 正是 Tauri iOS 的默认 WebView |
| 是否保留手写 Swift 壳 | **保留作为兜底** | Tauri iOS 首次接入（Xcode 工程/签名/WKWebView 限制）有踩坑期，手写壳 4 个文件就能出 IPA（已交付） |
| 凭据跨端迁移 | **不承诺** | DPAPI 绑定 Windows 机器、Keychain 绑定设备；只能"重新登录"或走 `.a2ab`（其中密钥字段按端加密，导入时提示重新授权） |

---

## 7. 与已交付内容的关系

| 已有 | 在新架构里的位置 |
|---|---|
| `agent2api-ios/`（daemon plist + Swift 壳 + `ios-ffi` + 打包脚本） | iOS 端的"兜底壳"与 daemon 形态；M3 后可与 Tauri iOS 并存 |
| `agent2api-ios/scripts/gh-actions-ios-build.yml` | 六端 CI 矩阵里的 iOS 两条 job |
| `agent2api-universal/crates/host-api`（本次新增） | L1 的平台能力抽象，M1 直接合进上游 `server` |
| `agent2api-universal/ui/host.js`（本次新增） | L2 的 UI 侧统一入口，M2 直接接进 `index.html`/`m.html` |
| `agent2api-universal/scripts/build-matrix.sh` + `.github/workflows/matrix.yml`（本次新增） | M3 的六端产物流水线 |

---

## 7.5 修订（实测补充）：上游已有 Capacitor 双壳工程，UI 不需要重写

查上游仓库后确认，**移动端壳与 iOS 工程都已经存在**，本节取代前面"手写壳"的默认假设：

| 事实 | 证据 |
|---|---|
| UI 源码是 tsx，不是手写 HTML | `ui-kit/`（39 tsx，Base UI + Tailwind v4）、`ui-shared/`、`ui-islands/`（133 tsx）、`mobile/src/`（56 tsx） |
| 两份产物同一份源码 | `ui/islands/ui.js`（2.2 MB，桌面 islands）、`ui/m/mobile.js`（937 KB，手机端） |
| 移动壳 = Capacitor 8 | `mobile/capacitor.config.ts`、`mobile/android/`（`MainActivity` + `ApkUpdaterPlugin` + `ImageSaverPlugin`）、**`mobile/ios/App/App.xcodeproj` 已存在** |
| 构建脚本已就绪 | `mobile/package.json`：`build` / `build:native`（`--mode apk`）/ `build:apk`（`cap sync android`）/ **`build:ios`（`cap sync ios`）** / `apk`（`gradlew assembleRelease`） |
| iOS 视觉/网络细节已处理 | `capacitor.config.ts` 的 `ios.contentInset: 'never'`（安全区交给页面 `env()`）；`mobile/ios/App/App/Info.plist` 已含 `NSAllowsArbitraryLoads` + `NSAllowsArbitraryLoadsInWebContent` + `NSAllowsLocalNetworking` + `NSLocalNetworkUsageDescription` |

因此修正结论：

- **UI 零重写**；iOS/Android 壳用上游 Capacitor 工程（`npm run build:ios` → `cap sync ios` → Xcode archive → IPA）。
- 手写 Swift 壳（`agent2api-ios/`）降级为**兜底**：当 Capacitor 在越狱机上签名/加载不顺时用它。
- iOS 仍需 **daemon**（Capacitor App 不能常驻），故"daemon + Capacitor IPA"是 iOS 的最优组合。
- 跨源注意：Capacitor 页面 origin 是 `capacitor://localhost`（iOS）/ `https://localhost`（Android），请求 `http://127.0.0.1:3065` 属跨源；上游 `/api/*` 是无条件 CORS（见 `api/cors.rs` 模块注释），`/v1/*` 需显式开 `corsEnabled`。

UI 侧唯一要"新写"的原生件：**iOS 的隔离登录容器插件**（`nonPersistent` WKWebView，约 120 行 Swift + 一个 TS 定义），因为 `mobile/src` 现在走 `window.open` + 轮询，而 iOS 上需要一个一次性 cookie 罐。

## 7.6 重大更正：provider 已被外置为插件包，插件从"增强"变成"命脉"

读 `server/src/server/core/providers/missing_plugin.rs` 的模块注释（原文）：

> 本项目把「怎么伪装成官方客户端打某个上游」的全部实现移到了**独立的提供商插件**里
> （`agent2api-providers`，不随本仓库发布）。理由是风险隔离……
> 于是网关手里只剩三样东西：身份枚举、账号库与配置、插件宿主（spawn 子进程、JSON 行 RPC、崩溃重启）。
> **没装插件时**，`adapter_for` 对任何 `ProviderKind` 都返回本占位实例：它如实报错……
> 为什么返回 503 而不是 500 —— 503 是「服务暂不可用」，语义上正是「这段时间没有可用的执行体」。

实测证据：
- `core/providers/` 下只剩 `catalog / custom / missing_plugin / adapter / catalog_*` 等骨架；
  `qoder/` 只剩 `endpoints.rs` + `mod.rs`，`autoclaw/` 只剩 `mod.rs` + `region.rs`。
- 插件宿主是独立模块：`core/plugin_host/` 共 40+ 文件（`lifecycle.rs` 里 102 行
  `tokio::process::Command::new(&self.options.exe)` 是唯一的 spawn 点）。
- 插件二进制里的 `crates/providers/src/providers/<id>/` 就是那份被移出去的实现。

**三条结论（推翻了本文前面基于 `3.3.0-beta.6` 旧二进制的判断）**：

1. iOS 上"不跑插件"不是丢几家，而是**几乎所有厂商转发都返回 503**。功能完整度必须是 0% 或 100%，没有中间态。
2. 但降级语义**已经内建**（503 + 可行动文案），所以不需要新造 501 机制来防崩；
   `host-api` 的价值变成"**让 UI 提前隐藏入口**"，而不是"兜住崩溃"。
3. **iOS daemon 形态其实可以跑插件**：launchd 拉起的 Mach-O 允许 `posix_spawn`，
   `plugin_host` 的进程管理本来就是 `tokio::process` + `#[cfg(unix)]`/`#[cfg(windows)]` 双分支。
   前提只有一个：插件包要有 `aarch64-apple-ios` 构建。App 沙盒形态则永远不行。

### 配套补丁（已交付、已 `git apply --check` 验证）

`patches/0001-plugin-host-ios-exec-gate.diff`（+43/−0，单文件两处 hunk，不新增模块/依赖）：

- 在 `plugin_host/lifecycle.rs` 的 spawn 之前加闸门，把"spawn 失败"变成
  「该提供商需要安装插件，但当前运行形态不支持启动插件进程（原因）」——与
  `missing_plugin.rs` 的口径一字不差；
- 开关口径：`AGENT2API_NO_EXEC=1` 强制拒绝 / `AGENT2API_ALLOW_EXEC=1` 强制允许 /
  iOS 未声明则拒绝 / 其它平台行为不变；
- 于是 iOS **LaunchDaemon plist 里加 `AGENT2API_ALLOW_EXEC=1`** 就恢复插件能力，
  Capacitor IPA 内嵌网关不加，自然走文案降级。

### 修订后的六端功能完整度

| 端 | 内置 provider（catalog/custom） | 插件 provider | 结论 |
|---|---|---|---|
| Windows / macOS / Linux | ✅ | ✅ | 100% |
| Android(KSU 模块) | ✅ | ✅（android-bin 优先） | 100% |
| Android(APK) | ✅ | ❌ | 仅内置 |
| **iOS(越狱 daemon，加 `AGENT2API_ALLOW_EXEC=1` + iOS 版插件）** | ✅ | **✅ 理论可行** | 等待插件包出 iOS 构建 |
| iOS(daemon，不加开关) / iOS App 内嵌 | ✅ | ❌（503 + 文案） | 仅内置 |
| Web（后端在别处） | 取决于后端 | 取决于后端 | — |

## 8. 一句话回答"该怎么做"

**别做六套，做"一核 + 一契 + 六壳"**：
把平台差异压到 12 个能力点上（`host-api` + `/api/host` + `ui/host.js`），
业务与面板一行不改；
壳统一用上游已有的 Tauri 2（五端一份代码），Web 端当客户端不跑后端，
Android 保留 KSU 模块作为 root 超集形态，iOS 保留 LaunchDaemon 作为常驻形态。
按 M0→M4 走，约 8 人日即可六端闭环。
