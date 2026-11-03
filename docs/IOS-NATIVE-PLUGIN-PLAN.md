# iOS 本机原生运行插件 — 解决方案（方案 A1）

> 目标：在**这台 iPhone 本机**上同时跑通「提供商增强（`agent2api-providers`）」与「网页提供商（`agent2api-web-providers`）」，不依赖电脑、不依赖另一台设备、不用模拟器。
> 本文只给方案，**暂不改代码**。

---

## 0. 一句话结论

**可以做到，而且是原生速度**：这两个插件是**纯 Rust** 程序（依赖只有 `tokio` / `reqwest(rustls)` / `tokio-tungstenite` / `serde`，**没有任何浏览器或 JS 引擎**），源码公开在 `github.com/ProvidersPlugin/Agent2Providers`。
把它们**交叉编译成 `aarch64-apple-ios` 的 Mach-O**，再用 `ldid` 签名，就能在 iOS 上像原生程序一样跑。

唯一的结构性障碍不是"插件本身"，而是 **iOS 的 App 沙盒禁止 `exec` 子进程** —— 所以要把网关从"App 进程内"改成"**LaunchDaemon 常驻**"（越狱机上的无沙盒进程），插件由 daemon 拉起。

**用户体感不变**：点开 App 还是那个面板，只是网关与插件在下层以独立原生进程运行（这正是 Android 模块原本的架构，只是把 ELF 换成 Mach-O）。

---

## 1. 为什么这条路成立（证据，不是推测）

| 判据 | 实测结果 |
|---|---|
| 插件源码可得 | `ProvidersPlugin/Agent2Providers` — **public**，`main` 分支，5000 KB，活跃提交 |
| 构建形态 | 纯 Rust workspace：`crates/provider-protocol`（帧协议）+ `provider-sdk` + `providers`；`[[bin]] name="agent2api-providers"` |
| 平台绑定 | 依赖仅 `tokio / reqwest(rustls) / tokio-tungstenite / serde / sha1`；**无 quickjs / boa / v8 / chromium / playwright / webkit** |
| 看到 "websocket" 字样是否=浏览器 | 否，那是 HTTP 头字符串（`sec-websocket-*`）与上游 WS 流，属纯网络库 |
| 网页提供商要浏览器吗 | **不需要**。智谱清言/DeepSeek 的"网页版"是**用 HTTP 复刻网页接口**，不是驱动浏览器 |
| 覆盖范围 | `pack.json` 声明 22 家（含 `chatglm`、`autoclaw`、`zcode`、`workbuddy`、`qoder`、`trae`、`catpaw`、`accio`、`codearts`、`antigravity`…），`protocol: 1` |
| 网关侧如何找插件 | `{AGENT2API_PROXY_HOME}/plugins/android-bin/<包id>/<版本>/<包id>`（"原生优先"），目录名只是约定，iOS 二进制放进去同样被认 |
| 我们已经在 iOS 上编过同样的依赖 | 网关本体（`ring`/`rustls`/`libsqlite3-sys`/`tokio`）已成功编出 `aarch64-apple-ios` 静态库（202 MB）+ Mach-O 守护进程 → 插件用同一套依赖，编译风险低 |

结论：**"跑不起来"只因为文件格式是 ELF，不是因为它依赖了什么 iOS 没有的东西。**

---

## 2. 为什么"App 内嵌网关"（当前 IPA 的形态）注定不行

| 形态 | 能否 `exec` 子进程 | 结果 |
|---|---|---|
| App 沙盒内（当前 `EMBED=1`） | ❌ 沙盒拒绝 `process-exec` | 你看到的红字（闸门先拦） |
| App + `no-sandbox` entitlement | ⚠️ 理论可以，取决于越狱是否放行 exec | 方案 A2，需实测 |
| **LaunchDaemon（无沙盒进程）** | ✅ 允许，和桌面一样 | **方案 A1（推荐）** |

注意：把 `AGENT2API_ALLOW_EXEC=1` 打开也只能让 App 沙盒去试探 exec，沙盒仍会拒绝（或 AMFI 拒绝），所以"只加环境变量"解决不了。

---

## 3. 方案 A1：LaunchDaemon 网关 + iOS 原生插件（推荐）

### 3.1 拓扑

```
iOS 越狱机（rootless：/var/jb）
├── LaunchDaemon  com.chiyu.agent2api            ← 无沙盒，可 exec
│     /var/jb/usr/local/bin/agent2api-server        （我们编的 Mach-O，新增 bin 目标）
│     env: AGENT2API_ALLOW_EXEC=1
│          AGENT2API_PROXY_HOME=/var/mobile/Library/agent2api
│          AGENT2API_UI_DIR=/var/jb/usr/local/share/agent2api/ui
│          AGENT2API_HOST=127.0.0.1  PORT=3065
│     └─ spawn → 插件进程（原生 Mach-O，ldid 签名）
│           {PROXY_HOME}/plugins/android-bin/agent2api-providers/<ver>/agent2api-providers
│           {PROXY_HOME}/plugins/android-bin/agent2api-web-providers/<ver>/agent2api-web-providers
│           ↕ stdio 帧协议（provider-protocol，protocol=1）
│           ↕ 回连 127.0.0.1:<loopback port>（bootstrap 已内置 set_loopback_port）
└── App  Agent2API.app（EMBED=0，纯客户端）
      WKWebView → http://127.0.0.1:3065/m
```

### 3.2 落地步骤（8 步）

| # | 步骤 | 产物/命令 |
|---|---|---|
| 1 | clone 插件仓库，交叉编译 | `cargo build -p agent2api-providers --release --target aarch64-apple-ios`；网页包同法（`--no-default-features --features chatglm,…` 或它自己的 pack 目录） |
| 2 | **构建期补丁**：插件 `Cargo.toml` 的 `reqwest` 去 `system-proxy`（同网关那处，`system-configuration` 在 iOS SDK 上编不过） | CI 里 `python - <<` 改两行 |
| 3 | 签名 | `ldid -S agent2api-providers`（越狱机 AMFI 需有效签名） |
| 4 | 编网关 daemon（上游已无 bin 目标） | 在我们仓库的 `ios-ffi` 加 `src/bin/agent2api-daemon.rs`：`ServerState::bootstrap` → `start` → 阻塞等 SIGTERM（≈25 行） |
| 5 | 投放 | daemon → `/var/jb/usr/local/bin/`；插件 → `{PROXY_HOME}/plugins/android-bin/<pack-id>/<version>/<bin>`，`chmod 755` + `ldid -S` |
| 6 | LaunchDaemon plist | 加 `AGENT2API_ALLOW_EXEC=1`（其余照现有 `daemon/com.chiyu.agent2api.plist`） |
| 7 | IPA 改纯客户端 | `EMBED=0` 重打包（面板逻辑不变，只是不再自带网关） |
| 8 | 首次启动 | `launchctl bootstrap system …` → 面板「网关插件」应显示**运行中**；若仍提示"需要安装插件"，先在面板点一次「下载安装」让网关写库，再用 iOS 版覆盖同名路径二进制 |

### 3.3 需要改的代码（都在**我们自己的仓库**，不动上游）

| 文件 | 改动 | 量级 |
|---|---|---|
| `agent2api-ios/ios-ffi/src/bin/agent2api-daemon.rs` | 新增 daemon 入口（复用现有 `a2a_start` 逻辑，去掉 C ABI 包装） | ~30 行 |
| `.github/workflows/build.yml` | 新增 job：clone 插件仓库 → 编译 2 个包 → ldid → 上传 artifact（`ios-plugins`） | ~40 行 |
| 同上 | daemon 产物改为用我们的 bin 目标；IPA 用 `EMBED=0` | ~10 行 |
| `daemon/com.chiyu.agent2api.plist` | 加 `AGENT2API_ALLOW_EXEC=1` | 1 行 |
| `agent2api-ios/scripts/install-daemon.sh` | 加上"安装插件 + 签名 + 校验"分支 | ~30 行 |

**上游（Agent2API / Agent2Providers）零改动** —— 它们的"原生优先"查找逻辑与 stdio 协议本来就是为多平台设计的。

---

## 4. 方案 A2（备选）：App 直接 exec（少一个进程）

- App 的 `entitlements.plist` 打开 `com.apple.private.security.no-sandbox` + `platform-application`；
- 插件放进 `Agent2API.app/plugins/…`（同 bundle 内可写？App bundle 只读，需放容器目录）；
- 进程内网关（`EMBED=1`）直接 spawn 同容器的 Mach-O 插件。

**优点**：不用装 daemon，App 独立运行。
**风险**：iOS 17 rootless 的沙盒/AMFI 是否真的放行"沙盒移除后的 exec"，必须真机验证；WKWebView 在无沙盒进程里可能行为变化（历史上有人踩过）。
→ 建议 **A1 先跑通**，再拿 A1 的插件二进制去试 A2（同一份产物，零额外成本）。

---

## 5. 方案 B（不推荐）：VM/模拟器里跑原 ELF

- 越狱机装 UTM（QEMU TCG + JIT），起 arm64 Linux，VM 内跑整个网关 + 原插件；
- 但这样"网关在 VM 里"，App 只能当客户端 → 与 A1 相比多一层 emulation、耗电、启动慢；
- **且无法做到"App 内网关 + VM 内插件"**：插件宿主是 `spawn + stdio`，跨进程边界要改成"连远程插件"，那是更深的改动。
→ 仅作为 A1 失败时的兜底。

---

## 6. 风险与对策

| 风险 | 概率 | 对策 |
|---|---|---|
| 插件编译 iOS 时报 `system-configuration` 错 | 高 | 构建期把插件 `reqwest` 的 `system-proxy` 特性按 target 关掉（同网关补丁） |
| 插件版本与网关期望不匹配（`protocol:1`、pack `version`） | 中 | 以面板已显示的 `v3.4.0` 与 `pack.json` 为准；目录名按网关实际查找的版本号生成（先让它自己下载一次，看落盘路径照抄） |
| AMFI 拒绝 exec 未签名助手 | 中 | 所有 Mach-O 一律 `ldid -S`；路径放 `/var/jb`（rootless 允许区） |
| 插件需要 loopback 回连 | 低 | daemon 形态天然可用（`bootstrap::set_loopback_port` 已在网关里） |
| 桌面端凭据导入类功能（AutoClaw DPAPI、Cursor/VSCode 配置导入） | 确定不可用 | 凭据物理在 Windows 机器上，与 iOS 无关；iOS 端走"网页/OAuth 登录"即可 |
| 后台保活/耗电 | 低 | daemon `KeepAlive`；插件按需拉起（首次用到才 spawn） |

---

## 7. 验收标准（真机逐条过）

| # | 判据 |
|---|---|
| V1 | `curl 127.0.0.1:3065/health` → `{"status":"ok"}` |
| V2 | 面板「网关插件」两张卡片显示**运行中**（不再红字） |
| V3 | 插件页能看到 22 家 + 网页 3 家 provider |
| V4 | 添加一个 chatglm / DeepSeek 网页账号 → 成功拿到模型列表 |
| V5 | `/v1/chat/completions` 走插件 provider → 200 / SSE 正常 |
| V6 | `kill -9 <插件 pid>` → 下一次请求自动重启插件并成功 |
| V7 | 重启手机 → daemon 自启 → 插件自动可用（不用开 App） |
| V8 | 面板「插件」不再出现任何"启动失败"提示 |

---

## 8. 工期

| 阶段 | 内容 | 人日 |
|---|---|---|
| P1 | 插件 iOS 交叉编译打通（含 `system-proxy` 补丁） | 0.5 |
| P2 | daemon bin 目标 + plist + 安装脚本 | 0.5 |
| P3 | 真机联调（版本匹配、签名、握手、loopback） | 0.5 |
| P4 | CI 自动化（两个新 artifact：`ios-daemon`、`ios-plugins`）+ 文档 | 0.3 |
| 合计 | | **≈1.8 人日** |

---

## 9. 结一句话给你

这两个插件**不是 iOS 跑不了**，是"当前这个包（App 内嵌网关）没有执行子进程的资格"。
把网关换成 **LaunchDaemon + iOS 原生编译的插件**，它们就能在你这台 iPhone 上原生跑，功能与 Android 模块一致（除桌面凭据导入那几条）。同意的话我按 P1→P4 开工。
