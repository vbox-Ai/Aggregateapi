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
| A. 真缺口 | **10** | 要补（本清单 §A） |
| B. 真 bug | **1** | 先修（本清单 §B） |
| C. 平台不适用 | 20 | **不要派活**（§C 给了理由） |
| D. 已用等价端点实现 | 11 | 不用动（§D） |
| E. 需逐页核对（未定论） | 若干 | 先核对再决定（§E） |

---

## A. 真缺口（10 条）

每条格式：**端点/参数 → 桌面入口 → 手机现状 → 证据 → 影响 → 量级**。

### A1 短信验证码登录
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

### A2 从文件安装插件包
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

### A4 请求记录维护三件套
- 端点：`GET /api/stats/requests/filters`、`GET /api/stats/requests/clear-preview`、`POST /api/stats/requests/compact`
- 桌面入口：请求页「清理」弹窗（`request-clear-modal.tsx`）
- 手机现状：有 `GET /api/stats/requests`、`/raw`、`POST /api/stats/requests/terminate`，**没有清理与压实**
- 证据：`api/gateway.ts`、`api/request-raw.ts` 的端点清单；全树无 `clear-preview`/`compact`
- 影响：手机上无法清理历史请求、无法压实库（长期使用后库会涨）
- 量级：**M**（要先定"清理范围"的交互，且这是**不可恢复**操作，必须二次确认 + 预览）

### A5 精简路由（compact routes）
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

### A7 原始配置读写（`/api/config`）
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

### A9 模型映射「新增」
- 端点：`POST /api/models/mappings`（body 含 `create`、`enabled`、`reasoning` 等键）
- 桌面入口：模型页（`models-dialogs.tsx`、`models-cells.tsx`）
- 手机现状：有 `mappings/remove`，另有 `mappings${action}` 形式（`lib/assistantTools.ts`）
- 证据：`api/gateway.ts`、`lib/assistantTools.ts`
- **待核实**：`mappings${action}` 是否已含"新增"。若含 → 本条撤销；若只含删除/改状态 → 补新增
- 量级：**S**（若需补）

### A10 zcode 领取校验
- 端点：`POST /api/zcode/claim-verification`
- 桌面入口：账号页 zcode 领取（`accounts-zcode-plan.tsx`、`zcode-plans-modal.tsx`）
- 手机现状：有 `/api/zcode/captcha`、`/api/zcode/captcha-pool`、`/api/zcode/version`；**没有领取校验**
- 证据：`api/zcode.ts`、`api/plugin-settings.ts`
- 影响：zcode 领取流程里少一步校验（该流程是否在手机上完整，需一并核对）
- 量级：**S**（但要看它和 A1 的短信/验证码链路是否耦合）

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
| 数据面 | `/v1/chat/completions`、`/v1/*` | 给 AI 客户端用的转发接口，面板不消费 |
| 对外工具接口 | `/mcp/vision`、`/mcp/web-search`、`/skill/web-search/*`、`POST /api/web-search/{search,fetch}` | 给 MCP 客户端/外部工具用；桌面提供的是**文档与调试页**，不是面板功能 |
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

## E. 需逐页核对（**未定论**，不是已确认缺失）

这些是"同一功能两侧都有，但手机端可能只用了部分字段/子项"。核对方法：逐字段比对桌面表单与手机表单。

| 项 | 要核对什么 |
|---|---|
| 账号限流器 | 桌面的 `accounts-limiter-*`（条件/模型/状态）在手机上有几项 |
| 补签（makeup） | 桌面 `checkin-makeup-editor/tab` 的能力在手机 `pages/checkin/*` 里覆盖多少 |
| 签到计划 extras | 桌面 `checkin-schedule-extras.tsx` 的附加项 |
| 报表 | 桌面 `report-*`（图表/区间）在手机 `ReportPage.tsx` 里覆盖多少 |
| 积分简报 | 桌面 `/api/usage` + `/api/checkin/status`；手机源码里都没有（但有概念不同的 `/api/accounts/usage`） |
| 模型映射新增 | §A9 |
| 精简路由载荷 | §A5 的 PUT 结构 |
| 设置项字段级 | 桌面 `settings-model.ts` 的 `CATEGORIES` 逐项 vs 手机设置页（旧文档做过一次，但已过期，需重做） |
| 账号批量操作 | 桌面 `accounts-batch-dialog.tsx` vs 手机批量入口 |
| 工具服务文档 | 桌面 `/api/web-search/*` 的**文档页**要不要在手机上给（属 C 类还是 D 类需定） |

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

本清单的"有/没有"是**按端点引用**判定的，属于**必要证据但不是充分证据**：
端点被引用 ≠ 每个字段都做了。§E 列的就是"还没核到字段级"的部分。
做实现计划时，A 类每条都要走一遍"契约先核对"，不要照抄本清单的字段列表。
