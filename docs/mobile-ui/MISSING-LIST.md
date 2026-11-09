# 手机端 · 完整缺失清单（逐条带端点与参数）

> 依据：网关 **223 个端点**（上游 v3.4.2 `http.rs`）× 两侧源码的真实引用。
> 方法与误差口径见 [`FEATURE-PARITY.md`](./FEATURE-PARITY.md) §1–§2。
> **本清单取代 `GAP.md`（2026-11-08）的"确认缺失 19 组"**——那份已过期，见 §F。

---

## 0. 一句话结论

**真实缺失 = 10 条功能 + 1 个 bug。**

不是旧文档说的"19 组"，也不是"大部分设置都没有"：手机端在 **41 个模块上端点级已对齐**
（账号、模型、路由、代理、云同步、插件、助手、工具、设置各细分项、更新、调度…）。

| 类别 | 条数 | 处理态度 |
|---|---|---|
| A. 真缺口 | **12** | 要补（本清单 §A）。其中 4 条由 §E 的逐页核对**升格**而来，另有 **1 条经复查撤销**（原 A13 工具服务文档，见 §H.2） |
| B. 真 bug | **1** | 先修（本清单 §B） |
| C. 平台不适用 | 20 | **不要派活**（§C 给了理由） |
| D. 已用等价端点实现 | 11 | 不用动（§D） |
| E. 需逐页核对（未定论） | 若干 | 先核对再决定（§E） |

---

## A. 真缺口（13 条）

> 2026-11-09 更新：§E 的逐页核对做完后，**升格 4 条**（原 E1/E5/E8/E10 → A11–A14），
> 并**撤销 1 条**（原 A9 模型映射新增 —— 核实发现手机端已经实现了新增，见 A9 的说明）。

每条格式：**端点/参数 → 桌面入口 → 手机现状 → 证据 → 影响 → 量级**。

### A1 短信验证码登录—— **✅ 已实现（2026-11-09）**
- 端点：
  - `POST /api/session/login/sms/send` — body `{ provider, phone }`
  - `POST /api/session/login/sms/verify` — body `{ provider, phone, code, name, id, deviceId, accounts }`
  - `POST /api/session/login/tabbit/sms/send`、`POST /api/session/login/tabbit/sms/verify`
  - `POST /api/session/login/loomy/sms/send` — `{ phone }`
  - `POST /api/session/login/loomy/sms/verify` — `{ phone, code, msgid, id, name, accounts }`
  - `POST /api/session/login/kuku/complete`
  - `GET|POST /api/session/login/oauth/captcha-config`
- 桌面入口：添加账号弹窗（`add-account-modal.tsx`、`add-account-kit.tsx`、`add-provider-tabbit.ts`、`add-account-dynamic-fields.ts`）
- 手机现状：**已有** OAuth 登录（`api/add-account-dynamic.ts` 用 `login/start`+`login/wait`+`login/callback`）
  与"导入授权文件"；**没有短信登录**——手机端源码里搜不到任何 `sms` 相关字符串
- 证据：`api/add-account-dynamic.ts`（现有流程）；手机端全树无 `login/sms`
- 影响：加账号的核心路径缺一种方式；对很多只用短信登录的上游等于无法添加账号
- 量级：**M**（一套"发码 → 填码"两屏 + 3 家提供商的参数差异 + 错误码处理）

### A2 从文件安装插件包 —— **✅ 已实现（2026-11-09）**
- 端点：`POST /api/plugins/install` — body `{ packB64 }`（base64 的包）
- 桌面入口：插件页（`plugins-page.tsx`），选本地包安装
- 手机现状：有 `/api/plugins`、`install-from-release`、`update`、`uninstall`、`enable`、`settings`、`provider`、`release`，**没有本地文件安装**
- 证据：`api/plugins.ts` 的端点清单
- ⚠️ 检索陷阱：`plugins/install` 是 `plugins/install-from-release` 的**子串**，关键词检索会假命中
- 影响：无法用插件作者给的离线包；只能装"发布源"里的
- 量级：**M**（iOS 侧要用文件选择器读成 base64，并在真机上验证大包）

### A3 日志统计
- 端点：`GET /api/logs/stats`（无参）
- 桌面入口：日志页统计卡（`logs-panel.tsx`、`logs-model.ts`）
- 手机现状：有 `GET /api/logs`（查询）与 `/api/logs/download`（下载），**没有统计**
- 证据：`api/gateway.ts` 只引用了 `logs` 与 `logs/download`
- 影响：看不到"各类日志条数/占用"这类概览
- 量级：**S**

### A4 请求记录维护三件套 —— **✅ 已实现（2026-11-09）**
- 端点：`GET /api/stats/requests/filters`、`GET /api/stats/requests/clear-preview`、`POST /api/stats/requests/compact`
- 桌面入口：请求页「清理」弹窗（`request-clear-modal.tsx`）
- 手机现状：有 `GET /api/stats/requests`、`/raw`、`POST /api/stats/requests/terminate`，**没有清理与压实**
- 证据：`api/gateway.ts`、`api/request-raw.ts` 的端点清单；全树无 `clear-preview`/`compact`
- 影响：手机上无法清理历史请求、无法压实库（长期使用后库会涨）
- 量级：**M**（要先定"清理范围"的交互，且这是**不可恢复**操作，必须二次确认 + 预览）

### A5 精简路由（compact routes）—— **✅ 已实现（2026-11-09）**
- 端点：`GET|PUT /api/models/compact-routes`
- 桌面入口：模型页「精简」（`models-compact-dialog.tsx`、`models-compact-state.ts`）
- 手机现状：模型相关有 `manage`、`custom`、`state`、`mappings/remove`、`refresh`、`metadata`、`test`、`capabilities`，**没有 compact-routes**
- 证据：`api/gateway.ts` 与 `api/model-metadata.ts` 的端点清单
- 影响：无法在手机上做"模型名精简/别名"这类配置
- 量级：**S～M**（取决于 PUT 的载荷结构，实施时先核）

### A6 面板账户信息
- 端点：`GET /api/panel/account`（回用户名与"是否已注册"等）
- 桌面入口：设置 → 账户（`settings-model.ts` 里定义了 `PanelAccount` 类型）
- 手机现状：有 `POST /api/panel/change-password`，**没有读取账户信息**；登录页只用 `GET /api/panel/status` 判断是否已注册
- 证据：手机端全树无 `panel/account`；`api/auth.ts` 只有 login/logout/setup/status/captcha
- 影响：面板里看不到"当前是谁"，改密码页也缺上下文
- 量级：**S**（只读接口 + 一张卡）

### A7 原始配置读写（`/api/config`）—— **✅ 调研完成 + 唯一需要的一项已实现（2026-11-09）**
- 端点：`GET|POST|PUT /api/config`
- 桌面入口：设置页若干高级项（`settings-model.ts`、`settings-state.ts`）
- 手机现状：手机端把设置**拆成细粒度端点**已覆盖大部分（`/api/queue`、`/api/retry`、`/api/timeouts`、
  `/api/debug`、`/api/image-compress`、`/api/cors`、`/api/captcha`、`/api/sanitize`、`/api/prompt`、
  `/api/storage`、`/api/retention`、`/api/developer-role-compat`、`/api/models/metadata` 等），
  **但没有整份配置的读写**
- 证据：全树无 `/api/config`
- 影响：**目前无法判定**——要看是否有设置项**只存在于 `/api/config`** 而没有细粒度端点
- 量级：**先调研**（S 调研 → 结论可能是不用做，或补 1～3 个细粒度端点）
- ⚠️ **建议**：不要为了"对齐"就把整份原始配置暴露到手机上（那是全量写入口，风险远大于收益）

### A8 自动签到「立即运行」
- 端点：`POST /api/auto-checkin/run`（无参）
- 桌面入口：签到页（`checkin-center-tab.tsx` 一带）
- 手机现状：有 `/api/auto-checkin`（读配置）、`/api/checkin-schedules`、`/api/checkin-activity`、
  `/api/checkin-keepalive`、`/api/checkin-records`、`/api/travel-schedule`，**没有"立刻跑一次"**
- 证据：`api/checkin.ts` 的端点清单里无 `auto-checkin/run`
- 影响：改完配置想立刻验证时只能等下一个计划点
- 量级：**S**

### ~~A9 模型映射「新增」~~ —— **已核实为已实现，本条撤销**
- 端点：`POST /api/models/mappings`（body 含 `create`、`enabled`、`reasoning` 等键）
- 桌面入口：模型页（`models-dialogs.tsx`、`models-cells.tsx`）
- 手机现状：有 `mappings/remove`，另有 `mappings${action}` 形式（`lib/assistantTools.ts`）
- 证据：`api/gateway.ts`、`lib/assistantTools.ts`
- **核实结果（2026-11-09）**：手机端 `lib/assistantTools.ts` 写的是
  `` `/api/models/mappings${action === 'remove' ? '/remove' : ''}` `` ——
  **非 remove 时就是 POST `/api/models/mappings`（新增）**；`api/gateway.ts` 用的是 `/remove` 那条。
  ⇒ 新增与删除都已有，**本条撤销**（依据见 §E 的 E6 行）

### A10 zcode 领取校验
- 端点：`POST /api/zcode/claim-verification`
- 桌面入口：账号页 zcode 领取（`accounts-zcode-plan.tsx`、`zcode-plans-modal.tsx`）
- 手机现状：有 `/api/zcode/captcha`、`/api/zcode/captcha-pool`、`/api/zcode/version`；**没有领取校验**
- 证据：`api/zcode.ts`、`api/plugin-settings.ts`
- 影响：zcode 领取流程里少一步校验（该流程是否在手机上完整，需一并核对）
- 量级：**S**（但要看它和 A1 的短信/验证码链路是否耦合）

### A11 账号限流器配置（原 E1 升格）—— **✅ 已实现（2026-11-09）**
- 端点：`/api/accounts/limiters`（**是 `/api/accounts/{*rest}` 的子路径**；上游 `api/accounts.rs` 的
  分派键里有 `limiters` / `concurrency` / `usageQuery`）
- 桌面入口：`accounts-limiter-{types,model,condition,status}.tsx` + `accounts-dialog-limiter.tsx`
  （5 个文件：限流条件、按模型的限额、状态展示、弹窗）
- 手机现状：**全树没有 `limiter`**（`/api/accounts/limiters` 也没被调用）；
  手机端 `/api/accounts` 的子路径只用到 `batch`/`current`/`export`/`import`/`refresh`/
  `refresh-expiring`/`usage`/`usage/snapshot`/`connections`/`reorder` 等
- 影响：无法在手机上配置"某账号在某模型下的并发/窗口限额"，账号被上游限流时只能切桌面
- 量级：**M**（先核对 `/api/accounts/limiters` 的载荷结构与语义：是整表替换还是稀疏更新）

### A12 积分简报与签到活动状态（原 E5 升格）
- 端点：`GET /api/usage`（积分简报）、`GET /api/checkin/status`（签到活动状态）
- 桌面入口：`balance-query.tsx`、`accounts-credit-detail.tsx`、`ui-shared/credit-expiry.ts`
- 手机现状：全树无这两个端点；手机有 `/api/accounts/usage`（**账号额度**，概念不同）与
  `lib/usage.ts` 的 `creditExpiry`
- 影响：看不到"活动积分/签到活动"这类概览（与"账号额度"不是一回事）
- 量级：**S**

### ~~A13 工具服务 API 的文档与调试入口~~ —— **复查后撤销**
- 端点（**接口本身手机上已经在提供**，缺的是"展示与调试"）：
  `POST /api/web-search/search`、`POST /api/web-search/fetch`（以及 `/mcp/*`、`/skill/*`）
- 桌面入口：`ui-shared/tools-api-doc.ts`、`docs-api-tools.ts`、`docs-api-endpoints.ts`、
  `ui-islands/src/islands/tools-detail.tsx`
- 手机现状：全树无 `web-search` / `tools-api` / 「工具服务 API」字样；
  `pages/DocsPage.tsx` 是手机端文档页，但没有这一节
- ~~影响~~ / ~~量级~~
- **复查结论（2026-11-09，撤销本条）**：手机端文档页 `pages/DocsPage.tsx` 用的是**共享组件**
  `ui-shared/docs-api-browser`，而它会调 `apiReferenceSections()` —— 其中已经包含
  `toolApiSections`（`ui-shared/docs-api-tools.ts` → `tools-api-doc.ts` 那份 Markdown），
  并且有专门的 `MarkdownArticle` 与「复制文档」按钮。⇒ **手机端本来就有这份文档**。
- **我当时为什么会判错**：只在 `desktop-tauri/mobile/src` 里搜，而手机端**大量复用 `ui-shared`**。
  搜不到 ≠ 没有（详见 §H.2 的方法教训）。

### A14 路由组的「结构性编辑」（原 E10 升格）—— **✅ 已实现（2026-11-09）**
- 端点：`PUT /api/routing/groups`（**载荷的其余字段**）
- 桌面入口：`routing-group-form.tsx`、`routing-member-card.tsx`、`routing-account-order.tsx`、
  `routing-account-sections.ts`（对外模型 ID / 策略 / 粘性 / 成员增删 / 账号范围）
- 手机现状：② 那轮**刻意只做了安全子集**——`pages/routing-group-edit-sheet.tsx` 只改
  **组名 / 说明 / 成员参与开关**；对外模型 ID、策略、粘性、成员增删、账号范围**都不能改**
- 影响：手机能"调参"但不能"改组结构"，改结构还得切桌面
- 量级：**M** ⚠️ **动手前必须先评估**：`RoutingGroup` 是 `deny_unknown_fields`，且策略/粘性/成员
  与上游路由语义强耦合（例如改 `model` 会影响请求匹配、改粘性会清 sticky 状态）。
  这是"从安全子集扩到完整编辑"，语义风险高于普通字段，**不要顺手做**

---

## B. 真 bug（先修）

### B1 备份恢复进度轮询路径错误
- 现象：手机端 `api/backup.ts` 与 `pages/backup-restore-sheet.tsx` 请求
  **`/api/backup/restore/progress`**；网关只有 **`/api/backup/progress`**
  （处理器 `api::backup_api::restore_progress`）
- 证据：上游 `http.rs` 的路由表（`/api/backup/export`、`/import`、`/progress`、`/download`、`/upload` 五条，
  没有 `restore/progress`）；手机端两处字符串
- 后果：**恢复进度永远 404**，界面只能显示"开始/结束"，中间过程不可见
- 修法：两处路径改成 `/api/backup/progress`
- 量级：**S（一行级）**，但属于"当前就在出错"，应最先修

---

## C. 平台不适用（**不要派活**）

| 桌面能力 | 端点 | 为什么手机上不做 |
|---|---|---|
| 把配置写进本机 CLI 客户端 | `POST /api/agents/apply`、`POST /api/agents/import`、`POST /api/agents/profiles` | 目标是**本机安装的** Claude Code / Codex / Cursor CLI / Zed 等；iOS 上没有这些客户端，没有落点。手机端保留 `agents` 列表 + `preview` + `restore`（查看与还原） |
| 给 CLI 客户端装 skill/MCP 资源 | `POST /api/agents/{id}/resources/preview`、`/apply` | 同上；这些资源装到桌面客户端目录 |
| 扫描 cc-switch | `GET /api/import/cc-switch` | 扫的是**本机** cc-switch 的 SQLite；且**桌面端自己也把入口隐藏了**（`add-provider-pick.tsx` 注释写明 `false`） |
| 网关自升级 | `GET /api/upgrade`、`POST /api/upgrade/run` | Linux systemd / Windows 服务形态的自我替换；iOS 走装新 deb |
| 数据面 + 对外接口（`/v1/*`、`/mcp/*`、`/skill/*`、`/api/web-search/{search,fetch}`） | ⚠️ **这条不是「做不出来」**：这些接口**手机上已经在提供** —— 网关是同一个进程，装在手机上就监听 `3065`，开了「局域网访问」后同网段设备可直接使用。面板不需要「实现」它们，因为它们不是面板功能。**真正缺的只是它们的文档/调试入口**，已升格为 **§A13** |
| 网关侧会话 | `POST /api/session/logout`、`POST /api/session/refresh` | 面板自己的会话走 `/api/panel/*`（手机已有） |
| 已下线 | `/api/subscriptions*` | 返回 410 `retired_proxy_feature` |
| 桌面外壳 | 托盘、窗口、网格布局、表格列设置（`tray.rs`、`sidebar-pane.tsx`、`table-col-settings.tsx`） | 手机没有对应外壳 |
| 按服务器路径导出/导入备份 | `POST /api/backup/export`、`/import`（`filePath`） | 手机上等价物是**下载/上传**整包（已有） |

---

## D. 已用等价端点实现（不用动）

| 桌面端点 | 手机端的做法 | 证据 |
|---|---|---|
| `/api/proxies`（`ANY` 子路径分发器） | 直接用子路径 `/api/proxies/pool*`、`/settings`、`/test` | `api/gateway.ts` |
| `/api/checkin`、`/api/checkin/status`、`/api/usage` | 用新版 `/api/checkin-center`、`/checkin-activity`、`/checkin-keepalive`、`/checkin-records`、`/checkin-schedules`、`/travel-schedule` | `api/checkin.ts` |
| `/api/routing/workspace` | **在用**（写作 `…workspace${scope}`） | `pages/routing-workspace.tsx`、`pages/routing-profile.tsx` |
| `/api/checkin-records` | 在用 | `api/checkin.ts` |
| `/api/backup/download`、`/upload` | 在用 | `api/backup.ts` |
| `/api/model-meta`（旧名） | 手机用 `/api/models/metadata`（+`/refresh`） | `api/model-metadata.ts` |
| `/api/role-compat`（旧名） | 手机用 `/api/developer-role-compat` | `api/forwarding.ts` |
| `/api/session/login/callback`、`/wait`、`/cancel` | 在用（OAuth 流程） | `api/add-account-dynamic.ts` |
| `/api/accounts/{*rest}` 的多数子路径 | 在用（`export`/`import`/`batch`/`refresh`/`usage`…） | `api/gateway.ts` |
| `/api/update/{*rest}` 各子路径 | 在用（`check`/`channels`/`policy`/`github`/`token`…） | `lib/appUpdate.ts`、`components/*` |
| `/api/tools/{*rest}` 的子路径 | 在用（`servers`/`providers`/`vision`/`install-*`） | `api/tools-install.ts`、`pages/ToolsPage.tsx` |

---

## E. 逐页核对结果（2026-11-09 已完成）

**核对方法**：对每一项，在**手机端全树**搜该功能的端点/字段关键词（不是只搜文件名匹配的文件），
并与桌面端对应的子功能文件逐项对照。

> ⚠️ 方法上的坑（我踩过）：第一版核对只在"文件名命中关键词"的少数文件里找端点，于是
> `/api/stats/summary`（实际在 `api/gateway.ts`）被报成"未见"。**这种假阴性会把已实现的功能判成缺口。**
> 下表用的是"全树搜索"的结果。

| 原编号 | 项 | 判定 | 依据 |
|---|---|---|---|
| E1 | 账号限流器配置 | **真缺口 → §A11** | 全树无 `limiter`；网关子路径 `/api/accounts/limiters` 存在但未被调用；桌面有 5 个 limiter 文件 |
| E2 | 补签 | **已实现**（交互形态与桌面不同） | `api/checkin.ts` 有 `makeup` 类型与「补签轮时刻」；`CheckinRecords.tsx`、`CheckinSchedules.tsx` 都涉及补签 |
| E3 | 签到计划 extras | 主体已实现，明细待比 | 手机有 `/api/checkin-schedules`（POST / delete / run）；桌面的 `checkin-schedule-extras.tsx` 附加项是否齐需逐字段比 |
| E4 | 报表 | **已实现**（维度待比） | 手机用 `/api/stats/summary` + `/api/stats/requests`，并用自绘 `components/MobileReportTrend.tsx` 出图（不用 recharts） |
| E5 | 积分简报 / 签到活动状态 | **真缺口 → §A12** | 全树无 `/api/usage`、`/api/checkin/status` |
| E6 | 模型映射「新增」 | **已实现 → 撤销 A9** | `lib/assistantTools.ts`：`` `/api/models/mappings${action === 'remove' ? '/remove' : ''}` `` |
| E7 | 账号批量操作 | **已实现** | `/api/accounts/batch` 在 `api/gateway.ts` 与 `pages/AccountsPage.tsx` |
| E8 | 工具服务 API 文档 | **已实现（撤销 A13）** | 手机端复用共享的 `DocumentationBrowser`，它已含 `toolApiSections`；只在 `mobile/src` 里搜会漏掉共享层 |
| E9 | 助手（子功能） | 主体已实现，子项待比 | 手机 14 个助手相关文件（chat/sessions/images/附件/模型选择/工具/历史）；桌面 39 个（含回放、消息操作等更细能力） |
| E10 | 路由组结构编辑 | **真缺口（部分）→ §A14** | 手机 `routing-group-edit-sheet.tsx` 只改 组名/说明/成员参与；对外模型 ID、策略、粘性、成员增删、账号范围不可改 |
| E11 | 设置项字段级 | 转 **M3 调研** | 主要设置项手机端都有对应细粒度端点（`queueMaxWaits`/`retryCount`/`connectTimeoutSeconds`/`promptMode`/`sanitizeFingerprintProviders` 等均已使用）；`/api/config` 是否独占某些项未定论 |
| E12 | 请求详情 / 重放 | **已实现** | `/api/stats/requests/raw` + `/api/routing/replays` + `components/RequestRawPanel.tsx` + `pages/routing-replay.tsx` |

**结论**：12 项里 **5 项已实现**（E2/E4/E6/E7/E12）、**4 项是真缺口**（E1/E5/E8/E10，已升格为 §A11–A14）、
**3 项只是明细待比**（E3/E9/E11，其中 E11 已转为调研项）。

---

## F. 旧文档的过期结论（**逐条已实现，勿再派活**）

`GAP.md`（2026-11-08）说"确认缺失 19 组"，其中这些**现在都已实现**（每条给出手机端覆盖文件）：

| 旧文档说"缺" | 端点 | 现在覆盖它的手机端文件 |
|---|---|---|
| 排队等待 | `/api/queue` | `api/forwarding.ts` |
| 重试策略 | `/api/retry` | `api/forwarding.ts` |
| 超时 | `/api/timeouts` | `api/forwarding.ts`、`api/routing.ts` |
| 系统提示词 | `/api/prompt` | `api/prompt.ts`、`pages/PromptPage.tsx` |
| 指纹脱敏 | `/api/sanitize` | `api/sanitize.ts`、`pages/SanitizePage.tsx` |
| 调试模式 | `/api/debug` | `api/debug-traffic.ts`、`components/DebugTrafficPanel.tsx` |
| 图片压缩 | `/api/image-compress` | `api/forwarding.ts` |
| CORS 开关 | `/api/cors` | `api/security.ts` |
| 机器人校验开关 | `/api/captcha` | `api/security.ts` |
| 数据保留 | `/api/retention` | `api/storage.ts`、`pages/data-storage-sheet.tsx` |
| 数据存储用量 | `/api/storage` | `api/storage.ts`、`pages/data-storage-sheet.tsx` |
| models.dev 元数据 | `/api/models/metadata` | `api/model-metadata.ts` |
| 开发者角色兼容 | `/api/developer-role-compat` | `api/forwarding.ts` |
| 云同步 | `/api/cloud-sync` | `api/cloud-sync.ts`、`pages/cloud-sync-sheet.tsx` |
| 验证码令牌池 | `/api/zcode/captcha-pool` | `api/plugin-settings.ts` |
| Cline 伪装头 | `/api/cline/headers` | `api/plugin-settings.ts` |
| ZCode 客户端版本 | `/api/zcode/version` | `api/plugin-settings.ts` |
| 侧边栏菜单定制 | `/api/sidebar-layout` | `lib/grid-layout.ts` |
| 改密码 | `/api/panel/change-password` | `pages/change-password-sheet.tsx` |
| 备份恢复 | `/api/backup/*` | `api/backup.ts`、`pages/backup-restore-sheet.tsx` |
| 客户端识别 | `/api/client-identification` | `api/client-identification.ts`、`pages/SettingsPage.tsx` |
| 更新通道 | `/api/update/channels` | `api/updates.ts` |
| 调度任务 | `/api/scheduled-tasks` | `api/gateway.ts`、`lib/appUpdate.ts` |
| 自动签到 | `/api/auto-checkin` | `api/checkin.ts` |
| 签到中心 | `/api/checkin-center` | `api/checkin.ts`、`api/gateway.ts` |
| 代理池 | `/api/proxies/pool` | `api/gateway.ts` |
| 自定义供应商 | `/api/custom-providers` | `api/custom-providers.ts` |
| 工具服务 | `/api/tools/*` | `api/tools-install.ts`、`pages/ToolsPage.tsx` |
| 插件 | `/api/plugins*` | `api/plugins.ts`、`pages/PluginsPage.tsx` |

> 另有 5 条旧文档说"缺"的其实**当时就有**：局域网访问（已实现，见 `DEVELOPMENT-MEMO.md` 步骤 21–27）、
> 面板端口/托管（同上）、退出登录、主题/语言、整库备份恢复。

**⇒ 结论：`GAP.md` 的缺失清单不可再用。** 该文件顶部已加指向本清单的提示。

---

## G. 反向差异（手机端有、桌面端没有）

| 手机端能力 | 说明 |
|---|---|
| supervisor 服务控制 | 启动/停止/重启网关、查看心跳（iOS 特有，桌面端网关由壳自己管） |
| 局域网访问开关 | 本次会话实现（iOS 特有） |
| "更多"宫格 | 手机特有的导航结构 |
| 安装到桌面（PWA/快捷方式） | 手机特有入口 |

（这些不是"桌面端缺失"，只是平台结构不同，记录以免被误当成缺口。）

---

## H. 口径提醒

### H.1 端点被引用 ≠ 字段做全

本清单的"有/没有"是**按端点引用**判定的，属于**必要证据但不是充分证据**：
端点被引用 ≠ 每个字段都做了。做实现计划时，A 类每条都要走一遍"契约先核对"，
不要照抄本清单的字段列表。

### H.2 ★ 搜索范围必须包含共享层（我在这上面判错过两次）

手机端**大量复用** `desktop-tauri/ui-shared` 与 `ui-kit`，所以"在 `mobile/src` 里搜不到"
**不能**推出"手机上没有"。已经因此判错两次：

| 误判 | 真相 | 教训 |
|---|---|---|
| A9 模型映射新增 | `mobile/src/lib/assistantTools.ts` 里有（判错是因为关键词写法） | 关键词要覆盖多种写法 |
| **A13 工具服务 API 文档** | 手机端文档页用共享的 `DocumentationBrowser`，其中已含工具服务 API 的 Markdown 文档 | **搜索范围要含 `ui-shared` / `ui-kit`** |

⇒ 核对任何一项时，**三处都要搜**：`mobile/src`、`ui-shared`、`ui-kit`。
（本轮已按此复查全部 A 项：除 A13 撤销外，其余缺口在共享层确实也没有。）

---

## I. 旧文档归档（删除前逐份清点）

2026-11-09：把 `docs/` 下与本次对比重叠的旧分析文档**逐份读过**，内容去向记在这里，然后删除。
两个目的：**不留会误导的过期文档**（旧 `GAP.md` 说"缺 19 组"，其中 30 条其实早已实现），
以及**保证删掉的信息不丢**。

### I.1 已删除（7 份）与内容去向

| 原文件 | 日期 / 基准 | 它做过什么 | 现状 | 内容去向 |
|---|---|---|---|---|
| `docs/mobile-ui/GAP.md`（10.4 KB） | 2026-11-08，手机 21 个 screen | 桌面设置页 11 分区 × 约 267 条目 vs 手机设置页的**设置项差集**，结论"确认缺失 19 组" | **过期**：30 条已实现（逐条有覆盖文件） | §F 的 30 行对照表 |
| `docs/mobile-ui/DEPTH-GAP.md`（7.5 KB） | 2026-11-08，202 条路由 | **板块深度审计**：页面级无缺口（桌面 17 页 vs 手机 24 屏），缺口都在页面内部；含两个方法反例 | 结论仍成立，但它的"缺口清单"已被本轮取代 | §E（需逐页核对）；方法反例 → `FEATURE-PARITY.md` §2 |
| `docs/mobile-ui/ROUTING-GAP.md`（6.7 KB） | 2026-11-08 | 路由板块差距：手机只做了约 2/12，逐端点列 ✅/❌；并找出根因（一句错误注释导致少做一片） | **已不适用**：路由组/工作空间/粘性/回放/追踪手机端都已做 | 路由相关 → §D 与 `FEATURE-PARITY.md` §8 |
| `docs/MOBILE-UI-GAP-ANALYSIS.md`（35.2 KB） | 2026-11-06~07，基准 `3.4.182` | 四轮审计：页面映射、P0/P1/P2 缺口、硬限制、证据附录 | **过期**：基准版本与手机端形态都变了（21→48 个页面） | 硬限制（桌面独有）→ §C；其余由 §A/§D 取代 |
| `docs/MOBILE-UI-DEVELOPMENT-PLAN.md`（24.6 KB） | 2026-11-07 | 手机 UI 结构分析（壳/路由表/数据层/原生壳）+ Phase 0–4 方案（终局是"移除桌面面板"） | **已完成**：Phase 0–3.x 各项都已实现 | 历史进程 → `DEVELOPMENT-MEMO.md` §2；后续计划 → `PLAN-MISSING-ITEMS.md` |
| `docs/mobile-ui/DEVELOPMENT-PLAN.md`（25.5 KB） | 2026-11-08 | 设置补全方案：**契约通则**（信封 / 省略语义 / 写入粒度）、批 1–6 计划、实现约定 | **批 1–6 均已完成**；契约通则仍现行 | 通则 → `DEVELOPMENT-MEMO.md`（原有"网关契约通则"节）；摘要 → `PLAN-MISSING-ITEMS.md` §0.5 |
| `docs/HANDOVER.md`（11 KB） | 2026-11-06，`18464f4` | 交接：现状 / 仓库与上游 / 发布流程 / 版本规则 / 越狱与运行时布局 / 五个补丁 / 踩坑 9 条 / 排障 | **运营知识仍现行**（补丁清单需 +0006） | **整节并入** `DEVELOPMENT-MEMO.md` **附录 A** |

### I.2 保留（不是"缺口分析"，而是现行机制或实现依据）

| 文件 | 为什么保留 |
|---|---|
| `docs/DEVELOPMENT-MEMO.md` | 活文档（工作流要求每步写记忆点）；已含附录 A（运营要点） |
| `docs/mobile-ui/DESIGN.md` | 手机端 UI 设计体系（五层结构 / 令牌 / 骨架类 / 组件 / 页面模式）——实现新页面的必读依据 |
| `docs/mobile-ui/contracts/` | 逐条 HTTP 契约（字段名来自源码），实施新功能时要用 |
| `docs/IOS-LAYOUTS.md` | 越狱三种布局的铁律（写死路径必翻车）——仍现行 |
| `docs/IOS-PLUGIN-SHIPPING.md` | 现行机制：插件预置进 deb（不依赖商店下载） |
| `docs/PLUGIN-STORE-OWN-REPO.md` | 现行机制：插件索引/下载改走我们自己的仓库 |
| `docs/IOS-NATIVE-PLUGIN-PLAN.md` | 方案依据：为什么必须是"LaunchDaemon + iOS 原生 Mach-O 插件"（结论已落地） |
| 本目录新的三份 | `FEATURE-PARITY.md` / `MISSING-LIST.md` / `PLAN-MISSING-ITEMS.md` |

> 若要连 I.2 里除记忆点之外的设计/机制文档也一并清掉，说一声即可——但它们是现行实现的**依据**，
> 删掉之后"为什么这么设计"就只能从代码里反推。
