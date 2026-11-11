# 脚本插件 iOS · 开发方案

> 版本：**v3（2026-11-11，据实施结果重写机制部分）**
> 范围：让 iPhone 上「脚本插件」可以**下载 → 安装 → 使用**（原状：在 iOS 上完全装不了）
> 一句话方案：**网关侧"没有运行时就用远端宿主"，宿主跑在手机的 WebView/Worker 里；商店与登录流程照旧。**

---

## 0. v3 修订说明（v1/v2 哪些被推翻、实际做成了什么）

| 版本 | 当时判断 | 实施后的真相 |
|---|---|---|
| v1 | 必须**预打包**（bundle 插件与依赖） | ❌ 不需要 —— Magpie `dist` 分支发布的就是**已构建的小包**（10–12 KB、`dependencies: None`）|
| v1 | 要把包发成**带 iOS 目标的资产**、索引里登记 iOS 资产 | ❌ 不需要 —— 包还是那一个包，**区别只在"谁执行它"** |
| v2 | 真正缺的是"一个能跑 `.mjs` 的 JS 环境" + 一层 shim（以为只有一个方法） | ⚠️ 部分对：环境用手机 WebView ✓；但 **shim 不是重点** ✗ —— 宿主本身就是一整套 JS（29 模块），它只依赖**两条流上的 NDJSON** |
| v2 | 阶段 0 是纯前端 | ❌ 不是 —— 插件自己的 `fetch` 由**宿主**转给网关出网，需要**网关侧**配合 |
| **v3（实测）** | —— | **真正的卡点是"安装流程以 Bun 为前提"**：`operations.rs::install` 第 87 行先 `bun::ensure()`，**下载在第 88 行** ⇒ iOS 上连包都没下载过 |

**实际做成的架构**（与"预打包"无关）：

```
手机面板                          网关
─────────                        ─────
进脚本插件页
  GET  /api/plugins/host/source   ──→  给出它编译进去的那份宿主（29 个 .mjs，保证协议一致）
  POST /api/plugins/host/open     ──→  挂上"远端宿主"出站口
  GET  /api/plugins/host/stream   ←──  网关（与插件）发出的帧，NDJSON 长连接
  POST /api/plugins/host/frames   ──→  手机端宿主发出的帧（含 script.http.* / store.* 回调）
     ↓ 在 Worker 里跑宿主与插件
点「获取」
                                  ←──  下载包 → 登记（不再要求 Bun；只有"真声明了依赖"的包才拒绝）
  init 握手由手机完成             ──→  宿主就绪 ⇒ 插件注册 provider ⇒ 登录流程照常
```

关键取舍：
- **宿主源码由网关给**（不给手机自带一份）：宿主与网关的协议、帧形状、方法名是**成对**的，自带必然漂移。
- **不用 WebSocket**：网关的 axum 只开了 `multipart`（`Cargo.toml:80`），开 `ws` 等于动依赖面；
  用两个普通端点 + `Body::from_stream` 就够。
- **面板不需要额外界面**：宿主活着，商店卡片、插件设置、各提供商的登录流程本来就经网关走同一套 RPC
  （`client.auth.set` 也在里面）。v2 阶段我加过一行「本机登录」，那是**错的形状**，已删除。

已落地的补丁：`0008`（宿主源码接口）、`0009`（远端宿主桥）、`0010`（安装不再以 Bun 为前提）、
`0011`（无运行时改用远端宿主握手）；前端：`plugin-host.ts`（模块改写 + `node:*` 最小实现）、
`plugin-host-session.ts`（一支插件一个 Worker）、`plugin-host-attach.ts`（页面自动接入宿主）。

**仍然成立的结论**：Bun 在 iOS 上不可用（`bun.rs::asset()` 无 ios 分支）、插件是 JS（不是"不适用 iOS"）、
必须给 iOS 一条自主的执行路径 —— 只是这条路径的形态与 v1/v2 设想的不同。


---

---|---|---|
| "必须**预打包**：把插件 + npm 依赖 bundle 成单文件" | ❌ **不需要** —— Magpie 的 `dist` 分支发布的就是**已构建好的小包**：`opencode-astudio-auth` **12 KB**、`opencode-nous-auth` **10 KB**，`dependencies: None`，入口就是 `index.mjs` | **整段"CI 预打包"可以砍掉** |
| "码包现场要 `bun install`" | ⚠️ 仅对"从 npm 装"的那条路成立；从 Magpie `dist` 装的是**已构建产物**（`tgz/…`） | 我们需要另走一条"直接取 dist 包"的路 |

**真正缺的东西只有两样**：

1. **一个能执行 `.mjs` 的 JS 环境** → 用 App 自带的 **WebView/Worker**（iOS 必然允许）
2. **一层宿主 API shim** → 实测**只需要实现一个方法**：`client.auth.set({ path:{id}, body:{…} })`（见 §3.3）

**仍然成立的结论**：Bun 不能用了（`bun.rs` 无 iOS 分支）、插件是 JS（不是"不适用 iOS"）、必须给 iOS 一条自主的执行路径。

### 0.1 实测数据（阶段 0 选型依据）

| 包 | 大小 | `node:*` 内置 | `fetch` | 浏览器/设备码登录 |
|---|---|---|---|---|
| `opencode-river-auth` | 6 KB | 无 | ✗ | ✗ |
| **`opencode-nous-auth`** | **10 KB** | **无** | **✓** | **✓（device code）** ← **阶段 0 目标** |
| `opencode-copilot-auth` | 9 KB | 无 | ✗ | ✓ |
| `opencode-catpaw-auth` | 12 KB | 无 | ✓ | ✓ |
| `opencode-astudio-auth` | 12 KB | **有**（`node:fs`/`os`/`child_process`）| ✗ | ✓（另有一条"粘贴 token"路）|

> 说明：`astudio` 那支（就是你截图里点装不了的那支）用的是 **Node 形态**（要去读桌面端登录态）⇒ 在手机上走它的**"手动粘贴 token"**那条路；要走通需要给 `node:*` 一层**空实现 shim**。所以阶段 0 我选**零 node 依赖**的 `nous-auth`，先把通路证出来。

---

## 1. 背景与目标

### 1.1 现状（实测，非估计）

| 来源 | 数量 | 形态 | iPhone 能否安装 |
|---|---|---|---|
| 官方索引 `Agent2plugin/Agent2plugin` | 3 支（`agent2api-providers`、`agent2api-web-providers`、`agent2api-wasm-atomcode`） | 我们自己的包 | ❌ 资产只有 5 个**桌面**目标，无 iOS |
| Magpie 社区 `magpie-community/plugins/registry.json` | **112 支**（其中 **55 支 `-auth` 登录类**） | **全部是 npm 包** | ❌ 需 `bun install` |

结论：**今天在 iPhone 上可安装的脚本插件为 0 支。**

### 1.2 业务影响

脚本插件承载**各厂商账号登录**（55 支 `-auth`）⇒ 插件装不上 ⇒ 登录受阻 ⇒ 软件不可用。

### 1.3 目标

1. 手机上：点某支插件 → **下载 → 装上 → 能用来登录** ✓
2. 插件更新 ⇒ **仓库自动重新预打包** ⇒ 软件里自动收到最新 ✓
3. 全程**不依赖用户电脑**、**不需要手机上装运行时** ✓

---

## 2. 根因分析（每一环都有代码为证）

```
Magpie 插件 = npm 包（含依赖树）
   ⇒ 安装时必须 bun install
        · plugin_host/script/dependencies.rs：写 bunfig.toml，registry = registry.npmjs.org
   ⇒ 必须有 Bun 运行时
        · plugin_host/script/bun.rs：VERSION = "1.4.2"，fn asset() 按 (OS, ARCH, musl) 选包
        · 分支只有 windows / macos / linux —— **没有 ios**
   ⇒ iPhone 上 asset() 直接返回错误
        · 面板显示：「Bun 暂无适用于当前系统与处理器的运行时」
   ⇒ 安装流程在"取运行时"这一步终止 ⇒ 点「了解并安装」无反应
```

**两个关键结论**

1. 卡点是**执行模型**（用 Bun 跑 + 用 Bun 装依赖），不是"JS 脚本不适用 iOS"——JS 在 iOS 上完全可用（面板本身就是 JS）。
2. **仅替换运行时不够**：因为 Magpie 插件需要**现场解析 npm 依赖**；一个内嵌 JS 引擎无法承担 npm 解析。
   ⇒ 必须把"依赖解析"这步挪到能在的地方（CI）——这就是"预打包"。

---

## 3. 方案总览（v2）

```
① 取包：直接从 Magpie dist 分支取已构建的小包
     https://api.github.com/repos/magpie-community/plugins/contents/tgz/<name>.tgz?ref=dist
     校验 SHA-512（dist/index.json 里带 integrity）
② 存包：手机端落进 per-plugin 目录（沿用宿主现有 install/ownership 机制）
③ 执行：在 App 自带 WebView 的 **Worker** 里 import 那个 index.mjs
     · 一支插件一个独立 Worker（隔离，防全局污染）
     · 注入 host shim（见 §3.3 —— 实测只需要 client.auth.set）
④ 落库：插件登录成功后自己调 client.auth.set ⇒ 我们把它转成对网关的写凭证请求
```

### 3.3 宿主 API 规格（实测所得，不是猜的）

`oauth.mjs` 全篇只用到宿主的一个能力：

```js
if (typeof client?.auth?.set !== "function") throw new Error()
const r = await client.auth.set({ path: { id: ID }, body: { ...current, ...fields, type: "oauth" } })
```

其余依赖全部是 **WebView 原生就有的**：`fetch` / `URL` / `Request` / `AbortSignal` / `Promise` / `JSON`。
⇒ **阶段 0 的 shim ≈ 十几行**（把 `client.auth.set` 转成一次对网关的凭证写入请求）。

### 3.4 插件契约（实测所得）

```js
export async function NousPortalAuthPlugin({ client }) {
  const auth = createAuth(client)
  return {
    models(provider, { auth }) { … },              // 拉实时模型目录
    auth: { read, refresh, methods: [{ type: "oauth", label, authorize }] },  // 登录入口
  }
}
```

⇒ 宿主侧要做的事：**实例化插件 → 调 `auth.methods[…].authorize`（device code：给用户看一个码 + 网址）→ 成功后插件自己写凭证**。

---

## 3bis. 原 v1 的"CI 预打包"设计（**已不采用**，留档以防误读）

> ⚠️ 本节与 §4.1 描述的「逐支 bundle + 发 iOS 资产」**没有采用**：Magpie dist 发布的已是构建产物，
> 真正卡住的是「安装流程以 Bun 为前提」。现行做法见开头 v3 修订说明。

```
① CI：bun install → bun build → 单文件 .js（依赖全内联）
② 发布仓 → ③ 索引 → ④ 手机端 WebView 执行
```

**保留它的唯一场景**：将来要支持"从 npm 直接装"的重依赖插件（那时才需要 bundle 与 pnpm 解析）。
本节其余内容（防乱规矩、更新判定、隔离设计）**仍然适用**。


**为什么这样最优**

| 维度 | 手机端装依赖（不采用） | 预打包（采用） |
|---|---|---|
| 依赖解析 | 手机上做（重、易挂） | **CI 上用 Bun 做**（成熟） |
| Node 内置模块（fs/net/…） | 手机上要写 shim | **bundle 时内联/替换** |
| 原生扩展包（.node） | **装不上** | **CI 构建时即报错**（提前失败） |
| 手机端需要什么 | 包管理器 + 兼容层 | **只要能跑一个 .js**（WebView 白给） |
| 失败在哪发现 | 用户手机上 | **CI 上** |

---

## 4. 粒度、隔离与"共享"的边界

### 4.1 一支插件 = 一个包（**不是**一个 bundle —— 见 §3bis 的澄清）

```
registry 一条（package: @magpie-community/opencode-grok-auth）
   → 单独打包 → grok-auth.js
   → 资产名 <插件id>-<版本>-ios-arm64.zip
   → 索引里"这一条"多出 iOS 目标
   → 用户在这一条上点安装
```

区分依据**全部来自现有规范**（已实测）：

| 区分什么 | 落在哪 |
|---|---|
| 哪支插件 | 资产名里的 `<插件id>` + 索引条目的 `id` |
| 哪个版本 | 资产名里的 `<版本>`（`update.rs::asset_name(id, version, target)` 明确如此） |
| 哪个平台 | 资产名里的 `<target>`（安装时 `entry_for_target(manifest, target)` 挑选） |
| 这支怎么跑 | **每包自带 manifest/pack.json** —— 宿主只加载这一支的 entry |

### 4.2 两层要分清

| 层 | 桌面端今天 | iOS 方案 |
|---|---|---|
| **运行时**（跑 JS 的环境） | 共享一份 Bun（按需下载） | **共享 App 自带 WebView**（连下载都省） |
| **插件内容** | 每支一个包 | **每支一个包**（CI 产出的 bundle） |

### 4.3 隔离（必须做）

同一引擎内跑多支插件时，**每支独立 JS 上下文**（每支一个 `WKWebView`/Worker），否则全局变量互相污染。
插件的持久状态按插件分目录落盘（沿用宿主现有 per-plugin 的 install/ownership 机制）。

---

## 5. 更新判定机制（回答"更新怎么判断"）

### 5.1 已有的机制（复用，不重造）

- `plugin_host/update.rs` 模块头写明：**「插件索引、发行版与下载。网络出口和 GitHub 令牌复用软件更新链路。」**
- 版本比较复用 `core::update::{compare_versions, is_prerelease_version}`（与软件更新同一套）
- **商店与更新检查共用持久化缓存**（`pluginCatalog:<repo>:<channel>`）⇒ 页面轮询**不消耗 GitHub 请求额度**
- 资产名即版本：`{pack_id}-{version}-{target}.zip` ⇒ **"有没有更新"= 索引里该支的最新版本 vs 本地已装版本**（`compare_versions`）

### 5.2 本方案接入点

| 我们要做的 | 说明 |
|---|---|
| 索引里为每支登记 **iOS 目标资产** | 商店/更新检查会自动看到它在 iOS 上"有包可装" |
| 每支保持**独立版本号** | 某支更新不影响其它支 |
| **上游变更 ⇒ 必须发新版本** | CI 比对注册表 SHA-512；内容变了却复用旧版本号 = 禁止 |
| 编不过的支 ⇒ 索引标「iOS 不支持 + 原因」 | 与其让用户点了没反应，不如如实标注（顺带修掉现有 UX 缺口） |

---

## 6. 四条防"乱"规矩（必须固化为 CI 约束）

| # | 规矩 | 不守的后果 |
|---|---|---|
| 1 | **同版本资产绝不覆盖**：已存在则跳过；要改就升版本号 | 名字没变内容变了 ⇒ 客户端缓存/校验混乱 |
| 2 | **自建产物与上游 npm 包分开命名**（如 `…-ios-arm64.zip` 或独立 tag） | 与上游同名 ⇒ 分不清来源 |
| 3 | **上游内容变了必须发新版本**（CI 记录并比对 SHA-512） | 手机拿到的与索引描述不一致 |
| 4 | **整批成功才更新索引**（失败支只标注，不发半成品） | 索引半新半旧 ⇒ 用户装到一半 |

**结构保障**：发布仓**只追加、不可变**；索引是**唯一指针**且**原子替换** ⇒ 更新 = "加资产 + 移动指针"，天然可回滚。

---

## 7. 实施路线（v3：据实况重排）

### 已完成

- **网关侧**：`0008` 宿主源码接口 → `0009` 远端宿主桥 → `0010` 安装不再以 Bun 为前提 →
  `0011` 无运行时改用远端宿主握手（每条都做过补丁两级干跑校验；编译由 CI 验证）。
- **手机侧**：`plugin-host.ts`（宿主与插件的 `.mjs` → Blob URL + 改写模块说明符 + `node:*` 最小实现）、
  `plugin-host-session.ts`（一支插件一个 Worker）、`plugin-host-attach.ts`（进页面自动接入宿主）、
  脚本插件区补了搜索框（共享面板本来支持 `query`，只是调用方没传）。

### 待做（按优先级）

1. **真机验收**：装最新包 → 插件页 → 搜「nous」→ 点「获取」（`@magpie-community/opencode-nous-auth`）
   → 用它完成一次登录。**这是整条路的成败点**。
2. **逐支探测 iOS 可跑性**（不需要真机，纯静态）：对 111 支逐支看 `node:*` 依赖与登录形态，
   出「可跑 / 需适配 / 不可跑」清单；据此在商店里**逐支标注**，并修掉"点了没反应"的旧按钮。
3. **`node:*` 相关适配**：确实依赖 `fs`/`net`/子进程的支逐个判定「适配 / 内建成原生 provider / 放弃」。
4. **排查既有问题**：补丁 `0003` 在 `update.rs:10` 只应用成功一半（与本工作无关，但该修）；
   以及「GitHub 插件清单不是有效 JSON」误报（读错了仓库的清单文件名 ⇒ 404 的非 JSON）。

### 不需要做的（v1/v2 曾列出）

- ~~CI 逐支 bundle~~、~~发 iOS 资产~~、~~索引登记 iOS 目标~~、~~定时重打包 workflow~~
  —— 这些建立在"必须预打包"的前提上，而该前提已被实测推翻（见 §3bis）。
## 8. 覆盖率预期（实测分类）

| 类别 | 数量 | 预打包后 |
|---|---|---|
| `-auth` 登录类（provider 登录） | **55** | ✅ 可用（**覆盖主流厂商登录**） |
| middleware / agent（provider 逻辑） | 43 | ✅ 可用 |
| `kind=page`（需要界面） | 12 | ❌ 宿主明确不加载界面 |
| `kind=tools`（独立工具） | 8 | ❌ 不加载独立工具 |
| 依赖 Node `fs`/`net`/子进程 或原生扩展 | 少数 | ❌ 需逐个适配或内建 |

⇒ 预期 **约 75/112 可用**，其中**包含你登录需要的全部厂商**。

---

## 9. 风险与应对

| 风险 | 应对 |
|---|---|
| 原生扩展包（`.node`）无法用于 iOS | CI 构建即失败并标注；必要时内建成原生 provider |
| 强依赖 Node 内置模块 | bundle 时替换/内联；个别支单独适配 |
| 上游供应链（自动重打包引入上游变更） | **锁版本 + 校验注册表 SHA-512**；只在校验通过时发布 |
| 许可与署名（重新分发第三方 bundle） | 包内保留 LICENSE 与来源信息 |
| 签名要求 | 索引/资产带 `require_signed` 字段（`PackAsset` 已有该字段）⇒ 明确哪些支必须签名 |
| CI 成本 | 逐支缓存依赖；只对"版本或 SHA-512 变化"的支重打包 |

---

## 10. 验收标准

1. **阶段 0**：真机点一支 `-auth` 插件 → 安装成功 → **用它完成一次登录** ✓
2. **阶段 1**：定时任务跑通；改动一支上游版本后，软件内出现该支更新提示并可安装 ✓
3. **通用**：112 支的 iOS 支持状态在索引里**逐支如实标注**（不以"静默失败"呈现）
4. 全程：手机端**不下载任何运行时**、**不执行 npm** ✓

---

## 11. 待你确认的事项

1. **引擎最终选型**：**WebView（推荐，系统必然允许、`fetch`/`crypto`/定时器白给）** vs 内嵌 QuickJS（需自补标准库）
2. **阶段 0 先做哪支插件**（给一个厂商名即可；或授权我从 55 支 `-auth` 里挑一支最小的）
3. **定时节奏**：每日 / 每周一次重建（建议每日 + 支持手动触发）
4. 是否**同时**为官方两支（`agent2api-providers`、`agent2api-web-providers`）加 iOS 版本（它们是我们自己的包，最可控）
