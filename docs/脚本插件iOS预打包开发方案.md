# 脚本插件 iOS 预打包 · 开发方案

> 版本：**v2（2026-11-10，据实测修订）**
> 范围：让 iPhone 上「脚本插件」可以**下载 → 安装 → 使用**（当前在 iOS 上完全装不了）
> 一句话方案：**手机端用 App 自带的 WebView/Worker 直接执行插件脚本；宿主要提供的 API 少到只有一个方法。**

---

## 0. v2 修订说明（原 v1 的两条前提被实测推翻）

| v1 的判断 | 实测结果 | 影响 |
|---|---|---|
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

## 3bis. 原 v1 的"CI 预打包"设计（保留备查，v2 已不需要）

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

### 4.1 一支插件 = 一个包 = 一个 bundle

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

## 7. 实施路线（四阶段，每阶段可独立验收）

### 阶段 0 · 打通最小闭环（**先做这一步**）

- 选 **1 支**你登录要用的 `-auth` 插件
- 手工：`bun install` → `bun build` → 单文件 `.js` → 打成 iOS 资产
- 手机端：在 WebView 里加载并执行，接上宿主的 RPC
- **验收：真机上点一次，能完成登录** ✅ ← 整条路的成败点

### 阶段 1 · 写成定时 workflow

- GitHub Actions：**定时（每日/每周）+ 手动触发**
- 遍历注册表 112 支 → 逐支 bundle → 逐支出资产 → 校验 SHA-512 → 更新索引
- 失败支：记录原因并标注；**整批成功才动索引**
- **验收：改一支上游版本 ⇒ 次日软件里能看到该支更新**

### 阶段 2 · 扩面

- 覆盖全部可编译的支（预期见 §8）
- 对编不过的支：逐个判定"适配 / 内建成原生 provider / 放弃"

### 阶段 3 · UI 收尾

- 商店里标注「iOS 支持 / 不支持 + 原因」
- 安装弹窗：不支持时**禁用按钮并写明原因**（修掉当前"点了没反应"）
- 顺带修：`Agent2Builder/agent2api-providers-releases` 缺 `index.json`/`plugins.json` 导致的「插件清单不是有效 JSON」误报

---

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
