# 板块深度审计：哪些是「页面在、功能缺」

> 起因：用户问「别的板块还有没有遗漏」。方法是**先列清单再比**，不靠印象。
> 结论：**页面级没有缺口**（桌面 17 个页面手机端都有对应，还多出 7 个），
> 缺口全在**页面内部**。下面是逐项核实过的结果。

## 1. 方法与两个「反例」

1. 枚举桌面端 `ui-islands/src/islands/*-page.tsx`（17 个）与手机端 `lib/routes.ts` 的
   `SCREEN_IDS`（24 个）→ 页面级一一对应，**没有缺页面**；
2. 把网关**全部 202 条路由**（`gw-src/http.rs`，括号配对提取）与手机端**实际调用的
   151 个端点**做差集 → 88 条「网关有、手机从不调用」；
3. 对这 88 条**逐条按功能关键词回查手机端源码**，剔除误报。

**⚠️ 第 3 步不能省 —— 前两步会给出误报。我这次就抓到两个：**

| 差点误报成缺口 | 实际情况 |
|---|---|
| 「工具服务缺提供商 Key 管理」 | `ToolsPage.tsx` **确实**调了 `/api/tools/providers/{p}/key` 与 `/test` |
| 「插件页缺安装」 | 手机端走的是 `/api/plugins/install-from-release`（另一条更完整的路径） |

教训同步骤 13：**关键词/差集只能产生候选，判定必须回查实现**。

## 2. 确认的缺口（★ = 该功能在手机端源码里一处都没有）

| # | 板块 | 缺什么 | 网关接口 | 证据 |
|---|---|---|---|---|
| 1 | **网络代理** | **代理订阅**（订阅地址、拉取、节点更新） | `/api/subscriptions`（含 `{*rest}`） | `/api/subscriptions` 零出现；云同步的同步范围文案里明写「代理池 / 订阅」——它是一等功能 |
| 2 | **模型管理** | **自定义模型的增删** | `POST /api/models/custom`、`/custom/remove` | 「自定义模型」「/api/models/custom」均零出现；手机端只有「自定义提供商」 |
| 3 | **请求日志** | **请求/响应原始报文查看** | `GET /api/stats/requests/raw` | 零出现。手机端只有「保存上游原始报文」这个**开关**（转发设置里），看不到内容 |
| 4 | **工具服务 / Agent** | **MCP / Skill 的安装** | `/api/tools/install-mcp`、`install-skill`、`install-targets`、`install-info` | `install-mcp` 零出现；`MCP` 只作为名词出现在标签/读数里 |
| 5 | **诊断** | **调试报文查看** | `GET /api/debug/traffic` | `debug/traffic` 零出现（转发设置里只有「调试模式」开关） |
| 6 | **运行日志** | **日志下载** | `GET /api/logs/download`（+ `/logs/stats`） | `logs/download` 零出现；手机端能看日志列表，导不出来 |
| 7 | **Agent 配置** | **应用 / 导入**（`/api/agents/apply`、`/import`、`/profiles`、`/{id}/resources*`） | 同上 | `agents/apply` 零出现；手机端只用了 `/api/agents`、`/preview`、`/restore` ——**要按真机核对后再下结论** |
| 8 | **模型映射** | **新增映射**（手机端能删不能加？） | `POST /api/models/mappings` | 手机端只调 `/api/models/mappings/remove`；新增那条零出现 —— 同样是「需先核实」项 |
| 9 | **添加账号** | 部分登录方式（短信 / OAuth 专用完成端点） | `/api/session/login/sms/{send,verify}`、`/oauth/{start,captcha-config}`、`/kuku/complete` 等 13 条 | 手机端只用了通用的 `/login/start|cancel|callback`；**哪些家需要专用端点要对着 provider 清单看** |

## 3. 明确不算缺口（记下来免得以后重复排查）

| 端点 | 为什么不缺 |
|---|---|
| `/api/upgrade`、`/api/upgrade/run` | 桌面端**自身**升级用的；iOS 上更新由 supervisor + deb 负责，手机端插进去没有意义 |
| `/api/backup/export|import|progress` | 手机端用的是新一代表备份接口 `/api/backup/download|upload|restore/progress` |
| `/api/checkin`、`/claim-and-report` | 签到中心已用 `/checkin-center`、`/checkin-records`、`/checkin-schedules`、`/auto-checkin`、`/travel-schedule` 等覆盖，那两条是备选路径 |
| `/api/tools/providers/{p}`（PUT）、`/key`、`/test` | 工具服务页已经在用 |
| `/api/plugins/install`、`/progress` | 手机端走 `install-from-release`，是更完整的一条 |
| `/api/assistant/sessions/{id}`、`/fork`、`/title` | `fork` 在 `api/assistant.ts` 与 `AssistantPage.tsx` 里都有实现 |
| `/api/activity/ambassador`、`/banner` | 推广位，手机端不做 |
| `{*rest}` 通配路由 | 提取产物，不是具体功能 |

## 4. 建议的处理顺序（按「手机端价值 / 风险」）

1. **代理订阅（#1）** —— 手机端价值高（订阅常在手机上加），只读+拉取为主，风险低；
2. **请求原始报文（#3）与调试报文（#5）** —— 排查问题最需要，且都是只读；
3. **自定义模型增删（#2）** —— 中等风险（写模型配置），但功能明确；
4. **日志下载（#6）** —— 低风险，纯导出；
5. **MCP/Skill 安装（#4）、Agent 应用（#7）** —— 需要先核对着实现再动；
6. **映射新增（#8）、短信/OAuth 登录（#9）** —— 先核实是否真缺。

## 5. 仍然挂着、需要改 Rust 的两项

- **局域网访问**：supervisor 硬编码 `AGENT2API_HOST=127.0.0.1`；
- **路由组写入**：网关只有 `GET /api/routing/groups`，没有写路由。

这两项都不是手机端能自己解决的，等你拍板。
