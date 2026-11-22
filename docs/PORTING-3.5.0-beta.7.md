# 移植记录：手机端补丁层 → 上游 3.5.0-beta.7

本文件记录 Aggregateapi 的补丁层在**上游 beta.2 重构**之后的移植状态。
结论先行：上游 3.5.0-beta.2 起把**提供商插件整体换成 WASM 包**、并把**社区插件所有下载源改道官网**，
28 个补丁里 **5 条已被上游取代**、**3 条可直接沿用**、**20 条需重写**。

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

推论（需真机验证）：iOS 禁 `PROT_EXEC` 数据页，wasmtime 的 cranelift JIT 无法分配可执行内存，
所以「网关跑在手机进程内 + 提供商插件」在上游 WASM-only 之后没有官方路径。

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

见 `agent2api-universal/patches-3.5.0-beta.7/`：

| 补丁 | 状态 |
|---|---|
| `0013-index-cache` | 已按新 `index()` 重写，可在 beta.7 独立应用 |
| `0021-remote-outbound-channel` | 忠实 rebase（只做原补丁的增删），可在 beta.7 独立应用 |
| `0011-script-remote-host-start` | 忠实 rebase，但**依赖 0001** 的 `lifecycle.rs` 闸门，暂不单独交付 |

### 2.3 需重写

| 补丁 | 新落点 | 要动的点 |
|---|---|---|
| `0001` iOS 插件执行闸门 | `core/plugin_host/lifecycle.rs`、`script/bun.rs` | 闸门插到新 `start()`：`admission_closed()` / `closing` / `options.wasm` 之前 |
| `0002` 能力表端点 | 新文件 `server/api/host.rs` + `api/mod.rs` + `http.rs` | `http.rs` 路由表已到 1500+ 行并新增 `metadata/refresh` 等，按新顺序插入 |
| `0003` 插件索引指向自有仓库 | `core/plugin_host/update.rs` | `INDEX_REPO/FALLBACK_REPO` 已被 `INDEX_SOURCE = website::PLUGIN_BASE` 取代；改为在 `website::convert` 收窄白名单 |
| `0004` 自有仓库免签名 | `update.rs`、`update/required.rs`、`operations.rs`、`catalog.rs` | 上游新增 `require_signed: true` + `validate_release_urls()`，要免签名必须同时放宽两处 |
| `0005` altcha 密钥进程内缓存 | `server/altcha.rs` | 仅 1 行上下文差异 |
| `0006` 面板绑定 host | `server/mod.rs` | `bind` 段已被 `start_managed()` 重构 |
| `0007` 助手文件导入 | `db/schema.rs` + 3 个新文件 | **schema 号撞车**：上游已是 30，迁移须改 31，`match version` 臂同步 |
| `0008` 宿主源码端点 | `script/mod.rs`、`api/mod.rs`、`http.rs`、新 `api/plugin_host.rs` | `script/mod.rs` 导出已重排 |
| `0009` 远端宿主桥 | 新 `api/plugin_host.rs`、`http.rs` | 整套重贴到新路由表 |
| `0010` 免运行时安装 | `script/dependencies.rs`、`script/operations.rs` | `operations.rs` 已重写（`generation` / `progressAt`） |
| `0014` 操作卡死看门狗 | `script/operations.rs`、`script/settings.rs` | 字段语义已变 |
| `0015` 下载续传 | `script/download.rs` + **`script/website.rs`** | `website::request()` 不接受自定义 header，续传需先加 `Range` 透传 |
| `0018` iOS 远端会话 | `plugin_host/mod.rs` | `Host` 新增 `wasm: wasm::Embedded` 字段 |
| `0019` 远端宿主 reinit | `script/host/main.mjs` | `loader.mjs` 导出改为 `reloadCatalog` |
| `0020` 帧批换行 | 新 `api/plugin_host.rs` | 随 0009 落 |
| `0022` 插件包文件桥 | `script/mod.rs`、`http.rs`、新 `api/plugin_host.rs` | 同上 |
| `0023` 远端会话存活 | `plugin_host/mod.rs` | 同 0018 |
| `0024` 下载卡死轮换 | `script/download.rs` | `CONNECT_MS` → `website::request(url, Some(45_000))`；镜像轮换已无意义 |
| `0027` 远端宿主审计日志 | 新 `api/plugin_host.rs` | 随 0009 |
| `0028` 脚落盘再加载 | `script/operations.rs`、新 `api/plugin_host.rs` | `operations.rs` 重写，锚点失效 |

## 3 建议的 CI 改动

`build.yml` 目前每次取「最新 v\* tag」，等于每轮构建都在赌补丁还合得上。建议加显式 pin：

```yaml
env:
  UPSTREAM_REPO: https://github.com/aimod-cc/Agent2API.git
  UPSTREAM_TAG: v3.5.0-beta.7   # 留空则回落「最新 v* tag」
```

并把「取上游源码」段里的 `TAG="$(git -C Agent2API tag -l 'v*' --sort=-v:refname | head -1)"`
换成 `TAG="${UPSTREAM_TAG:-$(...)}"`；`align-plugin-version.py --min-version` 同步用同一个 TAG。

另外把「打补丁」步骤的 `exit 1` 保留（现在已经有），并让 `release` 继续用 deb/ipa 非空兜底。

## 4 手机端形态与插件

| | R · 手机当远程客户端 | S · 手机独立网关 |
|---|---|---|
| 手机跑什么 | 只有面板，连桌面 `:3065` | 网关跑在手机里（daemon / EMBED=1） |
| 要的补丁 | `0002` `0005` `0006` `0007` `0013`（`0001` 可选） | 追加 `0008~0023` `0027` `0028` |
| beta.7 能力 | 全量（WASM 插件在桌面跑） | 面板全量，**提供商插件无解**（WASM 需 JIT） |
| 工作量 | 5 条小补丁 + 重编 `ui/m` | 20 条重写 + 解决 iOS 上的 WASM 执行 |

目前手机端走的是 R（连桌面 3065），插件在桌面正常运行，无需改动插件层。

## 5 验证状态

| 判据 | 状态 |
|---|---|
| 28 补丁在 beta.1 / beta.7 的可应用性 | Observed（行级 hunk 匹配 + 顺序累积） |
| `0013` / `0021` 在干净 beta.7 上可应用 | Observed |
| 生成补丁「只做原补丁的增删」 | Observed（逐 hunk 对比原补丁删除行集合） |
| 编译通过 | `NOT RUN`（构建机无 Rust 工具链） |
| iOS 上 wasmtime 不可用 | Inferred；验证动作：越狱机跑 wasmtime 最小样例，看是否 `failed to allocate executable memory` |