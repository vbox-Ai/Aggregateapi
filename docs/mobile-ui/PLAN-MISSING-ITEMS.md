# 手机端缺失功能 · 详细开发计划

> 配套文档：[`MISSING-LIST.md`](./MISSING-LIST.md)（缺什么，逐条带端点与参数）、
> [`FEATURE-PARITY.md`](./FEATURE-PARITY.md)（怎么比出来的、口径与误差）。
>
> 本计划只做 **A 类 10 条功能 + B 类 1 个 bug**；C 类（平台不适用）**明确不做**；
> E 类（未定论）先核对再决定。

---

## 0. 工作流约定（沿用既有规矩，每项都走一遍）

```
① 契约先核对（读上游源码/补丁机制，不猜）
② 实现
③ 验证：手机端 tsc --noEmit + vite build + scripts/check-mobile-ui.py
        （Rust 侧如涉及：不能本地构建就如实说明，靠 CI 第 9/16 步）
④ 在 docs/DEVELOPMENT-MEMO.md 写记忆点
⑤ 推送仓库
```

**本计划的补充约定**：

- **合并推送**：`build.yml` 有 `push: branches: [main]` 且无 `concurrency`，每次 push 都会排一整套
  全平台 CI。所以**一个里程碑推一次**（不是一项推一次），记忆点可以一次写多条。
- **不碰 Rust**：A 类全部是「调既有端点」，**预计不需要改 Rust、不需要新补丁**。
  若某项核对后发现确实要动网关，先停下来单独评估（那是另一个量级）。
- **不可恢复操作要三件套**：预览 + 二次确认 + 明确文案（清理请求、压实库、整库恢复都属此类）。

---

## 1. 里程碑总览

| 里程碑 | 内容 | 条数 | 量级 | 依赖 |
|---|---|---|---|---|
| **M0** | 修备份进度路径 bug | 1 | S | 无 |
| **M1** | 小项打包：面板账户信息 / 日志统计 / 签到立即运行 / zcode 领取校验 | 4 | S+S+S+S | 无 |
| **M2** | 中项：**短信登录** / 请求维护三件套 / 精简路由 / 插件本地包安装 / 模型映射新增（先核实） | 5 | M+M+S~M+M+S | M1 无依赖，但**逐项推**更稳 |
| **M3** | 调研：`/api/config` 到底有没有"只它才有"的设置项 | 1 | 调研 | 无 |
| **M4** | 字段级核对（E 类）：限流器 / 补签 / 报表 / 积分简报 / 设置项逐项 | 10 项核对 | 持续 | 可与 M2 并行 |

**建议顺序：M0 → M1 → M2（短信登录优先）→ M3 → M4。**
理由：M0 是"现在就在出错"；M1 全是 S 且互相独立、一次推送就能收；M2 里短信登录影响面最大（加账号是核心路径）。

---

## M0 · 修「备份恢复进度」路径错误

**目标**：整库恢复时能实时看到进度，不再 404。

| 项 | 内容 |
|---|---|
| 契约核对 | 上游 `api/backup_api.rs::restore_progress` 的**响应结构**（进度字段名/形状）；上游 `http.rs` 确认路由是 `/api/backup/progress`（不是 `restore/progress`） |
| 实现落点 | `desktop-tauri/mobile/src/api/backup.ts`、`desktop-tauri/mobile/src/pages/backup-restore-sheet.tsx`（两处路径字符串） |
| 是否动 Rust | 不动 |
| 验证 | 三项本地检查；真机：做一次恢复，确认进度在动 |
| 风险 | 若响应字段名与手机端既有解析不一致 → 同步改解析（所以第①步必须先读响应结构） |
| 验收 | 恢复过程中进度数值/阶段持续更新；无 404 |
| 量级 | **S（一行级 + 解析核对）** |

---

## M1 · 小项打包（4 项，一次推送）

### M1.1 面板账户信息
| 项 | 内容 |
|---|---|
| 契约核对 | 上游 `api/panel.rs::panel_account` 的返回字段（用户名、是否已注册…）；桌面 `ui-islands/src/islands/settings-model.ts` 里的 `PanelAccount` 类型定义（它标了字段含义） |
| 实现落点 | `mobile/src/api/auth.ts`（加只读函数）、`mobile/src/pages/SettingsPage.tsx`（与"修改密码"同一张卡里显示） |
| 验证 | 三项本地检查 |
| 风险 | 低。注意**只读**，不要顺手加"改用户名"（网关没有该端点） |
| 验收 | 设置页能看到当前面板用户名与注册状态 |

### M1.2 日志统计
| 项 | 内容 |
|---|---|
| 契约核对 | 上游 `api/logs_api.rs::stats_logs` 的返回结构；桌面 `ui-islands/src/islands/logs-panel.tsx` + `logs-model.ts` 展示了哪几项 |
| 实现落点 | `mobile/src/api/gateway.ts`（或新增 `api/logs.ts`）、`mobile/src/pages/LogsPage.tsx`（顶部统计卡） |
| 验证 | 三项本地检查 |
| 风险 | 低 |
| 验收 | 日志页显示统计（条数/占用等，按上游实际字段） |

### M1.3 自动签到「立即运行」
| 项 | 内容 |
|---|---|
| 契约核对 | 上游 `api/auto_checkin.rs::run_now` 的返回（是否有 partial/失败明细）；桌面哪个按钮触发它 |
| 实现落点 | `mobile/src/api/checkin.ts`、签到页（`pages/CheckinPage.tsx` 或 `pages/checkin/*`）加"立即运行"按钮 |
| 验证 | 三项本地检查；真机：点一次，看是否有结果反馈 |
| 风险 | 该动作会**真发请求给上游**（可能消耗账号额度/触发风控）→ 按钮要有明确文案 + busy 态 + 结果提示，不要放在容易误点处 |
| 验收 | 点击后有明确结果（成功/失败/部分成功） |

### M1.4 zcode 领取校验
| 项 | 内容 |
|---|---|
| 契约核对 | 上游 `api/zcode_claim_verification.rs::verification` 的 body 字段与返回；桌面 `accounts-zcode-plan.tsx` / `zcode-plans-modal.tsx` 的调用时机 |
| 实现落点 | `mobile/src/api/zcode.ts`（加函数）、zcode 领取流程所在页面 |
| 验证 | 三项本地检查 |
| 风险 | 需先确认**手机的 zcode 领取流程本身是否完整**——若流程缺失，该项并到那个流程里一起做 |
| 验收 | 领取流程里校验步骤可用、结果正确回显 |

---

## M2 · 中项（逐项推送）

### M2.1 短信验证码登录 ★本计划最大一项
| 项 | 内容 |
|---|---|
| 契约核对（必读） | ① `api/session.rs::login_methods` — 登录方式清单与字段（界面据此渲染输入框）<br>② `session.rs::login_start` — `methodIndex` + `inputs` 的统一入口<br>③ `session.rs::{login_sms_send, login_sms_verify}` — 通用短信；body `{provider, phone}` / `{provider, phone, code, name, id, deviceId, accounts}`<br>④ Tabbit：`login_tabbit_sms_{send,verify}`；Loomy：`login_loomy_sms_{send,verify}`（`{phone}` / `{phone, code, msgid, id, name, accounts}`）<br>⑤ `login_kuku_complete`、`login_oauth_captcha_config`<br>⑥ 桌面参考实现：`ui-islands/src/islands/add-account-kit.tsx`、`add-provider-tabbit.ts`、`add-account-dynamic-fields.ts`、`add-account-bridge.ts` |
| 实现落点 | `mobile/src/api/add-account-dynamic.ts`（扩展登录方式分支）、`mobile/src/pages/add-account-dynamic-sheet.tsx`（新增"短信"分段：手机号 → 发码 → 填码 → 命名并保存）；沿用既有 OAuth 分段的错误处理与 toast 风格 |
| 验证 | 三项本地检查；真机：用**真实手机号**跑一遍（这是唯一能验证的路径） |
| 风险 | ① 短信是**真实外发**动作，按钮要有冷却/防连点；② 三家提供商参数不同（Tabbit/Loomy/通用），要按 `login_methods` 的申报决定显示哪些字段；③ 验证码有效期与重发间隔需按上游返回的错误码提示 |
| 验收 | 用短信方式成功添加一个账号，账号出现在列表里且刷新正常 |

### M2.2 请求记录维护三件套
| 项 | 内容 |
|---|---|
| 契约核对 | 上游 `api/stats_api.rs::{stats_request_filters, stats_clear_preview, compact_stats_db}` 的参数与返回；桌面 `request-clear-modal.tsx` 的交互（筛选 → 预览 → 确认） |
| 实现落点 | `mobile/src/pages/RequestsPage.tsx` + 新 sheet（筛选 → 预览条数 → 二次确认 → 执行） |
| 验证 | 三项本地检查；真机：先看预览条数，再确认清理 |
| 风险 | **不可恢复**。必须：预览先出条数、确认按钮措辞明确（"永久删除 N 条"）、失败时给出原因 |
| 验收 | 预览条数与实际清理一致；压实后库大小下降且功能正常 |

### M2.3 精简路由（compact routes）
| 项 | 内容 |
|---|---|
| 契约核对 | 上游 `api/compact_routes.rs::{get_routes, put_routes}` 的载荷结构（**这一步决定整项工作量**）；桌面 `models-compact-dialog.tsx`、`models-compact-state.ts` |
| 实现落点 | `mobile/src/pages/ModelsPage.tsx` + 新 sheet |
| 验证 | 三项本地检查 |
| 风险 | 若 PUT 载荷是"整份替换"，要先读回再改（避免覆盖别人的改动），必要时参考 §②的 revision 思路 |
| 验收 | 手机上能改精简路由并回读一致 |

### M2.4 插件本地包安装
| 项 | 内容 |
|---|---|
| 契约核对 | 上游 `api/plugins.rs::install` — body `{packB64}`、返回与失败原因；桌面 `plugins-page.tsx` 的选文件流程 |
| 实现落点 | `mobile/src/api/plugins.ts` + `mobile/src/pages/PluginsPage.tsx`（选文件 → 读 base64 → 上传） |
| 验证 | 三项本地检查；真机：用一个真实插件包安装成功（**注意大包**） |
| 风险 | ① iOS WebView 的 `<input type="file">` 能否拿到文件内容要实测；② 大包的 base64 会放大 33%，需注意内存与超时；③ 未签名包的安装受配置开关影响，失败要回显上游原因 |
| 验收 | 手机上能从文件安装插件包，并出现在插件列表 |

### M2.5 模型映射「新增」（先核实）
| 项 | 内容 |
|---|---|
| 契约核对 | 先看 `mobile/src/lib/assistantTools.ts` 里 `mappings${action}` 的 action 取值——**若已含新增则本条撤销**；否则读 `api/model_manage.rs::add_mapping`（body 含 `create`/`enabled`/`reasoning`）与桌面 `models-dialogs.tsx` |
| 实现落点 | `mobile/src/api/gateway.ts` + `pages/ModelsPage.tsx` |
| 验证 | 三项本地检查 |
| 风险 | 低 |
| 验收 | 能新增一条模型映射并生效 |

---

## M3 · 调研：`/api/config` 有没有"只它才有"的东西

**目标**：判定要不要为 `/api/config` 补东西——**很可能结论是"不用做"**。

| 项 | 内容 |
|---|---|
| 方法 | ① 取桌面 `ui-islands/src/islands/settings-model.ts` 的 `CATEGORIES`（设置分区权威清单）与 `settings-state.ts`；② 逐项记录它读写的**端点和配置键**；③ 与手机端源码里已用的端点做差集；④ 差集里凡"只能用 `/api/config` 读写"的项，才是真缺 |
| 产出 | 一份"设置项 × 端点 × 手机端有无"的对照表（合并进 `MISSING-LIST.md` §E 或单独小节） |
| 结论分支 | (a) 差集为空 → 记为"不需要做"，写进记忆点；(b) 差集非空且项数少 → 按项补**细粒度端点**（优先）或小范围读写 |
| **明确不做** | 不把整份 `/api/config` 的读写暴露到手机面板。它是全量写入口，一旦界面把未知字段写回就会丢配置，风险远大于收益 |
| 量级 | **调研 S**；若要做，(b) 分支按项 S |

---

## M4 · 字段级核对（E 类，可与 M2 并行）

**目标**：把"功能都有，但手机上可能只做了一半"的东西查清楚。**只核对，不预设要补。**

| 核对项 | 对照物 | 产出 |
|---|---|---|
| 账号限流器 | 桌面 `accounts-limiter-*.tsx`（条件/模型/状态） vs 手机 `AccountsPage.tsx`/`AccountSheet.tsx` | 差几项 |
| 补签与签到计划 | 桌面 `checkin-makeup-*`、`checkin-schedule-extras.tsx` vs 手机 `pages/checkin/*` | 差几项 |
| 报表 | 桌面 `report-page.tsx`、`report-charts.ts` vs 手机 `ReportPage.tsx` | 差几项 |
| 积分简报 | 桌面 `/api/usage`、`/api/checkin/status` vs 手机（无，但有 `/api/accounts/usage`） | 要不要给入口 |
| 账号批量操作 | 桌面 `accounts-batch-dialog.tsx` vs 手机批量入口 | 差几项 |
| 设置项逐项 | 桌面 `settings-model.ts` `CATEGORIES` vs 手机设置页（旧文档做过，已过期） | 差几项 |
| 工具服务文档 | 桌面 `/api/web-search/*` 的文档页 | 归 C 类还是 D 类 |
| 模型精简/映射载荷 | 见 M2.3 / M2.5 | 结构确认 |
| 助手（assistant）细节 | 桌面 `assistant-*` 20+ 文件 vs 手机 `pages/assistant/*` | 差几项 |
| 路由画布 | 桌面 `routing-*` 40+ 文件 vs 手机 `routing-*` 页面 | 差几项（画布类可能要重新定"手机上要不要"） |

**产出**：核对结果写回 `MISSING-LIST.md` §E，把"未定论"变成"补/不补"，并据此追加里程碑。

---

## 2. 明确不做（C 类，附理由）

| 不做的东西 | 理由 |
|---|---|
| `agents/apply`、`agents/import`、`agents/profiles`、`agents/{id}/resources/*` | 目标是本机 CLI 客户端，iOS 没有落点 |
| `import/cc-switch` | 扫本机 SQLite；桌面自己也隐藏了入口 |
| `upgrade`、`upgrade/run` | 网关自升级（systemd/Windows 服务），iOS 走装 deb |
| `/v1/*`、`/mcp/*`、`/skill/*`、`/api/web-search/{search,fetch}` | 数据面与对外工具接口，不是面板功能 |
| `session/logout`、`session/refresh` | 网关侧会话；面板用 `/api/panel/*` |
| `backup/export`、`backup/import`（`filePath`） | 按服务器路径；手机等价物是下载/上传（已有） |
| 托盘 / 窗口 / 网格布局 / 表格列设置 | 桌面外壳能力 |
| `/api/subscriptions*` | 已下线（410） |
| **把整份 `/api/config` 暴露到手机** | 全量写入口，风险大于收益（见 M3） |

---

## 3. 验证与交付清单（每个里程碑都要过）

| 环节 | 要求 |
|---|---|
| 本地三项 | `pnpm exec tsc --noEmit`、`pnpm run build`、`python3 scripts/check-mobile-ui.py --root <repo>` 全 exit 0 |
| CI | 手机端改动看**第 14/15 步**（自检 + 构建）；若碰 Rust 看**第 9 步**、碰 Swift 看**第 16 步** |
| 包内验证 | 发布后用公开 deb 核对新增字符串（方法见 `DEVELOPMENT-MEMO.md` 步骤 38） |
| 真机清单 | 每项在 `DEVELOPMENT-MEMO.md` 末尾追加"怎么测、期望现象"（沿用既有格式） |
| 记忆点 | 每项一条（契约定论、踩的坑、验证结果、待核实） |
| 推送 | **按里程碑合并推送**，避免一次 push 一个文档（每次 push 都排一整套全平台 CI） |

---

## 4. 风险与对策（全局）

| 风险 | 对策 |
|---|---|
| 把"平台不适用"当缺口做 | §2 明确不做；`MISSING-LIST.md` §C 给了逐条理由 |
| 把"已用等价端点"当缺口做 | `MISSING-LIST.md` §D 列了 11 条对应关系，动手前先查 |
| 旧文档误导 | `GAP.md` 顶部已加指向；`MISSING-LIST.md` §F 用 30 条对照证明它已过期 |
| 不可恢复操作误伤 | 预览 + 二次确认 + 明确文案（M2.2、M0 的恢复） |
| 真机依赖（真发短信、装插件包） | 提前列为"必须真机"，不要只靠本地检查就宣布完成 |
| CI 排队（自造积压） | 合并推送；建议给 `build.yml` 加 `concurrency: cancel-in-progress`（需你决定，我不擅自改） |
| 端点被引用 ≠ 字段做全 | A 类每条第①步先读上游返回结构；M4 专门核对字段级 |

---

## 5. 里程碑节奏建议

| 轮次 | 做什么 | 产出 |
|---|---|---|
| 第 1 轮 | M0 + M1（5 项，全是 S） | 一次推送 + 5 条记忆点 |
| 第 2 轮 | M2.1 短信登录（单独一轮，最大） | 一次推送 + 真机验证清单 |
| 第 3 轮 | M2.2 + M2.3 | 一次推送 |
| 第 4 轮 | M2.4 + M2.5 | 一次推送 |
| 第 5 轮 | M3 调研 | 一份对照表（可能结论是"不用做"） |
| 第 6 轮起 | M4 逐项核对 → 按结果追加 | 每项一次推送 |

> 每轮结束都要能回答三个问题：改了哪些文件、本地三项是否全过、真机上怎么验。
> 任何一项如果**核对后发现要动 Rust/补丁**，先停下来单独评估，不要夹在手机端改动里一起推。

---

## 6. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-11-09 | 首版：基于 223 端点 × 两侧源码引用的比对（见 `FEATURE-PARITY.md`）制定；范围限定 A 类 10 条 + B 类 1 个 bug |
