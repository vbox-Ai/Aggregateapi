# 手机端 / 电脑端 功能对照与缺口清单

> 这份文档是**读源码比出来的**，不是凭印象列的。
> 版本基准：上游 `aimod-cc/Agent2API` **v3.4.2**（CI 实际检出的 tag）与
> 本仓库 `vbox-Ai/Aggregateapi` **main**。方法与复现命令见 §1，方法的局限见 §2。
>
> 结论一句话：**主干已经对齐**（136 个端点两侧都在用，41 个模块端点级无缺口），
> 剩下的是 **10 条真缺口** + **1 个真 bug**；另有 20 条属于「桌面上才有意义的」，不该当任务做。

---

## 0. 结论速览

| 指标 | 数值 |
|---|---|
| 网关 HTTP 端点总数 | **223**（分布在 69 个模块） |
| 两侧都在用 | **136** |
| 只桌面端在用（候选缺口） | **41** |
| 只手机端在用 | **2**（其中 1 个是 bug） |
| 两侧都没在代码里引用 | **44**（数据面 / 对外接口 / 回调 / 遗留兼容路由） |

对 41 条候选逐条归因后：

| 类别 | 条数 | 说明 |
|---|---|---|
| **真缺口**（手机上没有且手机上有意义） | **10** | 见 §4 |
| **平台不适用**（桌面上才成立） | **20** | 见 §3 |
| **已用等价端点实现** | **11** | 见 §5 |

---

## 1. 方法与依据（可复现）

| 步骤 | 具体做法 |
|---|---|
| 端点全表 | 上游 v3.4.2 的 `desktop-tauri/src-tauri/server/src/server/http.rs`，用**括号配平**解析 `.route("路径", …)` → 223 条（含方法） |
| 桌面端调用集 | `desktop-tauri/ui`、`ui-islands/src`、`ui-shared`、`src-tauri/src` 里的 `/api/…` 字面量 **∪** `src-tauri/server/src/web_shim.rs` 的**桥函数**（UI 里出现的 `wb*.xxx(` 映射到 URL） |
| 手机端调用集 | `desktop-tauri/mobile/src/**` 里的 `/api/…` 字面量（55 个文件引用了端点） |
| 参数 | 每个 handler 的 `Query<>` / `Json<>` / `Path<>` 提取器，**外加**函数体里手写的 `query.get("…")` 键 |
| 归因 | 按功能关键词在手机端源码里逐个检索（sms / compact-routes / filters / clear-preview …），命中的列文件，未命中的列为缺口 |

复现：把上游 v3.4.2 与本仓库 main 的源码包解开，按上面四条规则跑一遍即可（本机脚本：
`parity.py`、`attribute.py`、`params.py`，均已在本地跑通）。

---

## 2. 口径与已知误差（先看这段再看数字）

1. **模板字面量拼接会被误判。** `'/api/routing/workspace${scope}'` 若归一化成
   `…workspace*`，与网关的路由骨架 `/api/routing/workspace` 就对不上，会把手机端
   **其实在用**的端点报成缺口。**这个错我犯过**（第一版比对里 `/api/routing/workspace`
   就是这么被误报的），已修正为"丢掉插值段"。同类写法可能仍有个别漏网。
2. **桌面端大多不走裸 URL。** 桌面 UI 通过 Tauri 桥函数（`getPanelAccount()` 之类）调后端，
   URL 写在 `web_shim.rs` 里。**只 grep URL 会把一大批功能误判成"没人用"**（第二版比对的错）。
3. **端点存在 ≠ 功能等价。** 手机端可能调了同一个端点但只用了**部分字段/子项**。
   参数级、子项级的覆盖要逐页核对——§6 表里对没核过的格子标了"**需逐页核对**"。
4. 因此：**数字只用来定位，结论以 §4/§5 的逐条归因为准**（每条都给了依据文件/关键词）。

---

## 3. 平台性差异（**不是缺口**，别当任务做）

| 桌面能力 | 为什么手机不做 |
|---|---|
| `/api/agents/{apply,import,profiles}`、`/api/agents/{id}/resources/{preview,apply}` | 这些是把配置**写进本机安装的 CLI 客户端**（Claude Code / Codex / Cursor CLI / Zed…），并给它们装 skill/MCP。iOS 上没有这些客户端，做了也没有落点。手机端保留的是 `agents` 列表 + `preview` + `restore`（用于查看与还原）。 |
| `/api/import/cc-switch` | 扫描**本机** cc-switch 工具的 SQLite。而且**桌面端自己也把入口隐藏了**（`add-provider-pick.tsx` 里注释写明该分段为 `false`）。 |
| `/api/upgrade`、`/api/upgrade/run` | 网关自升级（Linux systemd / Windows 服务形态）。iOS 上的升级路径是装新 deb。 |
| `/v1/chat/completions`、`/v1/*`、`/mcp/*`、`/skill/*`、`/api/web-search/*` | **数据面与对外工具接口**：给 AI 客户端、MCP 客户端、外部工具用的。手机面板不消费它们。（桌面端引用了其中一部分，是因为桌面**也要给这些外部工具做调试/文档页**。） |
| `/api/session/logout`、`/api/session/refresh` | 网关侧会话（给外部客户端登出/续期）。面板自己的会话走 `/api/panel/*`，手机已有。 |
| `/api/subscriptions*` | 已下线：返回 410 `retired_proxy_feature`。 |
| 托盘、窗口、网格布局、表格列设置（`tray.rs`、`sidebar-pane.tsx`、`table-col-settings.tsx`） | 桌面外壳能力，手机没有对应外壳。 |
| `/api/backup/export`、`/api/backup/import`（参数 `filePath`） | 按**服务器上的文件路径**导出/导入。手机上的等价物是**下载/上传**整包，手机端已经做了。 |

---

## 4. 真缺口清单（手机端没有、且手机上有意义）

按建议补齐顺序排列。每条给：端点（含参数）、桌面入口、手机现状、补齐要点。

### 4.1 短信验证码登录（添加账号时）
- 端点与参数：
  - `POST /api/session/login/sms/send` — query `provider`、`phone`
  - `POST /api/session/login/sms/verify` — query `provider`、`phone`、`code`、`name`、`id`、`deviceId`、`accounts`
  - `POST /api/session/login/tabbit/sms/send` / `…/tabbit/sms/verify`
  - `POST /api/session/login/loomy/sms/send`（`phone`）/ `…/loomy/sms/verify`（`phone`、`code`、`msgid`、`id`、`name`、`accounts`）
  - `POST /api/session/login/kuku/complete`
  - `GET|POST /api/session/login/oauth/captcha-config`
- 桌面入口：添加账号弹窗（`add-account-modal.tsx`、`add-account-kit.tsx`、`add-provider-tabbit.ts`）
- 手机现状：**已有** OAuth 流程（`api/add-account-dynamic.ts` 用 `login/start` + `login/wait` + `login/callback`）与"导入授权文件"，
  **唯独没有短信登录**——手机端源码里搜不到任何 sms 相关字符串。
- 补齐要点：登录方式列表来自 `GET /api/session/login/methods`（手机已用），按 `methodIndex` 走 `login/start`；
  短信方式需新增"发码 → 填码"两步界面，并把 `deviceId`/`name` 一起带上。

### 4.2 从文件安装插件包
- 端点：`POST /api/plugins/install`，body `{packB64}`（base64 的插件包）
- 桌面入口：插件页（`plugins-page.tsx`）选本地包安装
- 手机现状：有 `/api/plugins`、`install-from-release`、`update`、`uninstall`、`enable`、`settings`、`provider`、`release`，**没有本地文件安装**
- 补齐要点：iOS 侧需要"选文件 → 读 base64"，走 App 的文件选择器（面板是 WebView，`<input type=file>` 可用）；
  另外注意 `deny_unknown_fields` 之类的严格解析。
- ⚠️ 检索陷阱：用关键词 `plugins/install` 去搜会**假命中**（`plugins/install-from-release` 含该子串）。

### 4.3 日志统计
- 端点：`GET /api/logs/stats`（无参）
- 桌面入口：日志页统计卡（`logs-panel.tsx`、`logs-model.ts`）
- 手机现状：有 `GET /api/logs`（查询）与 `/api/logs/download`（下载），**没有统计**

### 4.4 请求记录维护三件套
- 端点：`GET /api/stats/requests/filters`、`GET /api/stats/requests/clear-preview`、`POST /api/stats/requests/compact`
- 桌面入口：请求页的「清理」弹窗（`request-clear-modal.tsx`）
- 手机现状：有 `GET /api/stats/requests`、`/raw`、`POST …/terminate`，**没有清理与压实**
  （此前一轮审计里也把这三条列为"未排期"，这次确认仍然缺）

### 4.5 精简路由（compact routes）
- 端点：`GET|PUT /api/models/compact-routes`
- 桌面入口：模型页「精简」（`models-compact-dialog.tsx`、`models-compact-state.ts`）
- 手机现状：模型相关有 `/api/models/{manage,custom,state,mappings/remove,refresh,metadata,test,capabilities}`，**没有 compact-routes**

### 4.6 面板账户信息
- 端点：`GET /api/panel/account`（用户名、"是否已注册"等）
- 桌面入口：设置 → 账户（`settings-model.ts` 里定义 `PanelAccount`）
- 手机现状：有 `POST /api/panel/change-password`，**没有读取账户信息**；
  手机登录页只用 `GET /api/panel/status` 判断是否已注册
- 补齐要点：很轻（一个只读接口），适合和"改密码"放同一张卡里

### 4.7 原始配置读写
- 端点：`GET|POST|PUT /api/config`
- 桌面入口：设置页的若干高级项（`settings-model.ts`、`settings-state.ts`）
- 手机现状：手机端把设置**拆成细粒度端点**覆盖了大部分开关——
  `/api/retry`、`/api/timeouts`、`/api/debug`、`/api/queue`、`/api/cors`、`/api/captcha`、
  `/api/sanitize`、`/api/storage`、`/api/retention`、`/api/image-compress`、`/api/developer-role-compat` 等，
  **但没有整份配置的读写**
- 补齐要点：**先逐项核对**哪些设置项只存在于 `/api/config`、而没有对应的细粒度端点；
  有则补对应细粒度端点（比直接暴露整份原始配置更安全），不要把 `/api/config` 原样搬到手机上

### 4.8 自动签到「立即运行」
- 端点：`POST /api/auto-checkin/run`（无参）
- 桌面入口：签到页（`checkin-center-tab.tsx` 一带）
- 手机现状：有 `/api/auto-checkin`（读配置）、`/api/checkin-schedules`、`/api/checkin-activity`、
  `/api/checkin-keepalive`、`/api/checkin-records`、`/api/travel-schedule`，**没有"立刻跑一次"**

### 4.9 模型映射新增
- 端点：`POST /api/models/mappings`（query 含 `create`、`enabled`、`reasoning`）
- 桌面入口：模型页（`models-dialogs.tsx`、`models-cells.tsx`）
- 手机现状：有 `mappings/remove`，另有 `mappings${action}` 形式（`lib/assistantTools.ts`）；
  **"新增映射"的界面是否完整需逐页核对**

### 4.10 zcode 领取校验
- 端点：`POST /api/zcode/claim-verification`
- 桌面入口：账号页 zcode 领取（`accounts-zcode-plan.tsx`、`zcode-plans-modal.tsx`）
- 手机现状：有 `/api/zcode/captcha`、`/api/zcode/captcha-pool`、`/api/zcode/version`，**没有领取校验**

---

## 5. 已用等价实现（不是缺口，但形式不同）

| 桌面端点 | 手机端的等价做法 | 依据 |
|---|---|---|
| `/api/proxies`（`ANY` 子路径分发器） | 直接用子路径：`/api/proxies/pool*`、`/api/proxies/settings`、`/api/proxies/test` | `api/gateway.ts` |
| `/api/checkin`、`/api/checkin/status`、`/api/usage` | 用新版：`/api/checkin-center`、`/api/checkin-activity`、`/api/checkin-keepalive`、`/api/checkin-records`、`/api/checkin-schedules`、`/api/travel-schedule` | `api/checkin.ts` |
| `/api/routing/workspace` | **手机在用**（`pages/routing-profile.tsx`、`pages/routing-workspace.tsx`，写作 `…workspace${scope}`） | 见 §2.1，这是我比对方法的假阳性 |
| `/api/checkin-records` | 在用（`api/checkin.ts`） | 同上 |
| `/api/backup/download`、`/api/backup/upload` | 在用（下载/上传整包） | `api/backup.ts` |

> 其中 **`/api/usage`（积分/用量简报）**：手机端源码里搜不到，也没有 `checkin/status`；
> 手机端有 `/api/accounts/usage`（账号额度，概念不同）。
> **"手机是否有积分简报入口"需逐页核对**——这条我没有下结论。

---

## 6. 逐模块对照总表

"端点覆盖"是手机端引用到的端点数 / 该模块端点数（§2 的口径）。
"桌面入口"列的是桌面端提供该功能的 islands 文件前缀。

| 模块 | 手机端覆盖 | 桌面入口（islands） | 手机端页面/接口 | 结论 |
|---|---|---|---|---|
| accounts | 11/12 | `accounts-*`（40+ 文件：页面/面板/限流器/用量窗口/导出/批量） | `AccountsPage.tsx`、`AccountSheet.tsx`、`AccountImportSheet`、`add-account-dynamic-sheet.tsx`、`api/gateway.ts` | 主干对齐；限流器/用量窗口等子项**需逐页核对** |
| models | 6/7（`model_manage`） | `models-*`（页面/批量/精简/能力/推理/抓取） | `ModelsPage.tsx`、`models-add-custom-sheet.tsx`、`model-metadata-sheet.tsx` | 缺 **compact-routes**（§4.5）、映射新增待核（§4.9） |
| routing | 3/4（`routing_workspace`） | `routing-*`（40+ 文件：画布/组/粘性/回放/追踪/排序） | `RoutingPage.tsx`、`routing-groups.tsx`、`routing-profile.tsx`、`routing-replay.tsx`、`routing-sticky-sheet.tsx`、`routing-trace-sheet.tsx`、`routing-workspace.tsx`、`routing-group-edit-sheet.tsx` | 对齐（组编辑已支持，见另一份 `ROUTING-GAP.md`） |
| proxies | ✅（`accounts` 11/12） | `proxies-*`（页面/列/弹窗/池） | `ProxiesPage.tsx`、`proxy-editor-sheet.tsx`、`update-proxy-sheet.tsx` | 对齐 |
| keys | ✅ 2/2 | `keys-page.tsx` | `KeysPage.tsx` | 对齐 |
| logs | 4/7 | `logs-*`（列表/模型/面板） | `LogsPage.tsx`、`api/gateway.ts` | 缺 **stats**（§4.3） |
| stats/requests | 6/11 | `requests-page.tsx`、`request-*`、`report-*` | `RequestsPage.tsx`、`ReportPage.tsx`、`components/RequestRawPanel.tsx`、`api/debug-traffic.ts` | 缺 **维护三件套**（§4.4）；报表**需逐页核对** |
| checkin | 2/8（旧端点） | `checkin-*`（补签/记录/计划/引导/UMID） | `CheckinPage.tsx`、`pages/checkin/*`、`api/checkin.ts` | 用新版端点实现；缺 **手动运行**（§4.8）；**补签/计划子项需逐页核对** |
| assistant | ✅ 4/4 | `assistant-*`（composer/消息/图片/会话/回放/设置抽屉） | `AssistantPage.tsx`、`pages/assistant/*`、`api/assistant*.ts` | 对齐 |
| agent | 3/6 | `agent-*`（编辑/预览/档案/快捷连接/路径） | `AgentPage.tsx` | 剩 3 条属**平台不适用**（§3） |
| tools | 13/14 | `tools-*`（页面/详情/安装/配置） | `ToolsPage.tsx`、`api/tools-install.ts` | 对齐；`/api/web-search/*` 属对外接口（§3） |
| plugins | 8/10 | `plugins-*`（卡片/说明/包设置/设置） | `PluginsPage.tsx`、`plugin-settings-sheet.tsx`、`api/plugins.ts` | 缺 **本地包安装**（§4.2） |
| panel | 7/9 | `settings-page.tsx`（账户/改密） | `SettingsPage.tsx`、`change-password-sheet.tsx`、`api/auth.ts` | 缺 **账户信息**（§4.6） |
| backup | 2/5 | `settings-database-backup.tsx`、`settings-db-restore.tsx` | `backup-restore-sheet.tsx`、`api/backup.ts` | 缺 export/import（平台形式，§3）；**另有进度路径 bug**（§7.1） |
| cloud-sync | ✅ 6/6 | `settings-cloud-sync.tsx`、`settings-cloud-sync-model.ts` | `cloud-sync-sheet.tsx`、`api/cloud-sync.ts` | 对齐 |
| settings（sanitize/retention/client-id/prompt/security/storage） | ✅ 全部 | `settings-*` | `SanitizePage.tsx`、`data-storage-sheet.tsx`、`connection-security-sheet.tsx`、`PromptPage.tsx`、`api/{sanitize,storage,security,prompt,client-identification}.ts` | 对齐；`/api/config` 见 §4.7 |
| update（App 自身更新） | ✅（`/api/update/*`） | `update-*` | `lib/appUpdate.ts`、`components/AppUpdatePanel.tsx`、`GithubAccessSettings.tsx`、`GithubTokenSettings.tsx`、`RequiredUpdateGate.tsx` | 对齐；`/api/upgrade` 属平台不适用（§3） |
| tasks/scheduled | ✅ 3/3 | `tasks-panel.tsx` | `TasksPage.tsx`、`api/updates.ts` | 对齐 |
| system info | ✅ 1/1 | `system-info-pane.tsx` | `components/SystemInfoSheet.tsx`、`api/update-proxy.ts` | 对齐 |
| docs | — | `docs-page.tsx`、`ui-shared/docs-api-*` | `DocsPage.tsx`、`DocsProviderData.ts` | 对齐（手机端文档数据）。**7 个文档字段**（agents/资源/模型映射）此前审计列为"需先核实" |
| debug/traffic | ✅ 2/2 | — | `components/DebugTrafficPanel.tsx`、`api/debug-traffic.ts` | 对齐 |
| MorePage / HomePage / LoginPage | — | 桌面无对应单页 | `MorePage.tsx`、`HomePage.tsx`、`LoginPage.tsx` | 手机自有结构 |

---

## 7. 本次分析新发现的问题

### 7.1 【真 bug】备份恢复进度轮询路径不存在
- 现象：手机端 `api/backup.ts` 与 `pages/backup-restore-sheet.tsx` 请求
  **`/api/backup/restore/progress`**，而网关只有 **`/api/backup/progress`**
  （处理器 `api::backup_api::restore_progress`）。
- 后果：恢复进度**永远拿不到**（404），恢复过程只能靠"最后结果"猜。
- 依据：上游 `http.rs` 的 `.route("/api/backup/progress", …)`；手机端两处字符串。
- 修法：把手机端两处路径改成 `/api/backup/progress`（一行级改动）。

### 7.2 【口径陷阱】`plugins/install` 子串假命中
`/api/plugins/install-from-release` **包含**子串 `plugins/install`，
用关键词检索会误判"手机端有本地包安装"。核对端点时要**精确匹配路径**。

### 7.3 【待核实】手机端是否有"积分简报"入口
桌面端有 `/api/usage`（积分简报）与 `/api/checkin/status`（活动状态）；
手机端源码里两者都没有，但有 `/api/accounts/usage`（账号额度，概念不同）。
**没有下结论**，留给逐页核对。

---

## 8. 修正记录（推翻此前文档里的说法）

| 此前说法 | 实际情况 | 依据 |
|---|---|---|
| 「网关只有 `GET /api/routing/groups`，要补写路由」 | **错**：上游 v3.4.2 已有 `PUT /api/routing/groups`（含成员校验、revision 乐观锁 409）。当时我误把**已安装的旧二进制**当作基准（旧版确无该路由的字符串） | 上游 `http.rs` 路由表 + `api/routing_groups.rs` |
| 「deb 里没有 App，必须另装 IPA」 | **错**：deb 是**一体包**（`Section: Applications`，描述写明 `app + launchd daemon`），包内含 `var/jb/Applications/Agent2API.app` 与 LaunchDaemon plist。只装 deb 就够 | deb 的 `control` 与 `data.tar` 清单 |
| 「手机端没用 `/api/routing/workspace`」 | **错**：手机在用，是我的归一化把 `${scope}` 变成了 `*` 导致误判 | `pages/routing-workspace.tsx` |
| 「字面量在二进制里搜不到 ⇒ 代码缺失」 | **不成立**：`/status` 这种必然存在的短字面量在 App 二进制里也搜不到（短字符串会以指令立即数形式编码）。**按字节搜不能证明代码不在** | App 二进制逐字节检索 |

---

## 9. 建议的补齐顺序

| 顺序 | 事项 | 理由 | 量级 |
|---|---|---|---|
| 1 | 修 §7.1 的进度路径 bug | 一行级，且是**当前就在出错**的功能 | 极小 |
| 2 | §4.6 面板账户信息 | 一个只读接口，放进已有的"改密码"卡里 | 小 |
| 3 | §4.1 短信登录 | 加账号是核心路径，缺一种登录方式影响面最大 | 中 |
| 4 | §4.3 日志统计 | 同一页补一块 | 小 |
| 5 | §4.4 请求维护三件套 | 手机存量大时有用（清理/压实） | 中 |
| 6 | §4.2 插件本地包安装 | 需要文件选择，iOS 侧要试通 | 中 |
| 7 | §4.5 精简路由、§4.9 映射新增 | 模型高级设置 | 小～中 |
| 8 | §4.7 配置项核对 | **先核对再决定**，不要直接暴露整份 `/api/config` | 需先调研 |
| 9 | §4.8 / §4.10 | 小功能 | 小 |
| 10 | §6 里标"需逐页核对"的格子 | 字段级比对，工作量大、风险低 | 持续 |
