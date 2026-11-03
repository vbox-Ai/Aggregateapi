# 给插件作者的 iOS 移植说明（`Agent2Providers` → `aarch64-apple-ios`）

> 本文的读者是**插件包维护者**，不是网关用户。
> 结论先行：`agent2api-providers`（纯 HTTP + 签名）**可以**移植到 iOS 越狱机；
> `agent2api-web-providers`（浏览器自动化型）**基本不可移植**。下面是判定依据与三步落地。

---

## 0. 为什么突然需要这份文档

网关（`agent2api-server`）已把全部 provider 实现移到插件包里，自己只保留
「身份枚举 + 账号库 + 插件宿主」。`core/providers/missing_plugin.rs` 的注释写明：

> 没装插件时，`adapter_for` 对任何 `ProviderKind` 都返回本占位实例：它如实报错……
> 为什么返回 503 而不是 500 —— 503 是「服务暂不可用」，语义上正是「这段时间没有可用的执行体」。

于是 **iOS 端的功能完整度完全取决于插件包有没有 iOS 构建**：

| 有无 iOS 版插件 | iOS 上的 provider 可用性 |
|---|---|
| 无 | 只有 catalog / custom（其余全部 503「请安装插件」） |
| 有 | 与桌面端一致（前提：跑在 **LaunchDaemon** 形态；App 沙盒内嵌形态永远不行） |

而 iOS 的 daemon 形态**技术上允许** spawn：launchd 拉起的 Mach-O 进程可以
`posix_spawn`，网关侧 `core/plugin_host/lifecycle.rs` 用 `tokio::process::Command` +
`#[cfg(unix)]` 分支管理子进程，协议是**stdio 帧协议**（`Content-Length` 风格），
与平台无关。缺的只是"一个能在 iOS 上跑的插件二进制"。

---

## 1. 先分类：你的插件属于哪一种

| 类型 | 典型成员 | iOS 可行性 | 原因 |
|---|---|---|---|
| **A. 纯 HTTP + 签名/加解密** | `agent2api-providers` 里绝大多数（workbuddy、zcode、qoder、codearts、trae、cline、kuku、loomy、orcaterm、officeace、raccoon、antigravity、accio、monkeycode、commandcode、catpaw 的非浏览器路径…） | ✅ 高 | 只依赖 `reqwest`/`rustls`/`ring`/`aes`/`p256`，全是纯 Rust，iOS 目标可直接编 |
| **B. 需要本机浏览器/自动化** | `agent2api-web-providers`（chatglm / deepseek / mimo 这类网页登录抓 cookie） | ❌ 极低 | 需要 Playwright/CDP/Chromium 或系统浏览器进程，iOS 沙盒既不给你 fork 也不给你装第二个 WebKit |
| **C. 需要桌面端登录态导入** | 走 DPAPI / Chromium `Local State` 的导入路径 | ⚠️ 不适用 | 凭据物理上在 Windows 机器上，与平台无关的"不可迁移"，iOS 只应保留"重新登录"路径 |

**B 类的替代做法**（如果一定要在手机上支持这几家）：改成"用户手动粘贴 Cookie/Token"的
API 型登录（把抓取动作交给用户，插件只做校验与转发）。这是产品决策，不是移植问题。

---

## 2. 移植三件事

### 2.1 目标与 cfg（半天）

```bash
rustup target add aarch64-apple-ios
IPHONEOS_DEPLOYMENT_TARGET=15.0 cargo build --release --target aarch64-apple-ios
file target/aarch64-apple-ios/release/<你的插件>
# 期望：Mach-O 64-bit executable arm64
```

自查清单（按出现频率排序，全部是"编得过但跑不对"的坑）：

| 检查项 | 命令 | 处理 |
|---|---|---|
| 是否用了 Linux/Android 专属路径 | `grep -rn '/proc/\|/data/\|/system/\|linker64\|ld-linux' crates/` | 改成 `AGENT2API_PROXY_HOME` 相对路径 |
| 是否有 `cfg(target_os)` 分支漏了 iOS | `grep -rn 'cfg(target_os' crates/` | 补 `ios`（多数情况与 `macos` 同分支） |
| 是否链了系统库 | `grep -rn 'nix\|libc =\|openssl\|native-tls' crates/*/Cargo.toml` | `nix` 的 iOS 支持不全；`native-tls`/`openssl` 一律换 `rustls` |
| 是否 `fork`/`exec` 自己再拉进程 | `grep -rn 'Command::new\|std::process' crates/` | iOS daemon 可以，但 App 沙盒不行；建议做成可选能力 |
| 是否 bind 固定端口 | `grep -rn 'bind(\|TcpListener' crates/` | 必须改成 `bind("127.0.0.1:0")` 后把端口回报给网关（网关已有 `set_loopback_port` 通道） |

### 2.2 产物形态与签名（1 小时）

- 必须是 **Mach-O 可执行文件**（`cargo build --bin`），不是 `.dylib`、不是 `.so`：
  网关是 `Command::new(exe)` + stdio 帧协议，加载动态库那条路不存在。
- iOS 上必须签名，否则 AMFI 会在 `execve` 时直接杀掉：

```bash
ldid -S target/aarch64-apple-ios/release/<你的插件>
```

- 建议同时出一个 `aarch64-apple-darwin` 版本：这样 macOS 桌面端与 iOS 越狱机
  可以共用同一份代码路径，减少分支。

### 2.3 落位与命名（需要网关配合，见下节）

现在网关按这个约定找原生插件（`sync-plugins.sh` 与 `plugin_host/bootstrap.rs`）：

```
{AGENT2API_PROXY_HOME}/plugins/android-bin/<包id>/<版本>/<包id>
```

`android-bin` 这个名字在 iOS 上语义不对。建议的扩展（**网关侧一行改动**）：

```
{AGENT2API_PROXY_HOME}/plugins/native-bin/<platform>/<包id>/<版本>/<包id>
#  <platform> ∈ windows | macos | linux | ios | android
```

查找顺序：`native-bin/<当前平台>` → `native-bin/universal` → `android-bin`（向后兼容）。
这样同一份插件 zip 里可以并列放多平台二进制，`version.txt` 仍按"精确匹配网关版本"的既有规则生效。

---

## 3. 验收清单（在 iOS 上逐条过）

| # | 判据 | 命令 / 动作 |
|---|---|---|
| P1 | 网关认出"能 exec" | `curl -s 127.0.0.1:3065/api/host \| jq .caps.plugins` → `true`（需 LaunchDaemon 里设 `AGENT2API_ALLOW_EXEC=1`） |
| P2 | 插件被识别 | `curl -s -H 'x-api-key: …' 127.0.0.1:3065/api/plugins` → 列出包与版本 |
| P3 | 握手成功 | 网关日志出现插件 `ProviderInfo` 列表（宿主会打印 providers 数量） |
| P4 | 真转发 | 面板加一个账号 → `/v1/chat/completions` 200/SSE |
| P5 | 崩溃自愈 | `kill -9 <插件 pid>` → 下一次请求自动重启插件进程 |
| P6 | 无 503 | 之前报「该提供商需要安装插件」的入口消失 |

---

## 4. 需要网关侧配合的两处（已提供补丁）

1. `patches/0001-plugin-host-ios-exec-gate.diff` —— spawn 前的形态闸门 +
   `AGENT2API_ALLOW_EXEC=1` 开关（没有它，iOS 上插件会被静默拒绝且文案不可读）；
2. `patches/0002-host-capabilities-endpoint.diff` —— `GET /api/host` 能力表
   （没有它，UI 无法提前隐藏"本端不可用"的入口，只能点了才报错）。

第 2.3 节的 `native-bin/<platform>/` 命名属于**待做**项（网关侧约 20 行），
建议与插件包的多平台发布同批上线。

---

## 5. 一句话给维护者

**先把 B 类拆出去**（浏览器自动化那三家），把 A 类用
`cargo build --target aarch64-apple-ios` + `ldid -S` 出包，按
`plugins/native-bin/ios/<id>/<版本>/<id>` 落盘；网关侧加 `AGENT2API_ALLOW_EXEC=1`
即可让 iOS 越狱机的 provider 覆盖度从"仅内置"变成"与桌面一致"。
