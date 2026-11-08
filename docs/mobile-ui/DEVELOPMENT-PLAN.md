# 手机端设置补全 · 开发方案

> 配套文档：`MOBILE-SETTINGS-GAP.md`（差集分析）、`CONTRACTS-FORWARDING.md` / `CONTRACTS-CONTENT.md` / `CONTRACTS-DATA-SYSTEM.md`（逐条 HTTP 契约，字段名逐字来自源码）
> 源码基准：上游 `aimod-cc/Agent2API` tag `v3.4.2`；手机端 `desktop-tauri/mobile/src/`
> 目标终局：**手机端成为唯一面板**（Phase 4 移除桌面面板），所以桌面设置里凡是对手机有意义的都要有入口。

---

## 0. 先读这一节：契约通则（写错任何一条都会连累每个模块）

### 0.1 响应信封

管理面（`/api/*`）成功响应统一是 **`{"success":true,"data":{…}}`**，失败是 `{"success":false,"error":"…"}`。

- 出处：`http.rs:1293-1297` 的 `ok_json()`，注释写明「所有 /api/* 路由都用它，保证与 Node 版 sendJson 的形状一致」。
- 手机端 `api/client.ts` 的 `apiCall()` **已经会解这个信封**（有 `data` 键就取出 `data`，`success===false` 就抛 `ApiError`）。
- 结论：新模块**不要**自己处理信封，直接 `apiCall<T>(path, init)`。

> ⚠️ 本次提取过程中，一个子代理曾断言「成功体是裸对象」——**该结论是错的**，已对照 `http.rs:1295` 源码与手机端既有可用行为推翻。评审时以本节为准。

### 0.2 路由表在哪

**不在** `api/mod.rs`（那只是模块声明）。真实路由表在：

```
desktop-tauri/src-tauri/server/src/server/http.rs
```

`CONTRACTS-*.md` 里每条端点都给了 `http.rs` 的行号，改接口时去那里核。

### 0.3 鉴权（所有新端点同一情况）

本方案涉及的全部端点都挂在 `http.rs` 的 **protected 组**（`require_api_key` 中间件），准入方式是「管理员面板会话」**或**「不受限的网关 API Key」。三种失败形态：

| 状态 | 语义 | 手机端应做的处理 |
|---|---|---|
| 401 `panel_login_required` | 没登录 / 会话过期 | `apiCall` 已自动续期并弹登录 |
| 403 `management_access_denied` | 用的是**受限 Key**，不允许打管理接口 | 需要给明确文案：「这个 Key 不是管理级，请用管理员账号」 |
| 500 | 例如 `/api/config` 加密不可用 | 原样显示后端 `error` |

**没有任何一条端点校验「网关是否在运行」** —— 不要在前端自己加这种前置判断。

### 0.4 「省略字段」有四种语义，不能一律处理 ★最容易踩

| 语义 | 出现在 | 前端写法 |
|---|---|---|
| **省略 = 不改**（null 也 = 不改） | `queue`、`retry`、`timeouts`、`captcha`、`prompt` 全局项 | 只发要改的键 |
| **省略 = 不改；null = 清除/回默认** | `promptProviders.<id>=null` 删这家、`promptGateway.<id>=null` 回默认、`promptGatewayText.<id>=null` 回官方原文、`sanitizeFingerprintRules=null` 回内置词表 | 「恢复默认」按钮显式发 `null` |
| **null = 类型错误 400** | `image_compress` 四项（源码注释：「本 PUT 没有删掉这一项的语义」） | 禁止发 null；没值就不发 |
| **null ≠ 不改，且会落盘** ⚠️ | `sanitizeFingerprintProviders=null` 会被归一成**空数组**，而空数组语义是「应用到**全部**提供商」 | 必须显式区分「不传该键」与「传 null」；要「不传」时用 `undefined` 构造 body |

另有两处特例：`config_api` 的 `apiKey: null` = **删除 Key**；`imageCompressEnabled` / `developerRoleCompat` 的默认值是「开」，且解析口径是**只有字面 `false` 才算关**（所以不能用 `!== true` 判断）。

### 0.5 写入粒度：整表替换 vs 稀疏更新

| 写法 | 端点 | 前端注意 |
|---|---|---|
| **整表替换** | `/api/sanitize` 词表、`/api/client-identification` 的 `config`、`/api/sidebar-layout` 的 `layout`、`/api/cline/headers` 的 `overrides` | 改一条也要**回发全量**；必须先 GET 再改再 PUT，不能凭本地状态拼 |
| **稀疏部分更新** | `/api/prompt` 的 `promptProviders` / `promptGateway` / `promptGatewayText` | 只发要改的那一家/那一段 |
| **乐观锁** | `/api/client-identification` | 带 `revision`；不符回 **409** → 提示「设置已被别处改过，请刷新」并重新 GET |

---

## 1. 批次总览

| 批次 | 内容 | 端点数 | 新建文件 | 需改 Rust | 建议顺序 |
|---|---|---|---|---|---|
| **批 1** | 转发行为：排队 / 重试 / 超时 / 图片压缩 / 开发者角色兼容 / 调试模式 | 10 | 2（api + page） | 否 | ① |
| **批 2** | 系统提示词、指纹脱敏 | 4 | 4（2 api + 2 page/sheet） | 否 | ② |
| **批 3** | 安全与数据：CORS / 机器人校验 / 数据保留 / 存储用量 | 6 | 2 | 否 | ③ |
| **批 4** | 识别与元数据：models.dev / 侧边栏布局 / ZCode 版本 / 验证码池 / Cline 头 | 6 | 3 | 否 | ④ |
| **批 5** | 更新与系统信息：出网代理 / beta / GitHub 访问 / system-info 补全 | 5 | 2 | 否 | ⑤ |
| **批 6** | 大件与 Rust：云同步、cc-switch 导入、**局域网访问**、端口 | 9 | 3 | **是** | ⑥ |

### 手机端的 UX 原则（贯穿所有批次）

1. **开关放设置页行，数值放子页** —— 手机上一行开关比进两级页面点一下更顺手。
2. **一页一组、各自独立保存** —— 不要让「同时改排队和超时」共用一次保存，一处校验失败整页报错。
3. **保存即生效，不做草稿持久化** —— 网关多数设置下一个请求就生效，页面顶部给「保存」按钮 + toast 即可（与 `RoutingPage` 一致）。
4. **服务端文案优先** —— 枚举标签（提示词模式、脱敏匹配方式、识别规则）一律用后端返回的 label，不在前端复制一份，避免漂移。
5. **危险操作二次确认**：「数据保留」调小会**立即裁剪且不可恢复**，必须走 `confirmDialog`。

---

## 2. 批 1 · 转发行为（优先做）

### 2.1 为什么先做

这些直接决定「请求成功还是失败、等多久、失败怎么重试」，而手机当唯一面板时完全调不了。全是「一个数字输入」级别的复杂度，一次能做完。

### 2.2 新建 `api/forwarding.ts`

```ts
import { apiCall } from './client'

/** 排队等待（`api/queue_api.rs`）。null/省略 = 该项不改 */
export type QueueSettings = { queueMaxWaits?: number; queueWaitSeconds?: number }
export const fetchQueue = () => apiCall<QueueSettings>('/api/queue')
export const putQueue = (body: QueueSettings) => apiCall<QueueSettings>('/api/queue', { method: 'PUT', body })

/** 重试（`api/retry_api.rs`）。retryCrossProviderCount 的键名是历史措辞，语义=换账号次数 */
export type RetrySettings = {
  retryCount?: number
  retryCrossProviderCount?: number
  retryIntervalSeconds?: number
  noRetryStatusCodes?: number[]
}
export const fetchRetry = () => apiCall<RetrySettings>('/api/retry')
export const putRetry = (body: RetrySettings) => apiCall<RetrySettings>('/api/retry', { method: 'PUT', body })

/** 四项上游超时（`api/timeouts_api.rs`），单位秒 */
export type TimeoutSettings = {
  connectTimeoutSeconds?: number
  headersTimeoutSeconds?: number
  streamIdleTimeoutSeconds?: number
  bodyTimeoutSeconds?: number
}
export const fetchTimeouts = () => apiCall<TimeoutSettings>('/api/timeouts')
export const putTimeouts = (body: TimeoutSettings) => apiCall<TimeoutSettings>('/api/timeouts', { method: 'PUT', body })

/** 会话图片压缩（`api/image_compress.rs`）。四项都**不接受 null**（会 400） */
export type ImageCompressSettings = {
  imageCompressEnabled?: boolean
  imageCompressMaxEdge?: number
  imageCompressQuality?: number
  imageCompressThresholdKb?: number
}
export const fetchImageCompress = () => apiCall<ImageCompressSettings>('/api/image-compress')
export const putImageCompress = (body: ImageCompressSettings) =>
  apiCall<ImageCompressSettings>('/api/image-compress', { method: 'PUT', body })

/** 开发者角色兼容（`api/role_compat.rs`）：developer 角色转 system */
export const fetchRoleCompat = () => apiCall<{ developerRoleCompat?: boolean }>('/api/developer-role-compat')
export const putRoleCompat = (developerRoleCompat: boolean) =>
  apiCall<{ developerRoleCompat?: boolean }>('/api/developer-role-compat', {
    method: 'PUT',
    body: { developerRoleCompat },
  })

/** 调试模式（`api/debug_api.rs`）：保存上游原始报文；limit 是只读容量上限（500） */
export type DebugSettings = { debugMode?: boolean; count?: number; limit?: number }
export const fetchDebug = () => apiCall<DebugSettings>('/api/debug')
export const putDebug = (debugMode: boolean) =>
  apiCall<DebugSettings>('/api/debug', { method: 'PUT', body: { debugMode } })
```

### 2.3 新建 `pages/ForwardingPage.tsx`（screen id `forwarding`）

**入口**：`MorePage` 的「转发链路」组，标题「转发设置」，副标题「排队 · 重试 · 超时 · 压缩」。

**结构**（一个页面，四个 `SectionHead` 分区，各自一个「保存」按钮）：

| 分区 | 控件 | 字段与范围 | 默认 |
|---|---|---|---|
| 排队等待 | 两个数字输入 | `queueMaxWaits` 0–10；`queueWaitSeconds` 0–120 | 2 / 0 |
| 重试 | 三个数字输入 + 错误码 chips | `retryCount` 0–10；`retryCrossProviderCount` 0–10（文案写「切换账号重试次数」）；`retryIntervalSeconds` 0–300；`noRetryStatusCodes` 每项 100–599、≤50 项 | 3 / 5 / 5 / `[402]` |
| 超时 | 四个数字输入 | 四项均 1–3600 秒 | 30 / 300 / 300 / 300 |
| 请求内容 | 一个开关 + 三个数字 | `imageCompressEnabled`；`imageCompressMaxEdge` 256–8192；`imageCompressQuality` 40–95；`imageCompressThresholdKb` 0–10240 | 开 / 2048 / 80 / 512 |
| 兼容与排障 | 两个开关 | `developerRoleCompat`（默认开）、`debugMode`（默认关，副标题写「保存上游原始报文，占空间，排障时才开」） | — |

**错误码 chips 实现要点**：`noRetryStatusCodes` 是数字数组，用输入框 + 回车成 chip、点 chip 删除。提交前过滤非 100–599 的值、去重、超过 50 项时拒绝并提示。

**数字输入的通用校验**：用一个 `numberField(field, min, max)` 工厂产出「标签 + 输入 + 范围提示 + 越界错误」，避免每组重复写。不在输入过程中强行改写用户输入，只在保存时校验。

**验收标准**
1. 进页能读到当前值（GET 三/四个端点并行）。
2. 改一个值 → 只发那一个键（PUT body 里不出现其它键），返回后页面显示后端生效值（不是本地 draft）。
3. 越界值被前端拦下并给出范围文案；后端也会 400，两种都要能显示。
4. 关掉调试模式后重新进页仍是关的（写盘成功）。
5. 切服务器后旧响应不覆盖新页面（沿用 `serverIdentity()` 守卫）。

---

## 3. 批 2 · 系统提示词 + 指纹脱敏

### 3.1 系统提示词 `pages/PromptPage.tsx`（screen `prompt`）

**端点**：`GET /api/prompt`（13 个响应键）、`PUT /api/prompt`（7 个请求键）。

**只读展示**（GET 带来、不用改）：`promptSource`、`promptFileError`、`promptLines`、`degradeActive`、`degradeUntil`、`degradeUntilText`、`promptProviderOptions`。

**三块可编辑区**：

1. **全局模式**：分段控件 `passthrough` / `custom` / `append`（标签用 `promptProviderOptions` 里的文案）；选 `custom` 时显示「提示词正文」多行输入（`promptText`），选 `append` 时说明「在官方提示词后追加」。`promptFile` 是文件路径（桌面端用本地文件），**手机端不暴露**，读取时只展示。
2. **分提供商覆盖**：列出已覆盖的提供商（`promptProviders.<id>`），每行显示模式与是否有正文，支持「编辑正文」「跟随默认」；`跟随默认` = 发 `promptProviders.<id> = null`（删这家）。
3. **网关自带提示词**：`promptGatewayText.<id>` 三段 `identity` / `stable` / `dynamic`，逐段编辑；`promptGateway.<id> = null` = 回默认。
4. **降级提示**：`degradeActive` 为真时顶部显示横幅（`degradeUntilText`），并提供「立即解除」（`clearDegrade: true`）。

**保存语义**：全部走**稀疏**更新 —— 只发改动的那一段/那一家。

**验收**：改全局模式为 `custom` + 正文 → 保存 → 刷新页面读回一致；把某家覆盖「跟随默认」→ 该家从列表消失（因为 `promptProviders.<id>` 被删）。

### 3.2 指纹脱敏 `pages/SanitizePage.tsx`（screen `sanitize`）

**端点**：`GET /api/sanitize`（8 键）、`PUT /api/sanitize`（3 键）。

**UI**
- 开关「剥离上游审核黑名单指纹」= `sanitizeBlacklistFingerprints`
- 「应用提供商」分段控件：全部 / 指定；指定时多选项来自 `providerOptions`
- 词表：`customRules`（自定义）+ `defaultRules`（内置）两组列表，每行显示名称/匹配方式/启用，点进 Sheet 编辑；支持新增、删除、恢复默认词表
- 每种匹配方式的可选值与角色选项来自后端的 `limits` 与 `roleOptions`，**前端不自造**

**规则元素 8 字段**（整表替换，一条也不能丢）：`id`、`name`、`enabled`、`matchType`、`pattern`、`replacement`、`repeat`、`roles`。

★ **最大的坑**：`sanitizeFingerprintProviders = null` 不是「不改」，它会被归一成空数组，而空数组 = **应用到全部提供商**并且**会落盘**。所以：
- 用户点「应用提供商 = 全部」→ 显式发 `providers: []`
- 用户根本没动这一项 → body 里**不要出现** `sanitizeFingerprintProviders` 键（用 `undefined` 构造对象，不要用 `null`）

**验收**：改开关 → 保存 → 只发 `sanitizeBlacklistFingerprints`；编辑一条规则 → 保存 → 全量回发（含未改动的规则）；点「恢复默认词表」→ 发 `sanitizeFingerprintRules: null` → 列表回到内置集合。

---

## 4. 批 3 · 安全与数据

### 4.1 开关类（直接进设置页，不新开页）

在设置页「网关」组下面新增一行「连接与安全」，点进一个小 Sheet，放三个开关 + 一段数据保留：

| 控件 | 字段 | 端点 | 说明文案 |
|---|---|---|---|
| 网关跨域访问（CORS） | `corsEnabled` | `GET/PUT /api/cors` | 「允许浏览器页面跨来源调用网关 `/v1/*`」 |
| 桌面端登录人机验证 | `captchaDesktop` | `GET/PUT /api/captcha` | — |
| 网页端登录人机验证 | `captchaWeb` | 同上 | — |

`/api/captcha` 的 GET 还会返回只读的 `localPanel`（当前是不是本机面板形态），用于解释为什么某一端开关不生效。PUT 支持只发一个键（`captchaDesktop?` / `captchaWeb?`），旧键 `captchaEnabled` 会同时写两端 —— **新代码不要用它**。

### 4.2 数据保留（设置页「数据」组新增一行 → Sheet）

**端点**：`GET/PUT /api/retention`（模块在 `api/stats_api.rs`，**不是** `config_api.rs`）。

| 字段 | 含义 | 范围 | 默认 |
|---|---|---|---|
| `logRetentionDays` | 事件日志保留天数 | 1–99999 | 30 |
| `logRetentionCount` | 事件日志条数上限 | 1–100000000 | 10000 |
| `requestLogRetentionDays` | 请求日志保留天数 | 1–99999 | 99999 |
| `requestLogRetentionCount` | 请求日志条数上限 | 1–100000000 | 1000000 |
| `dailyAggregateRetentionDays` | 按天聚合保留天数 | 1–99999 | 99999 |

★ **写后立即裁剪、不可恢复** —— 保存前必须 `confirmDialog`，文案写清「超出部分会被立即删除」。PUT 允许只发部分字段（`null` = 不改）。

### 4.3 数据存储用量（进现有 `SystemInfoSheet`）

`GET /api/storage` → `configDir` + `database{file, bytes, available, accounts, logs, requests, dailyDays, debug, downstreamRaw, upstreamRaw}`。

在 SystemInfoSheet 增加一节「存储」：数据库文件路径、占用大小（人类可读，用 `available` 判断是否可读）、以及六个计数。**只读**，不做清理按钮（清理靠数据保留）。

---

## 5. 批 4 · 识别与元数据

| 功能 | 端点 | 放哪 | 要点 |
|---|---|---|---|
| models.dev 元数据 | `GET/PUT /api/models/metadata` + `POST /api/models/metadata/refresh` | 设置页「模型」组一行开关 + 「立即刷新」 | GET 返回 `source`/`updatedAt`/`count`/`modelsDevEnabled`；refresh 有 1440 分钟间隔限制且**恒返回 2xx**（结果在 `result.status` 里，失败要看 `result.message`） |
| 侧边栏/宫格布局 | `GET/PUT /api/sidebar-layout` | 设置页「外观」组 | `layout` 是**整份替换**，落 `kv` 表的 `sidebarLayout` 键。手机上语义要改成「更多宫格的显隐与排序」——**不要照搬桌面的侧边栏结构**（宽/窄/分组是桌面概念）。实施前先 GET 看一次真实结构再定 schema |
| ZCode 客户端版本号 | `GET/PUT /api/zcode/version` | 设置页「网关」组 | 校验：≤32 字符、首字符必须是数字；GET 另给 `envOverride`（环境变量覆盖时会赢过界面值，要提示） |
| 验证码令牌池 | `GET/PUT /api/zcode/captcha-pool` | 插件页面组 | 仅当插件申报 `captcha_pool` 管理面板时才显示（`GET /api/plugins` 的 `adminPanels`）；三字段 1–10 / 1000–30000 / 1–5 |
| Cline 伪装头 | `GET/PUT /api/cline/headers` | 插件页面组 | 同上，需 `upstream_headers` 申报；`overrides` **整体替换**；固定头 `Authorization`/`Content-Type`/`Accept`/`X-Task-ID` 拒改（400）；≤64 项、名 ≤128、值 ≤4096 |

**已实现但需补一项**：手机端「客户端识别」已经在做（`ClientIdentificationPanel`），但 `/api/client-identification` 的 `revision` 乐观锁返回 **409** —— 复核现有代码有没有处理 409，没有就补「设置已被别处改过，已刷新」的提示 + 自动重新 GET。

---

## 6. 批 5 · 更新与系统信息

| 功能 | 端点 | 说明 |
|---|---|---|
| 出网代理 | `GET/POST /api/update/proxy`（`proxy`） | 手机端更新面板目前没有。放在 `AppUpdatePanel` 的「更新设置」里 |
| 关注 beta | `GET/POST /api/update/beta`（`enabled`） | 手机端有「关注 beta」文案但缺总开关；注意 `/api/update/channels` 的 `stable`/`beta` 与 `/api/update/beta` 会互相写（`enabled` 会同时改两个键），实现时以 `/api/update/beta` 为准 |
| GitHub 访问方式 | `GET/POST /api/update/github`（`mode`/`mirrorUrl`/`mirrors[{url,enabled,supportsApi}]`，最多 6 源） | 手机端已有 `GithubAccessSettings`，补「优先加速源 / 官方源状态 / 自定义前缀 / 补充内置备用源」的完整编辑 |
| 版本信息补全 | `GET /api/system-info`（`hideUsername`） | 6 大块约 45 字段。SystemInfoSheet 补 `security`（管理员已注册/面板登录/Key 数量/未注册闸门/允许裸跑/GitHub 令牌/更新线路）、`features`（各开关读数）、`stats`（在途请求/累计请求/待迁移旧数据）、`deployment`（程序路径/安装包形态） |
| 反馈入口 | 无端点 | 设置页「关于」组加三个跳转：问题反馈 / 功能建议 / 请求提供商支持（用桌面端同一批 URL，实现时从桌面源码 `settings-page.tsx` 取） |

---

## 7. 批 6 · 大件与需要改 Rust 的项

### 7.1 云同步（`GET/PUT /api/cloud-sync` 等 7 条）

15 个请求字段（`provider`/`webdav*`/`s3*`/`syncPassword`/`enabled`/`autoSync`/`remoteRoot`/`profile`），另有 `/test`、`/remote`、`/upload`、`/download`、`/import-key` 五条**都会出网**的操作。密码只回 `hasXxx` 布尔（不回明文）。

**建议单独立项**：字段多、有出网副作用、下载会**替换本机数据**（危险），值得单独一轮设计与验收。

### 7.2 cc-switch 导入（`GET /api/import/cc-switch`）

返回 13 字段/条目，含 **apiKey 明文**，`available:false` 也是 200（表示本机没有 cc-switch 数据）。手机上意义有限（cc-switch 是桌面工具），**建议只做「读到就展示、勾选导入」，不做完整编辑**，或直接延后。

### 7.3 局域网访问（需要改 Rust）

**现状**：supervisor 拉起网关时硬编码 `.env("AGENT2API_HOST", "127.0.0.1")`（`agent2api-supervisor.rs` 的 `start_child`），网关只监听回环。手机端设置里也没有对应开关。

**要做**：
1. `agent2api-supervisor.rs`：从 `state.home` 下读一个配置文件（例如 `supervisor.json` 的 `host` 字段），传给 `AGENT2API_HOST`；默认仍是 `127.0.0.1`。
2. 控制 API 增 `POST /config`（改 host 后重建子进程）。
3. 手机端设置页「服务」组加开关「允许局域网访问网关」，副标题提示**暴露面**（同网段设备可访问，需配合网关 Key）。
4. 端口可配置：`gateway_port` 目前是固定 3065，同一条链路一起做成可配置（改完要通知 App 侧的新地址）。

**为什么单列**：这是本方案里**唯一要改 Rust + 重新编译**的项，风险与验证成本都高于前面所有批次，且涉及安全取舍（是否允许同网段访问），需要你单独拍板。

---

## 8. 通用实现约定

### 8.1 页面骨架（照抄 `RoutingPage.tsx`）

```tsx
export function XxxPage() {
  const identity = serverIdentity()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [draft, setDraft] = useState<Settings | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const next = await fetchXxx()
      if (serverIdentity() === identity) { setSettings(next); setDraft(next) }
    } catch (cause) {
      if (serverIdentity() === identity) setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [identity])

  useEffect(() => { void load() }, [load])
  const pull = usePullToRefresh({ onRefresh: () => void load() })

  const save = async () => {
    if (busy || !draft) return
    setBusy('save'); setError('')
    try {
      const next = await putXxx(patch(draft, settings))   // 只发改动的键
      if (serverIdentity() !== identity) return
      setSettings(next); setDraft(next)                    // 用后端返回值回填
      store.toast(t('已保存，下一个请求生效'))
    } catch (cause) {
      if (serverIdentity() === identity) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (serverIdentity() === identity) setBusy('')
    }
  }
  // PageHead（title/subtitle/actions=保存）+ SectionHead + Card + ErrorNote + PullIndicator
}
```

**必须有的三件事**：`serverIdentity()` 守卫（切换服务器后旧响应不能覆盖）、`busy` 防重入、**保存后用后端返回值回填**（不要乐观更新本地 draft）。

### 8.2 新增页面要动的地方

1. `lib/routes.ts` 的 `SCREEN_IDS` 加 id
2. `App.tsx` 的 `SCREENS` 加 `{ title: t('…'), component: XxxPage }`
3. `MorePage.tsx` 对应分组加条目，或 `SettingsPage.tsx` 加行
4. 新 API 模块放 `src/api/<name>.ts`

### 8.3 i18n

`t()` 是「中文即键、缺译回落中文」。**新增文案不必改词典**，但也只有中文 —— 与现有手机端新增页面一致，可接受。若要跟上其它 5 种语言，需要往 `ui/i18n.js` 那份共享词典补键（那是上游产物，会被升级覆盖，需要单独讨论策略）。

### 8.4 错误文案

后端错误串（`error`）已经是中文可读文案，直接显示。前端只在两处自己写文案：
- 403 `management_access_denied` → 「当前凭证不是管理级，请用管理员账号登录」
- 409（客户端识别）→ 「设置已被别处改过，已重新读取」

### 8.5 数字输入

用 `inputMode='numeric'`；保存时 `Number()` 后校验 `Number.isInteger` 与范围；越界不静默 clamp 而是报错（静默改写用户输入会让人以为存进去了）。

---

## 9. 测试与交付流程

| 阶段 | 做什么 | 谁能做 |
|---|---|---|
| 本地 | `pnpm exec tsc --noEmit` + `pnpm run build`（必须 exit 0） | 我（本机有 node/pnpm） |
| CI | `workflow_dispatch`，`only=store`（同时跑 plugins + ios，带插件包）、`publish=true` | 我 |
| 产物校验 | `verify_deb.py` 比对 deb 内 `mobile.js` 哈希与本地构建一致；确认 `bin/agent2api-supervisor` 存在 | 我 |
| 真机 | 装 deb → 逐项改一次设置 → 杀掉 App 重进 → 值仍在；改「数据保留」确认有二次确认 | 你（无终端，靠 Sileo/App） |

**每批独立可交付**：一批做完就出一次 deb，不必等全部批次。

---

## 10. 风险与未确认项

| 项 | 说明 | 处理 |
|---|---|---|
| `sanitizeFingerprintProviders=null` | 会落盘成「应用到全部提供商」，与其它模块的 null 语义相反 | 批 2 实现时写单测式注释，并在代码里显式区分 `undefined` / `[]` |
| `/api/prompt` 的 `promptFile` | 桌面端指向本地文件；手机端没有这个概念 | 只读展示，不提供编辑 |
| `/api/sidebar-layout` 的真实结构 | 未见过实际数据；桌面是宽/窄/分组，手机是宫格 | 批 4 动手前先 GET 一次线上数据再定 schema |
| 云同步的落库键名 | 契约文档标注 `(未确认)` | 批 6 单独核对后再做 |
| `update/policy` 的 `forceUpdate` 内部字段 | `(未确认)` | 手机端只用现有 `RequiredUpdateGate` 行为，不改 |
| `system_info::deployment()` 取值域 | `(未确认)` | 只展示，不做分支判断 |
| 新文案只有中文 | i18n 词典是上游产物 | 已接受，记为已知限制 |
| 局域网访问的安全取舍 | 打开后同网段可访问网关 | 需要你单独拍板（批 6） |

---

## 11. 建议的开工顺序

1. **批 1 一次做完**（转发设置页 + 6 组开关），出一版 deb 给你验。
2. 批 2（提示词、脱敏）—— 数据模型最复杂，单独一轮。
3. 批 3 + 批 5（开关与只读信息，风险低，可合并一轮）。
4. 批 4（识别与元数据）。
5. 批 6（云同步 / cc-switch / 局域网）—— 云同步与局域网各需单独决策。
