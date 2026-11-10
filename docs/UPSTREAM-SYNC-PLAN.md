# 上游 v3.5.0-beta.1 功能补齐计划

> 基线：上游 `aimod-cc/Agent2API` tag `v3.5.0-beta.1`（2026-11-09）。
> 我们的 fork 的 `ui-shared` 与 `mobile` 精确停在 `v3.4.2`。
> 本计划只做「功能补齐」，**不改变**插件补丁（`agent2api-universal/patches/`）与 iOS 原生壳的既有方向。

## 一、现状基线（已核实的事实）

| 项 | 我们的 fork | 上游 v3.5.0-beta.1 | 差距 |
|---|---|---|---|
| `desktop-tauri/ui-shared` | **65 个**（= v3.4.2，逐字节一致，仅 `plugins.ts` 我们自己改过） | **131 个** | 缺 **66 个新模块**（约 300 KB）+ **25 个既有模块被上游改动** |
| `desktop-tauri/mobile/src` | **160 个**（53 个页面） | **100 个**（25 个页面） | 缺上游新增 **7 个文件**；我们另有 130 个自建文件 |
| 上游 API 路由 | — | 旧 244 条**一条未删**，新增 34 条 | 无破坏性变更 ✓ |
| 数据库 schema | — | 10 个（新增 `tool_images`/`maintenance`/`coding`/`model_recency`/`usage_query`） | `db/schema.rs::migrate()` 自动应用 ⇒ 升级无需人工干预 ✓ |
| 插件协议 | `Agent2Providers` tag `v3.4.0` | 同 | 未变 ✓ |

**关键结论（决定计划可行性）**
1. 25 个被上游改动的既有模块里，**24 个我们与 v3.4.2 完全相同** ⇒ 可直接用上游新版整体替换，**零冲突**。
2. 仅 **1 个需三方合并**：`plugins.ts`（v3.4.2 3287 B → 我们 3886 B → 上游 6606 B）。
3. 66 个新模块中 **29 个无内部依赖**、36 个的依赖**按功能域成闭环**（maintenance / checkin / plugins-script / vision / proxy 各自成组）⇒ **可按域分批引入**，每批独立可编译、可验证、可出包。
4. 缺失模块**不阻塞构建**：当前编译用的是我们自己的 `mobile` + 自己的 `ui-shared`，两者配套自洽（CI 已证明通过）。

## 二、目标与验收标准

**总目标**：手机面板在功能与表现上对齐上游 v3.5.0-beta.1，同时保留我们已有的全部自建能力（53 个页面、顶部悬浮重构、胶囊行为、WorkBuddy 网页登录、导出/导入增强等）。

**每批验收（缺一不可）**
1. `pnpm exec tsc --noEmit` 退出码 0
2. `pnpm run build` 成功，`ui/m/mobile.js` 体积在预期区间
3. `python check-mobile-ui.py --root <树>` 退出码 0（图标名 / i18n 参数 / 跳转 / 端点拼写）
4. CI `only=ios` 的 **iOS 作业** conclusion = success（注意：run 级恒为 success，不可作判据）
5. 该批**不破坏**既有 U1–U16 行为（顶部无横条、胶囊按状态显示、WorkBuddy 有网页登录、导出有范围选择、导入可选文件、提供商分类、趋势图、品牌行）

**总验收**：出包后按包内标记法核对，确认新功能与既有修复同时存在于 deb 中。

## 三、分批方案

### 批次 A —— 加固与老功能对齐（P0，先做，风险最低）

**A1. 0001 执行闸门扩展**（1 个补丁，最小改动）
- 现状：闸门 `exec_blocked()` 插在 `start()` 的 spawn 之前，覆盖「进程插件」与「脚本插件（bun）」两条路径。
- 遗漏 1：`L86 if self.options.wasm.is_some() { return self.start_wasm().await; }` 在闸门**之前**返回 ⇒ iOS 上 wasm 插件不被拦（iOS 禁 JIT，启动必失败，属于「装得上但用不了」）。
- 遗漏 2：`script/settings.rs` 的 `bun::ensure()`（下载 bun 运行时）在独立路径，不受闸门约束。
- 做法：把 `exec_blocked()` 的检查前移到 `start()` 入口（wasm 分支之前），并在 `bun::ensure()` 前加同一判定。
- 验证：补丁双重自检 + CI `only=ios` 绿。

**A2. 25 个既有 `ui-shared` 模块同步**（让老功能对上新版 gateway 响应）
- 24 个直接以新版替换；`plugins.ts` 做三方合并（保留我们 3886 B 里的本地增量，叠加上游新增的 `ScriptPluginsState` 等类型）。
- 重点收益：`logs.ts`（+6321 B，新增 `status/phase/plugins` 字段与 `logAdvice/logDetailText/formatLogDuration`）、`github-access.ts`（限流状态）、`account-sorting.ts`（余额排序）、`updates.ts`（`githubFailureMessage`）、`client-identification-panel.tsx`（+8015 B 增强）、`checkin.ts`（活动字段）、`usage-*.ts`（`queryStatus/stale`）。
- 风险：`logs.ts`/`plugins.ts` 的字段扩展会改变我们页面的解析路径 ⇒ 需同步核对 `LogsPage.tsx`、`PluginsPage.tsx`、`AccountsPage.tsx` 的渲染分支。

### 批次 B —— 运维类新功能（P1）

| 子项 | 引入内容 | 接入点 |
|---|---|---|
| B1 维护面板 | `maintenance-*.tsx/ts`（10 个，约 65 KB）+ `maintenance.css` + `searchable-select.tsx`（依赖） | `SettingsPage` 新增「维护」入口；`routes.ts` 加 `SCREEN_IDS` 项；`App.tsx` 加映射 |
| B2 页面自动刷新 | `page-auto-refresh.ts`、`page-auto-refresh-controls.tsx`、`page-auto-refresh-timer.ts`、`.css` | 日志 / 请求 / 账号页头部接入 `PageAutoRefreshControls` |
| B3 第三方许可 | `settings-third-party-licenses.tsx` | `SettingsPage` 关于区 |

### 批次 C —— 插件体系补齐（P1，上游本版主特性）

| 子项 | 引入内容 | 说明 |
|---|---|---|
| C1 脚本插件事务 | `plugins-scripts.tsx`(21 KB)、`plugins-script-{catalog,display,settings,options,progress,pagination,install-notice}.*`、`plugins-store.tsx`、`plugins-filters.ts`、`plugins-permissions.tsx` | 新端点 `/api/plugins/scripts/{catalog,install,check,change,settings,prompts}` |
| C2 插件运行态 | `plugin-startup.ts`、`plugin-startup-view.tsx`、`plugin-tasks.tsx`、`plugin-helpers.tsx`、`plugin-hidden.ts`、`plugin-login-interaction.tsx` | 端点 `/api/plugins/{startup,tasks,tasks/run,helpers,reload}`、`/api/session/login/{interaction,wasm-callback}` |
| C3 mobile 接入 | 新建 `mobile/src/lib/usePluginStartup.ts`（上游同名薄封装）、扩展 `PluginsPage` 支持「脚本插件」分段 | `SCREEN_IDS` 复用 `plugins`，内部分段 |

### 批次 D —— 提供商 / 代理 / 工具（P2）

| 子项 | 引入内容 | 接入点 |
|---|---|---|
| D1 提供商设置 | `provider-settings-panel.tsx`、`provider-settings-card.tsx`、`provider-settings.ts`、`plugin-provider-settings.tsx` + mobile `pages/provider-settings-page.tsx` | 端点 `/api/provider-settings`、`/api/plugins/provider-settings`；`AccountsPage`→提供商设置入口 |
| D2 代理批量编辑 | `proxy-batch-editor.tsx`(11 KB)、`proxy-import.ts`、`proxy-system.ts` | `ProxiesPage` 新增批量编辑/导入；端点 `/api/proxies/system` |
| D3 视觉/图片工具 | `settings-vision-*`(6 个)、`tools-image-*`(3 个)、`request-vision-detail.tsx`、`use-image-fallback.ts` + mobile `pages/ToolsImageGeneration.tsx`、`api/vision-compat.ts`、`api/maintenance.ts` | 端点 `/api/tools/image-generation/*`、`/api/vision-compatibility`；`ToolsPage`、`SettingsPage`、`RequestsPage` |

### 批次 E —— 品牌 / 验证码 / 签到 / 杂项（P2）

| 子项 | 引入内容 |
|---|---|
| E1 品牌 | `branding.ts`、`brand-logo.tsx` + mobile `lib/branding.ts`；端点 `/api/branding`、`/api/panel/branding` |
| E2 验证码 | `panel-captcha.ts`、`turnstile-widget.tsx`；端点 `/api/panel/turnstile`（与既有 altcha 并存，不替换） |
| E3 签到活动 | `checkin-campaign-types.ts`、`checkin-benefit-details.tsx`、`checkin-campaign-rewards.tsx`、`checkin-officeace-*.tsx` |
| E4 杂项 | `assistant-read-models.ts`(9 KB)、`model-capability.ts`、`provider-icons.ts`、`searchable-select.tsx`、`usage-query-settings.ts`、`usage-query-task.ts`、`github-failure.tsx`、`account-import-result.ts`、`antigravity-login.ts` |

### 批次 F —— 收尾与出包（P3）

1. 全量功能对照：上游 25 个 mobile 页面 vs 我们 53 个页面，逐项标注「已有 / 已对接 / 不需要 / 待做」
2. i18n 参数、图标名（`Icon.tsx` 白名单校验）、导航入口一致性
3. 三项本地检查 + CI + 出包 + 包内标记核对

## 四、合并方法（每批一致）

1. **先取基线**：`git`-less 环境下用保守策略 —— 文件级对比，确认目标文件是否与 `v3.4.2` 一致；一致 ⇒ 直接用上游新版整文件替换；不一致 ⇒ 三方合并（`v3.4.2` / 我们 / 上游新）。
2. **依赖前置**：按依赖图先引入被依赖模块（如 `maintenance-types.ts` → `maintenance-format.ts` → `maintenance-shared.tsx` → 其余）。
3. **接口核对**：新模块用到的新端点先确认上游 `http.rs` 里存在（已核实 34 条新增端点全部存在）。
4. **接入三件套**：`lib/routes.ts` 加 `SCREEN_IDS` → `App.tsx` 加映射 → 导航入口（`MorePage`/`NavBar`/对应功能页）加入口。
5. **验证四步**：`tsc` → `build` → `check-mobile-ui.py` → CI `only=ios`（判据是 **iOS 作业** conclusion）。
6. **记忆点 + 推送**：每批完成后写 `docs/DEVELOPMENT-MEMO.md` 并以 Git Data API 推送。

## 五、风险与回滚

| 风险 | 影响 | 应对 |
|---|---|---|
| 覆盖掉本地增量 | 丢失我们的改造 | 合并前逐文件确认是否等于 `v3.4.2`；仅 `plugins.ts` 需三方合并 |
| 新模块依赖上游未同步的 `ui-shared` 私有件 | 编译失败 | 按依赖图先引入；`tsc` 立刻暴露 |
| 端点存在但返回结构不同 | 运行时错配 | 每批对照上游 `http.rs`/`api/*.rs` 的响应结构；必要时读 Rust 侧字段 |
| 一次性引入过多导致定位困难 | 排障成本高 | 严格按批，每批独立验证与出包 |
| 新入口挤占手机端导航 | 体验退化 | 新功能优先收进「更多」二级页，不占用底部 5 个主 Tab |

**回滚**：每批一个提交，回滚即 revert 该批；`ui-shared` 为整文件替换，回滚无残留。

## 六、顺序与依赖

```
批次 A（A1 闸门 + A2 老模块同步）
   ↓  （A2 是后续批次的基础：新模块依赖新版既有模块）
批次 B（维护 / 自动刷新 / 许可）
   ↓
批次 C（脚本插件 + 插件运行态）  ←── 上游本版主特性，价值最高
   ↓
批次 D（提供商设置 / 代理 / 视觉图片）
   ↓
批次 E（品牌 / 验证码 / 签到 / 杂项）
   ↓
批次 F（收尾 + 出包 + 包内核对）
```

每批结束都是一次「可出包状态」，任一批延期不影响已完成的批次。
