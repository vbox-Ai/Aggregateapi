# 移植记录：手机端补丁层 → 上游 3.5.0-beta.7

> **修订 2026-11-23**：上一版把本仓库的形态判成「手机当远程客户端（R 路线）」，结论写错了。
> 事实是**独立形态**：网关跑在手机里（iOS 侧 `EMBED=1` 或 LaunchDaemon，Android 侧 KSU 模块），不依赖电脑端。
> 本版按独立形态重写第 4 节，第 1–3 节的实测数据与分诊表不变。

结论先行：上游 3.5.0-beta.2 起把**提供商插件整体换成 WASM 包**、并把**社区插件所有下载源改道官网**，
28 个补丁里 **5 条已被上游取代**、**3 条可直接沿用**、**20 条需重写**；
独立形态还多一个硬阻塞：**上游把原生提供商插件彻底禁用了**（见第 4 节）。

- 上游源码：`aimod-cc/Agent2API`，分支 `beta`，最新 tag `v3.5.0-beta.7`（`d20e8501`，2026-11-21T14:37Z）
- 补丁写就时的基版：`v3.5.0-beta.1`（`aba58858`）——该基版上 **27/28 补丁可应用**
- 同批补丁在 `v3.5.0-beta.7` 上：**9/28 行级可应用**

## 1 上游把插件模型换了（决定性变更）

| 证据 | 位置 |
|---|---|
| 插件目标平台只剩 WASM | `core/plugin_host/wasm/manifest.rs:8` → `pub const TARGET: &str = "wasm32-unknown-unknown";` |
| 目录里过滤掉非 WASM 资产 | `core/plugin_host/catalog.rs:76` `retain_wasm_platforms()` → `platforms.retain(\|p\| p["target"] == TARGET)` |
| 运行时是 JIT | `server/Cargo.toml:74` `wasmtime = { features = ["cranelift", …] }`，无 `wasmi` / `pulley` 解释器后端 |
| 全仓无 iOS 条件编译 | `target_os = "ios"` 命中 **0** 处 |
| 社区源全部改道官网 | `script/website.rs::convert()`：`raw.githubusercontent.com` / `api.github.com` / `codeload` / `npmjs` 一律转成 `agent2api.dev/api/plugins/community/*`，并有 `trusted_url` 校验 |
| 下载/分发层重写 | `script/download.rs`(2082B)、`script/distribution.rs`(2919B) 只剩 `website::request` / `bytes_with_fallback`，无镜像链、无续传 |
| 上游没有 `api/plugin_host.rs` | 9 条补丁是**新建**该模块（远端宿主桥是 Aggregateapi 自研层） |
| `script/catalog/network.rs` 已被删 | 目录网络层并入 `catalog/{cache,refresh,types}.rs` |

## 2 分诊

### 2.1 删除（上游已取代）

| 补丁 | 上游替代物 |
|---|---|
| `0012-magpie-dist-mirror` | `website::bytes_with_fallback(INDEX_URL, LEGACY_INDEX_URL, …)` |
| `0016-magpie-mirror-chain` | 同上（官网 CDN 源 + 回退链） |
| `0017-magpie-use-gateway-sources` | `website::convert()` 已把所有源改道官网 |
| `0025-catalog-github-via-gateway-sources` | `script/catalog/network.rs` 已删除，目录走 `website::CATALOG/REGISTRY` |
| `0026-catalog-json-source-validate` | 同上 |

### 2.2 可直接沿用

见 `agent2api-universal/patches-3.5.0-beta.7/`：`0013-index-cache`（按新 `index()` 重写）、
`0021-remote-outbound-channel`（忠实 rebase），两条均可在 beta.7 独立应用。
`0011-script-remote-host-start` 忠实 rebase 但依赖 `0001` 的 `lifecycle.rs` 闸门，暂不单独交付。

### 2.3 需重写

| 补丁 | 新落点 | 要动的点 |
|---|---|---|
| `0001` iOS 插件执行闸门 | `core/plugin_host/lifecycle.rs`、`script/bun.rs` | 闸门插到 `start()` 的 `admission_closed()` / `closing` / `options.wasm` 判断之前 |
| `0002` 能力表端点 | 新文件 `server/api/host.rs` + `api/mod.rs` + `http.rs` | `http.rs` 路由表已 1500+ 行并新增 `metadata/refresh` 等 |
| `0003` 插件索引指向自有仓库 | `core/plugin_host/update.rs` | `INDEX_REPO/FALLBACK_REPO` 已被 `INDEX_SOURCE = website::PLUGIN_BASE` 取代；改在 `website::convert` 收窄白名单 |
| `0004` 自有仓库免签名 | `update.rs`、`update/required.rs`、`operations.rs`、`catalog.rs` | 上游新增 `require_signed: true` + `validate_release_urls()` |
| `0005` altcha 密钥进程内缓存 | `server/altcha.rs` | 仅 1 行上下文差异 |
| `0006` 面板绑定 host | `server/mod.rs` | `bind` 段已被 `start_managed()` 重构 |
| `0007` 助手文件导入 | `db/schema.rs` + 3 个新文件 | **schema 号撞车**：上游已是 30，迁移须改 31 |
| `0008` 宿主源码端点 | `script/mod.rs`、`api/mod.rs`、`http.rs`、新 `api/plugin_host.rs` | `script/mod.rs` 导出已重排 |
| `0009` 远端宿主桥 | 新 `api/plugin_host.rs`、`http.rs` | 整套重贴到新路由表 |
| `0010` 免运行时安装 | `script/dependencies.rs`、`script/operations.rs` | `operations.rs` 已重写（`generation` / `progressAt`） |
| `0014` 操作卡死看门狗 | `script/operations.rs`、`script/settings.rs` | 字段语义已变 |
| `0015` 下载续传 | `script/download.rs` + **`script/website.rs`** | `website::request()` 不接受自定义 header，需先加 `Range` 透传 |
| `0018` iOS 远端会话 | `plugin_host/mod.rs` | `Host` 新增 `wasm: wasm::Embedded` 字段 |
| `0019` 远端宿主 reinit | `script/host/main.mjs` | `loader.mjs` 导出改为 `reloadCatalog` |
| `0020` 帧批换行 | 新 `api/plugin_host.rs` | 随 0009 落 |
| `0022` 插件包文件桥 | `script/mod.rs`、`http.rs`、新 `api/plugin_host.rs` | 同上 |
| `0023` 远端会话存活 | `plugin_host/mod.rs` | 同 0018 |
| `0024` 下载卡死轮换 | `script/download.rs` | `CONNECT_MS` → `website::request(url, Some(45_000))` |
| `0027` 远端宿主审计日志 | 新 `api/plugin_host.rs` | 随 0009 |
| `0028` 脚落盘再加载 | `script/operations.rs`、新 `api/plugin_host.rs` | `operations.rs` 重写，锚点失效 |

## 3 建议的 CI 改动

`build.yml` 每次取「最新 v\* tag」，等于每轮构建都在赌补丁还合得上。建议显式 pin：

```yaml
env:
  UPSTREAM_REPO: https://github.com/aimod-cc/Agent2API.git
  UPSTREAM_TAG: v3.5.0-beta.7   # 留空则回落「最新 v* tag」
```

并把取 tag 那段换成 `TAG="${UPSTREAM_TAG:-$(git -C Agent2API tag -l 'v*' --sort=-v:refname | head -1)}"`，
`align-plugin-version.py --min-version` 用同一个 TAG。

## 4 独立形态：插件是唯一的硬阻塞

手机独立跑 = 网关进程在手机上，模型调用全依赖插件，所以插件不能"挪到桌面去"。beta.7 上有两道闸：

### 4.1 原生提供商插件被硬禁用（Observed）

```rust
// core/plugin_host/support.rs:6
pub(super) const LEGACY_REASON: &str =
    "旧原生提供商插件已停止支持，请安装对应的 WASM 插件；已有账号和配置保留。";
```

拦截面（10 处调用点）：

| 文件:行 | 作用 |
|---|---|
| `support.rs:15` `require_wasm()` | 安装闸门 |
| `support.rs:31` `legacy_reason()` | 启动/兼容判定 |
| `install.rs:401/576/599` | 安装、启动、操作前置 |
| `lifecycle.rs:24/99` | `Host` 启动：`if !self.options.script { return Err(LEGACY_REASON) }` |
| `packages.rs:95` | 包登记 |
| `catalog.rs:81/422/482` | 目录展示与可安装判定 |
| `startup.rs:112/157/203/346` | 开机预热的支持状态 |
| `structure/operations.rs:219/368`、`ownership.rs:9`、`compatibility.rs:42` | 操作与归属 |

### 4.2 而 WASM 在 iOS 上跑不了（Inferred）

`wasmtime` 只带了 `cranelift`（JIT），没有 `wasmi` / `pulley` 解释器；iOS 禁止在数据页上取执行权，
`Engine::new()` 阶段就会失败（验证动作：越狱机跑 wasmtime 最小样例，看是否 `failed to allocate executable memory`）。

### 4.3 好消息：原生执行通道的代码还在

| 证据 | 位置 |
|---|---|
| 子进程启动通道仍存在 | `lifecycle.rs:119` `tokio::process::Command::new(&self.options.exe)`（当前只被 `options.script` 门控） |
| 包清单仍按 target 映射二进制 | `install.rs:636` `entry: BTreeMap::from([("x86_64-pc-windows-msvc", "bin/x.exe")])` |
| 签名载荷按 target 计算 | `install.rs:767` `proto::signing_payload(&m, "x86_64-pc-windows-msvc", …)` |

也就是说：**不是执行器没了，是入口被封了**。

### 4.4 两条技术路线

| | S-A · 恢复原生 pack 后端 | S-B · WASM 换解释器 |
|---|---|---|
| 做法 | 给 pack 增加 `native` 分支：按当前 target 取 `entry` 里的二进制 → 复用 `options.exe` 子进程通道；`require_wasm`/`legacy_reason`/`catalog` 按「原生允许」放行 | `wasm::runtime` 换 `wasmi`：ABI 只有 `agent2api::call` / `agent2api::read` 两个导入、无 WASI、无组件模型；host `call` 是 async，需 std 线程 + `Handle::block_on` 桥 |
| 工作量 | 改 10 处闸门 + 宿主 options 组装，估 150–250 行 | 重写执行层 + 异步桥 + 性能与配额语义（fuel 换成指令计数），估 600 行以上 |
| 复用现有资产 | ✅ 直接复用你们已在 iPad/deb 上验证过的 `aarch64-apple-ios` Mach-O 插件包 | ❌ 要等上游发 wasm 包在 iOS 上验证，且解释执行速度待测 |
| 与上游一致性 | 长期分叉（上游明确不支持） | 与上游一致 |
| 建议 | **先做**，恢复"手机独立可用" | 作为长期对齐项，S-A 落地后并行推进 |

### 4.5 独立形态的最小可用集

| 优先级 | 补丁 |
|---|---|
| P0（独立形态地基） | **原生 pack 后端放行（新写，不在原 28 条里）**、`0001` 执行闸门、`0002` 能力表、`0002` 之外的 `0006` 绑定 host、`0007` 助手文件（schema 31） |
| P1（脚本插件在手机上跑的唯一通路） | `0008` `0009` `0011` `0018` `0019` `0020` `0021` `0022` `0023` `0027` `0028` |
| P2（健壮性） | `0010` `0013` `0014` `0015` `0024` |
| 删除 | `0012` `0016` `0017` `0025` `0026` |

## 5 验证状态

| 判据 | 状态 |
|---|---|
| 28 补丁在 beta.1 / beta.7 的可应用性 | Observed（行级 hunk 匹配 + 顺序累积） |
| `0013` / `0021` 在干净 beta.7 上可应用 | Observed |
| 生成补丁「只做原补丁的增删」 | Observed |
| 原生 pack 被 `LEGACY_REASON` 拦截（10 处调用点） | Observed |
| 原生执行通道代码仍在（`options.exe` / `entry` 按 target） | Observed |
| iOS 上 wasmtime 不可用 | Inferred；验证动作见 4.2 |
| 编译通过 | `NOT RUN`（构建机无 Rust 工具链） |
