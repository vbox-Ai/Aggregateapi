# 手机端「路由配置」板块差距分析

> 结论：**用户反馈成立。** 手机端只做了这块能力的约 **2/12**。路由配置在桌面端是
> 41 个文件、约 25 万字节的板块（含可视化画布与请求回放），手机端此前只有 3 个文件。

## 0. 为什么之前会漏掉（根因）

上一轮我在 `RoutingPage.tsx` 的注释里写下过一句判断：

> 「手机上不做路由组 / 工作空间：那两层是桌面 Tauri 壳的事务（`saveRoutingProfile`），
> 网关没有给它们 HTTP 入口。」

**这句话一半对、一半错，而错的那一半决定了少做一大片**：

- 对的一半：**保存路由组**确实没有 HTTP 路由（见下表，`/api/routing/groups` 只有 `GET`）。
- 错的一半：**工作空间、预演、路由档写入、粘滞查看/清理、请求回放、链路追踪、
  流量图**全都有 HTTP 接口。

错因也清楚：我把「桌面端有 41 个文件」当成「全是桌面本地事务」，**没有去查网关自己
的路由表**。判据其实一直是现成的 —— 已发布二进制里就有全部路由字符串。

## 1. 证据：网关路由表（`gw-src/http.rs`，逐条括号配对提取）

| 方法 | 路径 | 处理函数 | 手机端 |
|---|---|---|---|
| GET | `/api/routing` | `routing_api::get_routing` | ✅ 已有 |
| GET | `/api/routing/queue` | `routing_api::get_routing_queue` | ✅ 已有 |
| GET | `/api/routing/workspace` | `routing_workspace::get_workspace` | ❌ 缺 |
| GET | `/api/routing/groups` | `routing_groups::get_groups` | ❌ 缺（**写入无 HTTP 入口**） |
| POST | `/api/routing/preview` | `routing_groups::preview` | ❌ 缺 |
| PUT | `/api/routing/profile` | `routing_workspace::put_profile` | ❌ 缺 |
| GET | `/api/routing/sticky` | `routing_workspace::get_sticky` | ❌ 缺 |
| POST | `/api/routing/sticky/clear` | `routing_workspace::clear_sticky` | ❌ 缺 |
| GET | `/api/routing/replays` | `routing_workspace::get_replays` | ❌ 缺 |
| GET | `/api/routing/flow` | `routing_flow::get_flow` | ❌ 缺（可视化的数据源） |
| GET | `/api/routing/trace` | `routing_trace::get_trace` | ❌ 缺 |
| GET | `/api/routing/trace/request` | `routing_trace::get_trace_request` | ❌ 缺 |

交叉验证：已发布网关二进制 `agent2api-server`（3.4.255）里这 12 条路径字符串**全部存在**，
与源码路由表一一对应。

**没有 HTTP 入口的**（只能由桌面壳做，手机端不做）：
- 保存 / 删除路由组（`saveRoutingGroup`）—— 需要网关补一条写路由才能做；
- 画布布局的持久化（`routing-canvas-layout.tsx`）—— 本来就是桌面交互范式。

## 2. 响应形状从哪来

桌面壳的 `bridge()`（`ui-islands/src/islands/routing-types.ts`）与这些 HTTP 接口是同一份
数据的两种入口，所以**类型定义可以直接当契约用**：

| 类型 | 对应接口 | 关键字段 |
|---|---|---|
| `RoutingWorkspace` | `/api/routing/workspace` | `profile` / `providers` / `accounts` / `sorting` / `queue` / `settings` / `accountStates` / `metrics` / `stickyCount` / `revision` |
| `RouteGroups` | `/api/routing/groups` | `groups[{group, revision}]` / `newRevision` / `catalog[]` |
| `RouteGroup` | 同上 | `name` / `model` / `description` / `strategy` / `sticky` / `members[]` |
| `RouteMember` | 同上 | `provider` / `model` / `included` / `accounts[]` |
| `RouteProfile` | `/api/routing/profile` | `providerScope` / `providers` / `disabledProviders` / `accountOrder` / `excludedAccounts` / `strategy` / `sticky` |
| `RoutePreviewInput` / `RoutePreview` | `/api/routing/preview` | 入参 `model` / `group` / `profile` / `needs{tools,images,video}` / `failFirst` |
| `ReplayRow` | `/api/routing/replays`、`/trace`、`/trace/request` | `status` / `accountName` / `providerLabel` / `attempts[RouteAttempt]` / `clientLabel` / `clientEvidence` |
| `RouteAttempt` | 同上 | `account` / `model` / `reasoning` / `reason` / `status` / `error` / `notice` / `bodyBytes` / `retries[]` / 三个时间戳 |
| `StickyEntry` | `/api/routing/sticky` | 会话粘滞表（`getRoutingSticky(model?)` → `{entries, now, sticky}`） |

⚠️ 查询参数（`offset` / `limit` / `status` / `startDate` / `endDate` / `model` / `id` / `ts`）
来自桌面壳的调用签名，属于**强推断**而非逐字核对的路由定义。实现前应先跑一次真实请求
核对（手机端连的是用户自己的网关，可以现测）。

## 3. 建议的批次（按手机端价值排序）

手机端不做画布拖拽编辑器 —— 同样的数据用**列表 / 分组折叠**表达，交互范式换成手机上
可用的（与「宫格排序」同一取舍：不搬桌面手势）。

| 批次 | 内容 | 接口 | 风险 |
|---|---|---|---|
| **R1** | 工作空间：账号参与度、排队顺序、限额状态、指标、粘滞计数 | `GET /workspace` | 只读 |
| **R2** | 请求回放 + 链路追踪：历史请求列表 → 单次请求的每次尝试（候选/账号/状态码/重试/耗时/错误） | `GET /replays`、`/trace`、`/trace/request` | 只读。**手机端价值最高**：人在外面出问题，最需要看「网关到底试了谁、为什么失败」 |
| **R3** | 会话粘滞：查看 + 单条/按模型/全部清理 | `GET /sticky`、`POST /sticky/clear` | 有写操作（清理），需二次确认 |
| **R4** | 路由组：**只读**展示组 / 成员 / 账号集 / 策略；预演任意模型的选路结果 | `GET /groups`、`POST /preview` | 只读（写入需网关补路由） |
| **R5** | 路由档：参与范围、账号顺序、排除项、策略/粘滞覆盖 | `PUT /profile` | **写全局配置**，要 dirty 守卫 + 明确回滚 |
| — | 不做 | `flow`（可视化数据源，无手机端呈现形态）、画布布局、路由组写入 | — |

每批照旧：实现 → `tsc` + `build` + `scripts/check-mobile-ui.py` → 写记忆点 → 推送 → 下一批。

## 4. 顺带纠正

`RoutingPage.tsx` 里那句「网关没有给它们 HTTP 入口」已改成准确表述，并指向本文件。
留着的坏处很实在：下一个人（或下一轮的我）读到它就会继续不做这一片。
