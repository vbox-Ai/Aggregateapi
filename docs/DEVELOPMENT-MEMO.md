# Agent2API 手机端开发 · 交接记忆点（MEMO）

> 本文件是各阶段开发的持久化记忆点。每次完成一个开发步骤，先更新本文件再推送，
> 之后任何新会话都可以只读本文件继续，不需要重看全部对话。
> 仓库：`vbox-Ai/Aggregateapi`，主分支 `main`。

---

## 0. 项目现状（最新）

- 手机端源码已从上游 `aimod-cc/Agent2API` tag `v3.4.2` 拉取并推送到本仓库。
- 本地验证环境：
  - 手机工程：`desktop-tauri/mobile/`
  - 组件库：`desktop-tauri/ui-kit/`
  - 共享组件：`desktop-tauri/ui-shared/`
  - 共享 islands：`desktop-tauri/ui-islands/`
  - 构建需要 `desktop-tauri/ui/aliyun-captcha.js`（已纳入）。
- 构建命令：
  ```bash
  cd desktop-tauri/mobile
  pnpm install
  pnpm exec tsc --noEmit
  pnpm run build
  ```
  产物：`desktop-tauri/ui/m/mobile.js|mobile.css|sw.js`。
- 基线校验：上游 v3.4.2 源码构建出的 `mobile.js` SHA256
  `67663cf046b8800eddffd18f8a0ed938a9846ef89adca75cd993feb1f057662da`
  与当前 `3.4.182` 包内 bundle 完全一致。

### 构建管线已转绿（2026-11-08）

- iOS 作业 16 步全过（含「校验 shell 脚本」「构建手机面板 UI」「打 IPA + 打包 deb」「上传产物」）。
- 产物已发布到 Release：tag 形如 `ios-YYYYMMDD-bNNN`，含四个 deb
  （rootful/rootless × arm64/arm64e）+ 两个插件 zip。带插件包的构建用
  `only=store`（同时跑 plugins + ios 两个作业），只编 iOS 用 `only=ios`。
- **产物校验方法**：`desktop-tauri/ui/m/mobile.js` 的 SHA256 与 deb 内
  `usr/local/share/agent2api/ui/m/mobile.js` 逐字节比对 —— 一致即证明 deb 装的是
  本次源码构建的面板。校验脚本思路见「5. 工程注意」。
- 修掉的三个「会让改动不生效 / 构建失败」的问题（均为历史遗留）：
  1. `agent2api-ios/scripts/build-ipa.sh` 被 PowerShell 按 GBK 往返写过，中文变乱码、
     引号被 `?` 吃掉，`set -euo pipefail` 被并进注释 → 从损坏前提交恢复后重新打补丁。
  2. `scripts/build-allinone-deb.sh` 同类损坏（连换行都被吃掉）→ 用完好版本 + 补回
     postrm 打包那两行重建。
  3. `agent2api-ios/daemon/postinst.sh` 4 行错误提示乱码 → 按干净旧版本的原文修回。
- CI 已加闸门「校验 shell 脚本（编码 + 语法）」：`git ls-files '*.sh'` 逐个查
  UTF-8 BOM 与 `bash -n`。**脚本损坏以后会在这一步立刻暴露**，不会再拖到打包阶段。
- ⚠️ 教训：**永远不要用 PowerShell 的 `Get-Content -Raw` / `Set-Content` 处理含中文的
  UTF-8 文件**（按 GBK 解码 + 写回 BOM，且会吃掉引号与换行）。用 `write`/`edit` 工具，
  或 Python 显式 `encoding='utf-8', newline='\n'`；二进制一律 `Invoke-WebRequest -OutFile`。

## 1. 开发目标

手机-only：逐步移除桌面面板 `/`，手机面板 `/m` 补齐 P0/P1/P2。
P0 顺序：Key 管理 → 账号凭证 → GitHub Token → 安全 → 备份/恢复 → 登录持久化。

## 2. 已完成步骤

### Phase 0：源码与工程（已完成）
- 拉取上游 v3.4.2 源码并推送：commit `cedab6c78233010161ed1d19bfe28779e3fc2870`
- typecheck / build 验证通过；基线 hash 一致。

### Phase 1.1：网关 Key 管理（已完成）
- 提交：`d2d09257a75673d24d414f5aae1266874d069e88`（feat(mobile): Phase 1.1 gateway key create/edit scope on phone）
- 改动文件：
  - `desktop-tauri/mobile/src/api/gateway.ts`
    - 新增 `createKey(payload)` → POST `/api/keys`（body: name/key/allowedProviders/allowedModels）
    - 新增 `updateKey(id, payload)` → PATCH `/api/keys/:id`（name/allowedProviders/allowedModels）
    - 新增类型 `KeyCreatePayload` / `KeyUpdatePayload`
  - `desktop-tauri/mobile/src/pages/KeysPage.tsx`
    - 右上角“新建 Key”按钮（`Icon name='plus'`）
    - `KeyEditorSheet`：名称、Key 值（新建时，可留空自动生成，最短 8 字符）、
      可用提供商 MultiSelect、可用模型 MultiSelect（来源 `KeysPayload.providers` / `modelsByProvider`）
    - Key 卡片增加“可用范围”编辑入口（`Icon name='settings'`）
    - 空状态改为引导手机端新建
- 验证：`pnpm exec tsc --noEmit` 通过；`pnpm run build` 通过；
  `mobile.js` 从 1062.95 kB → 1066.22 kB。

### Phase 1.2：账号凭证导入（粘贴导入）（已完成）
- 提交：`8e3c7cc1e487959f4d26ce9306910a16a320259a`（feat(mobile): Phase 1.2 account credential import by paste）
- 关键发现：桌面端“导入凭证文件”走 `POST /api/accounts`，body 为
  `{ provider, authFileContent, authFileName, name }`；不需要 provider 声明动态登录
  （501 provider 也可用）。手机端之前只实现了动态登录通道。
- 改动文件：
  - `desktop-tauri/mobile/src/api/gateway.ts`
    - 新增 `addAccountByFile(payload)` → POST `/api/accounts`（authFileContent 通道）
    - 新增类型 `AccountFileImportPayload`
  - `desktop-tauri/mobile/src/pages/account-import-sheet.tsx`（新增）
    - `AccountImportSheet`：选择提供商 → 粘贴凭证 JSON/文本（Textarea）→ 提交
    - 高频 provider 提示：raccoon / deepseek-web / doubaowork / tabbit / codearts
  - `desktop-tauri/mobile/src/pages/AccountsPage.tsx`
    - 右上角增加“导入凭证”按钮
- 验证：typecheck / build 通过；`mobile.js` 1066.22 kB → 1069.58 kB。
- 备注：手机端“导出凭证文件”暂无 HTTP API（桌面走壳层下载），留待网关侧加导出接口或标桌面专属。
  已有账号的凭证编辑（手工改 token/cookie）仍待后续（计划是 1.2 后续部分）。

### Phase 1.4：修改面板密码（已完成）
- 提交：`b3f65734212e0270a31e8ac9094c9011bea2dd64`（feat(mobile): Phase 1.4 change panel password）
- 上游网关契约（`api/panel.rs`）：
  - `POST /api/panel/change-password` body `{ oldPassword, newPassword }` → `{ changed: true }`
  - 需要已登录会话；成功后其他会话链失效，当前会话保留。
  - 重置管理员没有独立 API（文档：删库重注册），手机端不做重置入口。
- 改动文件：
  - `desktop-tauri/mobile/src/pages/change-password-sheet.tsx`（新增）：当前密码/新密码/确认
  - `desktop-tauri/mobile/src/pages/SettingsPage.tsx`：账号分组加“修改密码”入口（仅 packaged 形态）
- 验证：typecheck / build 通过；`mobile.js` 1071.49 → 1074.14 kB。

### Phase 1.5：整库备份 / 恢复（已完成）
- 提交：`419d218c6e149c9eeaa9a24076ba152ceeb8a5c1`（mobile UI）+
  `8a203928649d4b5b491f3c4be694e9e8ec60db1c`（iOS 下载桥）+
  `f4d439eb27390be402c918de97c83b4c60eb8678`（WKDownloadDelegate 加 iOS 15.4 守卫）
- 上游网关契约（`api/backup_api.rs`）：
  - `POST /api/backup/download` body `{ password, includeLogs }` → `.a2ab` 二进制流
  - `POST /api/backup/upload` multipart `password` + `backup` → 恢复
  - `GET /api/backup/restore/progress` → 恢复进度
- 改动文件：
  - `desktop-tauri/mobile/src/api/backup.ts`（新增）：downloadBackup / uploadBackup
  - `desktop-tauri/mobile/src/pages/backup-restore-sheet.tsx`（新增）：密码 + 包含日志 + 选择文件恢复
  - `desktop-tauri/mobile/src/pages/SettingsPage.tsx`：增加「数据」分组
  - `agent2api-ios/app/Agent2API/PanelViewController.swift`：WKDownloadDelegate，备份下载
    落到临时文件后用 UIActivityViewController 分享（保存到「文件」）
- 验证：typecheck / build 通过；`mobile.js` 1074.14 → 1078.98 kB。
- 备注：恢复用 `<input type=file>`（WKWebView 支持 File API）；备份下载需要
  WKDownloadDelegate（iOS 15.4+，部署目标 15.0，已用 `@available` 守卫）；
  否则 `<a download>` 不会落盘。

### Phase 1.6：面板登录持久化（已完成）
- 提交：`8c6fcb7381c18ceaa38f52b0b964b36eb6748771`
- 问题：WKWebView 用 `nonPersistent()` 数据存储，localStorage 每次启动清空 →
  每次重开 App 都要重新登录面板。
- 方案：登录令牌存 iOS Keychain（Security framework），启动时注入回 localStorage。
- 改动文件：
  - `agent2api-ios/app/Agent2API/PanelSessionStore.swift`（新增）：
    Keychain save/load/delete/allServerIds + restoreScript（生成注入 localStorage 的脚本）
  - `agent2api-ios/app/Agent2API/PanelViewController.swift`：
    - `webView.downloadDelegate = self`（备份下载，`@available(iOS 15.4, *)` 守卫）
    - 注册 `a2aSession` 消息桥 + documentStart 注入 restoreScript
    - `handleSessionMessage`：`{op:'save'|'delete', serverId, json}`
  - `desktop-tauri/mobile/src/lib/servers.ts`：
    - `storeServerAuth` 同步写 Keychain（`persistToNative`）
    - `clearServerAuth` 同步删除 Keychain
- 验证：typecheck / build 通过；`mobile.js` 1078.98 → 1079.16 kB。
- 备注：`restoreScript` 在 `viewDidLoad` 构建 webView 前注入，所有 `agent2api.panelAuth.<id>`
  从 Keychain 恢复；登出会同步删 Keychain。

### Phase 2.3：Provider 文档与插件日志（已完成）
- 提交：`485b2236ff248a51067188afb62d2133dee920a2`（feat(mobile): Phase 2.3 provider docs & plugin logs）
- 现状确认：手机端已有 providerDocs（DocsPage 从 `/api/plugins` 读取）、登录方式说明
  （add-account-dynamic-sheet）、支持模型/能力（ModelsPage）、运行日志（/api/logs）。
- 新增：
  - `LogsPage`：增加分类筛选（全部/插件/账号/模型/网关/请求），并从路由参数
    `category` 初始化（`store.get().route.params.category`）。
  - `PluginsPage`：增加「插件日志」按钮 → 跳转 logs 页并预筛 `category=plugin`；
    增加「最近失败」折叠块，列出有 error/hostError 的插件操作（最多 6 条）。
- 验证：typecheck / build 通过；`mobile.js` 1079.16 → 1080.42 kB。

### Phase 2.4：账号导出 + 重新粘贴凭证（已完成）
- 提交：`531e7f475f0afb3a97c798a68057bc461bcad5ab`（feat(mobile): account export (all/single) and re-paste credentials）
- 上游网关契约（`api/accounts.rs` 模块头 + `accounts_export.rs`）：
  - `GET /api/accounts/export` → 全部账号 JSON（含 token 与自定义提供商定义）
  - `POST /api/accounts/export-files` body `{ id? }` / `{ provider? }` → 单账号 / 本组逐账号文件
  - `POST /api/accounts/import` body `{ accounts: [...] }` → merge 语义（同身份命中更新，未命中追加）
  - `PATCH /api/accounts/{id}` → `{ name?, priority?, enabled?, proxy? }`（**不含凭证**）
- 改动文件：
  - `desktop-tauri/mobile/src/api/gateway.ts`：新增 `exportAccounts()` / `exportAccountFile(selector)` / `importAccounts(accounts)`
  - `desktop-tauri/mobile/src/lib/download.ts`（新增）：`downloadJson` / `downloadBlob` / `safeFileName` / `dateStamp`
    （备份/导出共用，iOS 壳由 WKDownloadDelegate 接管落盘）
  - `desktop-tauri/mobile/src/pages/AccountsPage.tsx`：PageHead 增加「导出」按钮（导出全部账号）
  - `desktop-tauri/mobile/src/pages/AccountSheet.tsx`：footer 增加「导出账号」「重新粘贴凭证」
    （重新粘贴凭证 = 用该账号的 provider 预选打开 AccountImportSheet，导进去就是同身份更新）
  - `desktop-tauri/mobile/src/pages/account-import-sheet.tsx`：新增 `initialProvider` prop
- 验证：typecheck / build 通过；`mobile.js` 1080.42 → 1082.45 kB。
- 备注：「逐账号编辑凭证」的正确姿势是重新粘贴（merge 更新），不是 PATCH（PATCH 只改属性）。

### Phase 2.5：忘记密码 → 删库重注册（已完成）
- 提交：`85327f8b7e3d500c8afad65e75137efeef6c4a55`（feat(ios+mobile): factory reset）
- 结论先行：网关**没有**找回/重置密码接口 —— `api/panel.rs` 原文写着
  「忘记密码时重置是删库重注册」。supervisor 原来只有
  `/health /status /start /stop /heartbeat`，所以手机端原本无路可走。
- 方案：给 supervisor 加破坏性接口，App 侧二次确认后调用。
  - `agent2api-ios/ios-ffi/src/bin/agent2api-supervisor.rs`：
    - 新增 `POST /factory-reset`：`stop_child` → 删 `agent2api.db`、`agent2api.db-*`、`*.key`
      → `start_child`（起来就是空库，管理员未注册）。保留 `*.log` 供排障。
  - `agent2api-ios/app/Agent2API/PanelViewController.swift`：
    - 注册 `a2aControl` 消息桥（跨端口 fetch 会被 CORS 拦，必须走原生）
    - `factoryResetSupervisor()`：URLSession POST `127.0.0.1:3066/factory-reset`，
      成功后清 localStorage 并 reload（回到首次注册页）
  - `desktop-tauri/mobile/src/pages/LoginPage.tsx`：
    - 新增「忘记管理员密码」入口（仅 packaged）+ 二次确认 Sheet：
      必须手输「重置」才可点按钮；提示会删账号 / Key / 令牌 / 日志 / 设置
    - 导出 `callSupervisor(op)` 供其它页面复用
### Phase 2.6：插件自定义 UI 页面（已完成）
- 提交：`cf0ab23f680e70f639b373e79723ee1218469cac`（feat(mobile): Phase 2.2 plugin custom UI pages）
- 上游契约（`api/plugin_ui.rs` + `plugin_host/pack_view.rs`）：
  - `GET /plugins/{pack}/ui/{*rest}` —— 网关托管插件页面，**不鉴权**（页面只是代码），
    只服务**已启用**包的 `ui/` 目录，`..` 与绝对路径拒绝。
  - `/api/plugins` 的 `packs[].ui[]` = `{ id, title, icon?, url, group?, order }`
    （`updateRequired` 时为空数组）。
  - 页面里的 `/api/*` 请求带不上面板令牌头 —— 宿主要用 postMessage 把令牌送进去。
- 改动文件：
  - `desktop-tauri/ui-shared/plugins.ts`：新增 `PackUiSummary` + `PackSummary.ui?`
  - `desktop-tauri/mobile/src/api/plugins.ts`：re-export `PackUiSummary`
  - `desktop-tauri/mobile/src/lib/routes.ts`：`plugin:<pack>:<page>` → `plugin-page`
    屏幕（保留 `pack` / `page` 两个 params）；不再把插件页并到 `plugins`
  - `desktop-tauri/mobile/src/pages/PluginPageView.tsx`（新增）：
    拉 `/api/plugins` 找到 `pack.ui[page]` → iframe 加载 `entry.url`；
    sandbox=`allow-scripts allow-forms allow-same-origin allow-popups allow-downloads`
    （**不给** top-navigation）；只允许同 origin 的 `/plugins/` 路径；
    加载完成 `postMessage({type:'a2a-auth', access})`；错误态给返回与排查提示
  - `desktop-tauri/mobile/src/pages/MorePage.tsx`：新增「插件页面」分组，
    从 `packs[].ui[]` 动态生成（只列 `enabled` 的包），点了 `push('plugin:<pack>:<id>')`
  - `desktop-tauri/mobile/src/App.tsx`：注册 `plugin-page` 屏幕
- 验证：typecheck / build 通过；`mobile.js` 1084.55 → 1087.49 kB。
- 待验证：插件页里若自己 fetch `/api/*`，需要面板令牌；当前只做了 postMessage 投递，
  插件若不监听 `a2a-auth` 消息则仍会被 401 —— 这属于插件侧契约，桌面端同样是这一步。
- **未验证**：Rust supervisor 与 Swift 本环境无工具链，需 CI（ios job）编译确认；
  删库仅删 `config_dir` 下 `agent2api.db*` 与 `*.key`，路径来自 supervisor 的 `home`。

### Phase 3.1：路由配置（已完成）
- 提交：`b3075aa9d01997efcc6a713f35a09b5ddac1538b`
- 上游契约（`api/routing_api.rs`）：
  - `GET  /api/routing`              → 生效的全量路由设置（strategy / sticky / failoverBackoff / sink / breaker*）
  - `PUT  /api/routing`              → 部分字段 patch（不给 = 不动），保存后下个请求立即生效
  - `GET  /api/routing/queue?model=` → 队列可见化：候选顺序 + 选中 + 被跳过 + 原因
    （**排序实现与转发选路是同一个函数** `routing::plan_route`，界面与实际不会分叉）
- 手机端不做的部分：路由组 / 路由工作空间 / 迁移旧配置 —— 那些走桌面 Tauri 壳
  （`saveRoutingProfile`），网关没有给它们 HTTP 入口。手机端只做全局策略 + 队列预演。
- 改动文件：
  - `desktop-tauri/mobile/src/api/routing.ts`（新增）：`fetchRouting` / `putRouting` / `fetchRoutingQueue`
  - `desktop-tauri/mobile/src/pages/RoutingPage.tsx`（新增）：
    - 全局策略：选路策略（order / rotate / provider）+ 会话粘滞 + 失败后退避
    - 队列预演：模型框留空 = 全部模型；显示候选顺序、选中项、被跳过账号及原因
    - 模型框用自由输入（会话 provider 摘要不含模型清单，硬凑下拉会误导）
  - `desktop-tauri/mobile/src/App.tsx` / `lib/routes.ts` / `MorePage.tsx`：注册入口
- 验证：typecheck / build 通过；`mobile.js` 1103.71 → 1108.69 kB。

### Phase 3.3：自定义提供商（已完成）
- 提交：`45976fa43d4943399112f8c4e0f08b2ef9576b02`
- 上游契约（`api/custom_providers.rs` + `core/custom_providers.rs`）：
  - `GET  /api/custom-providers`                    → `{ providers: [...] }`（按创建时间升序）
  - `POST /api/custom-providers`                    → body `{name, protocol, baseUrl, apiKey, ...}`
    **一次事务建齐提供商 + 首个账号**（失败回滚提供商，不留半成品）
  - `POST /api/custom-providers/update`             → `{id, name?, protocol?, baseUrl?, enabled?}`（缺省不动）
  - `POST /api/custom-providers/remove`             → `{id}`（级联删名下账号 + 从各 Key 白名单摘除）
  - `POST /api/custom-providers/fetch-models`        → `{providerId}`，服务端代理拉上游清单（不落盘）
  - `POST /api/custom-providers/models`             → `{providerId, models, mappings}`，整表替换
- 提供商对象字段：`id / name / protocol / baseUrl / enabled / createdAt / models / mappings`
  （另有 `urlSuffix / headers / anthropicToolType / clientEmulation / balanceScheme` 预置修正项，手机端不展示）
- 改动文件：
  - `desktop-tauri/mobile/src/api/custom-providers.ts`（新增）：六个调用 + `PROTOCOL_OPTIONS`
  - `desktop-tauri/mobile/src/pages/CustomProvidersPage.tsx`（新增）：
    - 列表：名称 / 协议 / 地址 / 启停 / 编辑 / 拉取模型 / 删除
    - 新建：名称 + 协议 + Base URL + API Key，一次提交
    - 编辑：名称 + 协议 + 地址 + 启停
    - 拉取模型：两步式（拉取不落盘 → 勾选 → 整表保存）
  - `desktop-tauri/mobile/src/App.tsx`：注册 `custom-providers` 屏幕
  - `desktop-tauri/mobile/src/lib/routes.ts`：加入 `SCREEN_IDS`
  - `desktop-tauri/mobile/src/pages/MorePage.tsx`：「更多 → 转发链路」加入口
- 验证：typecheck / build 通过；`mobile.js` 1093.75 → 1103.71 kB。
- 备注：删除提供商级联删账号且不可恢复，有二次确认；预置修正项（urlSuffix 等）
  手机端不做 UI，留给需要它们的人用桌面端。

### Phase 3.4：请求 / 日志导出（已完成）
- 提交：`752d9bf960c07756a59960e27c9c63dc3bf1a242`
- 现状确认：手机端 RequestsPage 已具备时间范围 / 状态 / 提供商 / 重试 / 在途筛选与详情，
  LogsPage 已具备分类 + 级别筛选。缺的只是**导出**。
- 上游契约：网关没有请求日志的 HTTP 导出接口（桌面走壳层 `workbuddyDesktop`）；
  「replay」在桌面端是**选路快照回放**（路由当时命中了谁），不是重发请求。
- 改动文件：
  - `desktop-tauri/mobile/src/pages/RequestsPage.tsx`：
    - PageIntro 加「导出」按钮 → 把当前已加载的 `rows` 落成 `.json`
    - （含请求体与响应摘要，够排查用）
  - `desktop-tauri/mobile/src/pages/LogsPage.tsx`：
    - PageIntro 加「导出」按钮 → 把当前渲染的分组（含原始记录）落成 `.json`
  - 两页都引入 `downloadJson` / `dateStamp`（复用 Phase 2.4 的 `lib/download`）
- 验证：typecheck / build 通过；`mobile.js` 1092.97 → 1093.75 kB。
- 备注：导出的是**当前页**内容，不是全量 —— 全量导出需要网关加接口或分页拉全。

### Phase 3.5：账号批量操作（已完成）
- 提交：`e813301785acdf63b62004038f64bb414a8c0269`
- 上游契约（`api/accounts_batch.rs`）：
  - `POST /api/accounts/batch` body `{ ids: string[], action }`
  - action 支持 `remove` / `enable` / `disable` / `proxy` / `concurrency` / `usageQuery` / `limiters`
  - 响应带 `action` 与 `list`，手机端只需 `load()` 刷新
- 改动文件：
  - `desktop-tauri/mobile/src/api/gateway.ts`：新增 `batchAccounts(action, ids)`
  - `desktop-tauri/mobile/src/pages/AccountsPage.tsx`：
    - PageHead 加「批量」按钮 → 开启选择模式（再点取消）
    - 每行加勾选框（`selected` / `onSelect`），选择模式下点行改为勾选而不是开详情
    - 底部批量条：全选 / 取消全选 + 启用 / 禁用 / 删除（删除有二次确认）
    - 导入 `serverIdentity` / `confirmDialog` / `batchAccounts`
- 验证：typecheck / build 通过；`mobile.js` 1090.50 → 1092.97 kB。
- 备注：批量条只在选择模式下出现，跟着内容滚动；批量操作会刷新会话。

### Phase 3.6：系统 / 服务控制（已完成）
- 提交：`a64a2f87fc21f352e0534df78bc43ef838b25f72`
- supervisor 控制口契约（`agent2api-ios/ios-ffi/src/bin/agent2api-supervisor.rs`）：
  `GET /status`、`POST /start`、`POST /stop`、`POST /heartbeat`、`POST /factory-reset`
  —— 服务控制复用了已有三条，**没改 Rust**。
- 改动文件：
  - `agent2api-ios/app/Agent2API/PanelViewController.swift`：
    - `factoryResetSupervisor()` → 泛化为 `supervisorCall(op:id:)`，按 `op` 选方法与路径
    - 结果经 `deliverSupervisorResult` 回给 JS（`a2a-control-result` 事件，带 id 配对）
  - `desktop-tauri/mobile/src/api/supervisor.ts`（新增）：
    - `supervisorCall(op)`：走 `webkit.messageHandlers.a2aControl`，无桥时如实报错
    - `supervisorStatus()` / `supervisorStart()` / `supervisorStop()` / `supervisorFactoryReset()`
  - `desktop-tauri/mobile/src/pages/SettingsPage.tsx`：新增「服务」分组
    （读数 + 启动/停止/刷新），与服务器切换绑定，读不到静默
  - `desktop-tauri/mobile/src/pages/LoginPage.tsx`：重置改用共享的 `supervisorFactoryReset`，
    删掉本地 `callSupervisor`
- 验证：typecheck / build 通过；`mobile.js` 1087.49 → 1090.50 kB。
- 备注：`a2aControl` 的 `id` 配对让并发调用互不覆盖；原生侧 35s 无回音判超时。

## 3. 下一步

### Phase 1 遗漏检查（已完成复核）
已核对上游 Rust 契约，确认以下实现与网关一致：
- `POST /api/keys` body `{name?, key?, allowedProviders?, allowedModels?}`（keys_api.rs）
- `PATCH /api/keys/{id}` body `{name?, enabled?, allowedProviders?, allowedModels?}`
- `GET /api/keys` 返回 `{keys, authRequired, providers, modelsByProvider}`
- `POST /api/update/token` body `{token: string|null}`（api/update.rs）
- `POST /api/panel/change-password` body `{oldPassword, newPassword}`（api/panel.rs）
- `POST /api/backup/download` body `{password, includeLogs}`；`POST /api/backup/upload` multipart
- `POST /api/accounts` body 可为 `{provider, authFileContent, authFileName, name}`（桌面同款）

仍存在的已知缺口（不阻塞手机-only 日常使用）：
1. **账号逐账号/整库 JSON 导出**：网关没有 HTTP 导出接口（桌面走壳层下载），
   手机端暂不做；可用整库备份 `.a2ab` 替代。
2. **已有账号凭证手工编辑**：手机端支持“粘贴导入”（新增/更新同身份账号），但没有
   “编辑这一个账号的 token/cookie”表单；需要 provider 级字段声明，留到后续。
3. **重置管理员**：网关无 API（删库重注册），手机端不提供。
4. **Swift 改动未在本环境编译**：`PanelSessionStore.swift` / `PanelViewController.swift`
   需要在 iOS 构建（CI 或本机 xcodebuild）里验证；本环境只能做静态检查。

### 已知缺口（2026-11-08 复核，前 3 条已解决）
1. ~~账号逐账号/整库 JSON 导出~~ **已解决**（Phase 2.4）：`GET /api/accounts/export` +
   `POST /api/accounts/export-files`，手机端直接落盘。
2. ~~已有账号凭证手工编辑~~ **已解决**（Phase 2.4）：「重新粘贴凭证」= merge 更新同身份账号；
   注意网关的 `PATCH /{id}` **不含凭证字段**，凭证只能靠导入。
3. ~~重置管理员~~ **已解决**（Phase 2.5）：supervisor 新增 `POST /factory-reset`
   （删库重注册），App 侧走 `a2aControl` 桥。
4. **Swift 改动未在本环境编译**：`PanelSessionStore.swift` / `PanelViewController.swift`
   需要在 iOS 构建（CI 或本机 xcodebuild）里验证；本环境只能做静态检查。
5. **Rust supervisor 未在本环境编译**：无 rustc；`/factory-reset` 与既有 `/start|/stop|/status`
   同一套 `handle()` 分发，逻辑已人工复核。

### 已完成（Phase 2 与 Phase 3 起步）
- Phase 2.1 插件设置：检查计划 / 更新通道 / 自动更新 / 镜像加速 / 签名策略 / 插件日志入口
  —— 手机端已有，无需改动。
- Phase 2.2 插件自定义 UI 页面 —— **已完成**（`cf0ab23`）
- Phase 2.3 Provider 文档与日志 —— **已完成**（`485b223`）
- Phase 2.4 账号导出 + 重新粘贴凭证 —— **已完成**（`531e7f4`）
- Phase 2.5 忘记密码 → 删库重注册 —— **已完成**（`85327f8`）
- Phase 3.6 服务控制 —— **已完成**（`a64a2f8`）

### 待继续

- **设置补全系列**：按 `docs/mobile-ui/DEVELOPMENT-PLAN.md` 分批做，批 1 起（详见第 2 节
  「手机端设置补全系列」的批次进度表）。每批：实现 → 本地 `tsc + build` → 补记忆点 → 推送 → 下一批。
- **Phase 4：移除桌面面板**（手机-only 收尾，等设置补全告一段落再做）
  1. 增加 `mobileParity` 开关；
  2. P0 全部验收后默认关闭桌面入口；
  3. 移除 `PanelViewController` 的"桌面面板"按钮；
  4. `/` 路由重定向到 `/m`（或只留调试开关）；
  5. 清理 `showingDesktop` / `toggleDesktopPanel`；
  6. 回归：新装 / 升级 / 备份恢复 / 插件安装 / 多服务器 / 后台前台 / RootHide。

### Phase 3 已完成清单
- 3.1 路由配置 —— `b3075aa`（全局策略 + 队列预演；路由组/工作空间是桌面 Tauri 壳的事务，网关无 HTTP 入口）
- 3.2 工具 / MCP / Skill —— 手机端已有 AgentPage / ToolsPage 管理网关侧 Skill/MCP，本阶段无需改动
- 3.3 自定义提供商 —— `45976fa`（新建/编辑/拉取模型/删除）
- 3.4 日志/请求高级能力 —— `752d9bf`（请求日志导出 + 运行日志导出）
- 3.5 账号批量/分组 —— `e813301`（批量启用/禁用/删除 + 全选）
- 3.6 系统/服务控制 —— `a64a2f8`（supervisor 状态/启动/停止/刷新）

### 构建管线修正（2026-11-08，提交 a5195a0）
发现两个会让改动“不生效/构建失败”的遗漏，已修：

1. **CI 不编手机面板 UI**：原流程用上游 checkout 的
   `Agent2API/desktop-tauri/ui`（预编译 `mobile.js`），`desktop-tauri/mobile` 源码根本没被构建。
   → 新增步骤「构建手机面板 UI（从源码）」：`npm ci && npm run build`，
   再把 `desktop-tauri/ui/m` 与 `desktop-tauri/ui/sw.js` 复制进 `Agent2API/desktop-tauri/ui/`，
   这样 deb / IPA 的 `--ui` 用的是新编的 mobile.js。
2. **build-ipa.sh 的 swiftc 文件列表是硬编码的**：新增的 `PanelSessionStore.swift` 不在列表里，
   iOS 编译会失败（PanelViewController 引用不到）。→ 已加入 `xcrun swiftc` 的源文件列表。
   （`-framework Security` 本来就有，Keychain 可用。）
3. **.gitignore**：忽略 `desktop-tauri/ui/m/`、`desktop-tauri/ui/sw.js`、`desktop-tauri/mobile/android-www/`
   构建产物，避免误提交。

注意：`build-ipa.sh` 在 `Aggregateapi` 仓库里、但实际是在 macOS 上用 `SRC=.../Agent2API`
跑；它编译的是 `$ROOT/app/Agent2API/*.swift`（本仓库的 Swift 源码）。改 Swift 后需重跑
CI 或本机 `xcodebuild` 验证（本环境无法编译 Swift）。

### 备份 / 恢复补全（2026-11-08，提交 08056eb）

补齐了四处与网关契约的差距：

1. **恢复进度**：网关 `GET /api/backup/restore/progress` 提供 `{active, phase, percent, done,
   failed, error}`，**阶段文案与百分比都由后端给**（`db/backup.rs` 的 `RestorePhase::label/percent`，
   步骤顺序的唯一权威）。手机端按 500ms 轮询显示进度条 —— 恢复要读文件、解密、在暂存库跑 SQL、
   拍安全备份、覆盖主库、重载内存态，30 秒到几分钟，不轮询就只有一个转圈按钮。
2. **恢复后强制回登录**：恢复会整体替换数据库（含面板会话表），现在主动 `clearPanelAuth()` +
   `store.setAuthLost('login')`，不再等下一个请求撞 401。
3. **密码规则对齐 `archive::validate_password`**：备份 ≥12 字且 ≤1024 字节；**恢复只看非空**
   （旧 `.sql` 备份本来就没密码）；两者都封顶 1024 字节。
4. **数据区入口**：补「导出运行日志」与「清空整库」（清空走 supervisor `/factory-reset`，
   需输入「重置」二次确认，新增 `pages/reset-library-sheet.tsx`）。

### iOS 文件保存改用原生桥（2026-11-08，提交 cef390e）

**原实现是错的**：我写了 `webView.downloadDelegate = self` —— `WKWebView` 上**根本没有这个成员**
（delegate 挂在 `WKDownload.delegate`）。CI 的 Swift 编译直接失败。

修正方案：**放弃 WKWebView 下载 API**，改用原生桥 `a2aFile`（`window.webkit.messageHandlers.a2aFile`）：

| 消息 | 用途 |
|---|---|
| `{op:'saveInline', filename, base64}` | JS 已拿到字节（导出 JSON 等小文件），原生落盘后弹分享面板 |
| `{op:'saveRemote', url, method, body, headers, filename}` | 备份这类可能几十 MB 的流，**原生带鉴权头自己请求**，不把整包 base64 塞过桥 |

原生侧只用已验证可用的 API（`URLSession.downloadTask` / `Data(base64Encoded:)` /
`UIActivityViewController`）。浏览器/PWA 仍走 `<a download>`（`lib/download.ts` 里
`fileBridge()` 判断有无桥）。`downloadJson` 因此变成 async，四处调用点已加 `await`。

> 教训：写 Swift 前先查头文件确认 API 存在（本环境无 Xcode，只能靠源码 / WebKit 头文件），
> 不要凭记忆写平台 API。

### 手机端设置补全系列（2026-11-08 起）

配套文档已入库（`docs/mobile-ui/`）：

| 文件 | 内容 |
|---|---|
| `docs/mobile-ui/DESIGN.md` | 手机端 UI 设计体系分析（令牌 / 骨架类 / 组件 / 页面模式 / 实现守则） |
| `docs/mobile-ui/GAP.md` | 桌面 11 分区约 267 条设置 vs 手机端覆盖情况 |
| `docs/mobile-ui/DEVELOPMENT-PLAN.md` | 六个批次的开发方案（契约 / UI / 验收 / 风险） |
| `docs/mobile-ui/contracts/FORWARDING.md` | 转发行为契约（排队/重试/超时/调试/图片压缩/角色兼容/config） |
| `docs/mobile-ui/contracts/CONTENT.md` | 内容与识别契约（提示词/脱敏/客户端识别/models.dev/CORS/机器人校验/宫格） |
| `docs/mobile-ui/contracts/DATA-SYSTEM.md` | 数据系统与更新契约（存储/保留/云同步/系统信息/更新/工具/成长） |

#### 记忆点 · 步骤 0（UI 设计分析）

- 手机端样式是**五层结构**：`theme.css` 的 `--ui-*` → `mobile.css` 的 `--m-*` →
  骨架类（`ui-kit/styles/mobile.css` 的 `.m-page`/`.m-card`/`.m-row`/`.m-tabbar`…）→
  ui-kit 组件（shadcn 对齐）→ `mobile/src/pages/*`。
- 手机端**不引用**桌面端 `ui/css/*`；`mobile.css` 用 `@source` 扫 `ui-kit/src`、`ui-shared`、本工程。
- 关键骨架类：`.m-page`（可加 `.m-fixed` 变固定头+独立滚动）、`.m-sticky`/`.m-body`、
  `.m-section`/`.m-section-head`、`.m-card`/`.m-card-pad`、`.m-row`（52px，t1/t2/chev/val/grow/logo）、
  `.m-rows`（紧凑键值 44px）、`.m-kv`/`.m-kv-cell`、`.m-logo`、`.m-chips`、`.m-tabbar`/`.m-tab`、
  `.m-ptr`（下拉刷新）、`.m-mono`（tabular-nums）。
- 颜色语义固定：**绿=正常、黄=限流/告警、红=失效**；只用 `--m-*`/`--ui-*` 令牌，不写死色值。
- 键盘弹起时 TabBar 整条隐藏（`visualViewport` 覆盖 > 120px 判定），高度让给输入框。
- **本系列实现守则**：新页 `.m-page` + `.m-section` + `.m-card`；设置行用 `.m-logo`+`.m-t1/.m-t2`
  + `Switch`/`.m-chev`；数值表单 `Label`+`Input inputMode='numeric'`+范围说明；开关 `Switch`、
  分段 `SegmentedControl`、多选 `MultiSelect`；危险操作 `confirmDialog`；文案一律 `t()`
  （中文即键、缺译回落中文，**新增文案不必改词典**）；**每个区块独立保存按钮**。

#### 记忆点 · 步骤 0 附：网关契约通则（写任何新模块前先看）

1. **成功信封**：`http.rs:1295` 的 `ok_json()` = `{"success":true,"data":{…}}`，失败
   `{"success":false,"error":"…"}`。手机端 `apiCall()` **已经会解这个信封**（有 `data` 就取出），
   新模块直接 `apiCall<T>(path, {method, body})`，不要自己再包一层。
   ⚠️ 提取契约时一个子代理曾断言「成功体是裸对象」，**那是错的**（已对源码核实）。
2. **路由表在 `server/src/server/http.rs`**，不在 `api/mod.rs`（那只是模块声明）。
3. **鉴权**：本系列全部端点都在 protected 组，要管理员会话或不受限 Key；受限 Key → 403
   `management_access_denied`；没凭证 → 401 `panel_login_required`。**没有端点校验「网关在跑」**。
4. **「省略字段」有四种语义**（最易踩）：
   - 省略/null 都=不改：`queue`/`retry`/`timeouts`/`captcha`/`prompt` 全局项；
   - 省略=不改、**null=清除/回默认**：`promptProviders.<id>`、`promptGateway.<id>`、
     `promptGatewayText.<id>`、`sanitizeFingerprintRules`；
   - **null=400**：`image_compress` 四项（没有删除语义）；
   - **null≠不改且会落盘** ⚠️：`sanitizeFingerprintProviders=null` 被归一成空数组，而空数组
     语义是「应用到**全部**提供商」—— 必须显式区分 `undefined`（不传）与 `[]`（全部）。
   - 另两处特例：`config_api` 的 `apiKey:null` = 删除 Key；`imageCompressEnabled` /
     `developerRoleCompat` 的默认是「开」，且**只有字面 `false` 才算关**（别用 `!== true` 判断）。
5. **写入粒度**：整表替换 = `/api/sanitize` 词表、`/api/client-identification` 的 config、
   `/api/sidebar-layout` 的 layout、`/api/cline/headers` 的 overrides（改一条也要回发全量）；
   稀疏更新 = `/api/prompt` 的三个 map；乐观锁 = client-identification 的 `revision`（不符回 **409**）。
6. **端点真名**（容易记错）：`/api/developer-role-compat`（不是 role-compat）、
   `/api/models/metadata`（不是 model-meta）、`/api/retention` 在 `api/stats_api.rs`
   （不是 config_api.rs）、`/api/zcode/captcha-pool`、`/api/cline/headers`。
7. **数值默认与范围**：`queueMaxWaits` 0–10 默认 **2**（不是 1–10/3）；`queueWaitSeconds` 0–120 默认 0；
   `retryCount` 0–10 默认 3；`retryCrossProviderCount` 0–10 默认 5（语义=换账号次数）；
   `retryIntervalSeconds` 0–300 默认 5；`noRetryStatusCodes` 100–599 ≤50 项默认 `[402]`；
   四项超时 1–3600 默认 30/300/300/300；图片压缩 256–8192/40–95/0–10240 默认 2048/80/512。

#### 记忆点 · 步骤 1（批 1：转发行为设置）

新增文件：
- `mobile/src/api/forwarding.ts` —— 6 组端点的类型化封装 + `changedKeys(draft, baseline)`
  工具（这几个端点都是「省略 = 不改」，只发差异既省一次写盘，也避免用本地默认值覆盖服务端）。
- `mobile/src/pages/ForwardingPage.tsx` —— 一页装六块：排队等待 / 重试 / 上游超时 /
  请求图片压缩 / 兼容与排障（开发者角色兼容 + 调试模式）。

改动文件：`lib/routes.ts`（加 `forwarding`）、`App.tsx`（SCREENS 注册 + import）、
`MorePage.tsx`（「转发链路」组加「转发设置」，图标 `bolt`）。

**实现要点（下次加设置页照这个模子）**
- **数值区块**：每块自己的「保存」按钮（放在 `SectionHead` 的 `action`，文案在保存时切成
  「保存中…」）。整页共用 `busy` + `error` 两个状态，但校验失败只影响当前块。
- **开关区块**：点一下**立即生效**（iOS 设置页习惯），失败**回滚开关**并报错。
- **保存壳**：`const save = async <T,>(section, action, apply) => …` —— 泛型写法别用
  `Promise<never>`；`apply` 用**后端返回值**回填，不做乐观更新。
- 文本草稿与基线**分开存**：draft 用 `string`（允许空串等中间态），保存时 `parseNumber`
  统一校验「整数 + 范围」，越界**报错而不静默改值**；`changedKeys` 比对的是解析后的数值
  与 GET 回来的基线。
- 错误码 chips：输入框回车/逗号成 chip，去重、排序、上限 50、范围 100–599。
- 两个布尔端点的默认值是「开」，解析口径是**只有字面 `false` 才算关**（`!== false`），
  不能用 `!== true`。
- ⚠️ `putDebug` 的响应**只带开关**，回填要**合并**（`{...current, ...saved}`），
  直接替换会把 `count`/`limit` 读数抹掉 —— 这是我写完自查时抓到的 bug。

**契约细节（上游 `server/src/server/api/*.rs`）**
- `GET/PUT /api/queue`：`queueMaxWaits` 0–10 默认 2、`queueWaitSeconds` 0–120 默认 0。
- `GET/PUT /api/retry`：`retryCount` 0–10 默认 3、`retryCrossProviderCount` 0–10 默认 5
  （键名是历史措辞，语义=**换账号次数**）、`retryIntervalSeconds` 0–300 默认 5、
  `noRetryStatusCodes` 100–599 ≤50 项默认 `[402]`。
- `GET/PUT /api/timeouts`：四项 1–3600，默认 30/300/300/300。
- `GET/PUT /api/image-compress`：**四项都不接受 `null`**（传 null 直接 400），
  开关默认开；2048 / 80 / 512。
- `GET/PUT /api/developer-role-compat`：`developerRoleCompat` 必填，默认开。
- `GET/PUT /api/debug`：`debugMode` 必填默认关；只读 `count`/`limit`（上限 500）。

**验证**：`pnpm exec tsc --noEmit` + `pnpm run build` 均 exit 0；`mobile.js` 1,129.33 kB
（批 1 前基线 1,114.25 kB）。

**待真机验收**：改一个数值只发那一个键；越界被前端拦下；关掉调试模式后重进页仍是关的；
切服务器后旧响应不覆盖页面。

#### 记忆点 · 步骤 2a（批 2 上半：系统提示词）

新增：`mobile/src/api/prompt.ts`、`mobile/src/pages/PromptPage.tsx`。
改动：`lib/routes.ts`（加 `prompt`）、`App.tsx`（注册 + import）、`SettingsPage.tsx`
（**新增「转发与内容」组**，放「转发设置」与「系统提示词」两行 —— 原计划说「设置 → 网关组」
但这个手机端设置页**没有网关分组**，所以新起一组）。

页面按网关的三层结构组织：
1. **全局**：`SegmentedControl` 三档（透传 / 自定义 / 追加）+ 正文 `Textarea` + 保存；
   下方只读展示生效来源（`promptSource`: none/builtin/file/inline）、行数、`promptFileError`。
2. **分提供商覆盖**：已配的家列成行（模式 · 来源 · 行数），点进抽屉改模式与正文，
   抽屉里另有「跟随默认」= 发 `promptProviders[id]: null` 把这家的覆盖删掉；「添加」走搜索抽屉。
3. **网关自带提示词**：只列 `promptProviderOptions[].gatewayBlocks` 非空的家，
   行内开关 = `promptGateway[id]`（**键缺失 = 默认装**，所以读的时候要
   `hasOwnProperty` 判断而不是 `=== true`）；「编辑三段」抽屉里三个 `Textarea`
   （identity/stable/dynamic，段名是上游常量 `GatewayBlocks::FIELDS`）+「恢复官方原文」= 发 null。

**契约要点（上游 `api/prompt.rs`）**
- `GET/PUT /api/prompt`，**PUT 响应与 GET 同形**，直接用返回值刷新界面，不必再 GET。
- 写入是**稀疏部分更新**，三个 map 只发要改的那一家：`promptProviders[id]=null` 删这家、
  `promptGateway[id]=null` 回默认、`promptGatewayText[id]=null` 回官方原文。
- `promptText` **空串 = 清除**界面正文（不是「不改」），`null` 才是「不改」。
- 生效口径：只有 `custom`/`append` 才读文件；正文非空时以正文为准（`inline`），否则读文件
  （`file`），读不到回落内置（`builtin`）；`passthrough` 下 `promptSource` 恒为 `none`。
- 三段必须**各自成块**（上游按结构校验，并成一段会报错）；动态段支持占位符
  `{cwd} {platform} {shell} {os_version} {git} {provider} {model}`。
- 降级状态**不落盘**（进程内），`clearDegrade: true` 是独立动作，与配置写入互不影响。

**手机端取舍**：`promptFile`（提示词文件路径）**不可编辑**，只读展示 —— 那是桌面端指向本地
文件的能力，手机上没有对应概念。

**验证**：`tsc --noEmit` + `build` 均 exit 0；`mobile.js` 1,142.94 kB。

#### 记忆点 · 步骤 2b（批 2 下半：指纹脱敏）

新增：`mobile/src/api/sanitize.ts`、`mobile/src/pages/SanitizePage.tsx`。
改动：`lib/routes.ts`（加 `sanitize`）、`App.tsx`（注册 + import）、`SettingsPage.tsx`
（「转发与内容」组补第三行「指纹脱敏」）。

**★ 这块最危险的地方：三个键的「省略 / null / 空数组」语义互不相同**

| 键 | 省略 | `null` | `[]` |
|---|---|---|---|
| `sanitizeBlacklistFingerprints` | 不改 | 类型错误 400 | — |
| `sanitizeFingerprintRules` | **不改** | **恢复内置词表** | 空词表 |
| `sanitizeFingerprintProviders` | **不改** | **清空 → 等于全部提供商**（会落盘） | 全部提供商 |

所以：**只想改开关时，body 里绝不能出现 `sanitizeFingerprintProviders`** —— 传 `null`
不是「不改」，而是「应用到全部提供商」并立刻落盘（上游 `sanitize.rs:92-125`）。
代码里用「键不存在」表达不改，别用 null 占位。

**其他契约要点**
- 词表是**整表替换**：改一条也要把完整数组发回去 → 界面上的增/删/改都走
  `saveRules(整个数组)` 一条路径。
- 规则 8 个字段：`id`（1–64，`[A-Za-z0-9_-]`，词表内唯一）、`name`（1–128）、
  `enabled`（默认 true）、`matchType`（`literal`/`regex`，默认 literal）、`pattern`
  （必填 ≤4096）、`replacement`（默认空串 ≤4096）、`repeat`（默认 false）、`roles`（默认空数组）。
- **`repeat` 只允许用在「正则匹配 + 替换内容为空」的删除规则上**，界面上按这个条件
  把开关置灰，切换匹配方式或填了替换内容时自动复位。
- `roles` 空数组 = 沿用旧规则的全字段行为；指定角色时只改对应消息的正文。
- `GET` 回 `defaultRules`（内置全量）/`customRules`（true = 当前是自定义词表）/
  `providerOptions`（含 `count`/`category`/`source`）/`roleOptions`/`limits`。
- `[]` 的语义是「全部提供商，**包含以后新增的插件与自定义家**」，界面上必须说清（我
  在「应用提供商」分段里直接写了这句）。
- 替换文本**不解释 `$` 捕获组**（上游 `regex::NoExpand`）—— 界面注明了这点，免得用户
  以为能写 `$1`。

**本地校验**：`validateRule()` 与上游 `RuleSet::compile` 同口径（id 格式与唯一性、
名称/匹配/替换长度、repeat 组合、正则语法用 `new RegExp` 试编译），先在本地拦下，
用户不必为一眼能看出的错误等一次往返。

**顺手补的**：删除规则加 `confirmDialog`（词表整表替换，删了没有撤销）。

**验证**：`tsc --noEmit` + `build` 均 exit 0；`mobile.js` 1,154.68 kB。

#### 记忆点 · 步骤 3（批 3：连接与安全 + 数据与存储）

新增：`api/security.ts`（CORS + 机器人校验）、`api/storage.ts`（存储快照 + 数据保留）、
`pages/connection-security-sheet.tsx`、`pages/data-storage-sheet.tsx`。
改动：`SettingsPage.tsx` 新增 **「安全与数据」分组**（两行：连接与安全 / 数据与存储）。

**这两个开关的作用面必须写清，否则用户会误解**：
- **CORS**（`cors.rs`）只管**网关面 `/v1/*`**：开着预检直接 204 并下发
  `Access-Control-Allow-*`（来源 `*`）；关着（默认）预检被 API Key 中间件 401 拒掉。
  **面板路由 `/api/*` 不受它影响**，一直是无条件 CORS。
- **机器人校验**（`captcha.rs`）只管**面板登录 / 注册**的 ALTCHA，与 `/v1/*` 的 Key
  鉴权无关。两端独立：**桌面壳读 `captchaDesktop`，网页/headless 读 `captchaWeb`**；
  GET 回的 `localPanel` 是**只读**的进程形态（true=桌面壳），界面据此标出「你现在用的
  这一端读的是哪个开关」。PUT 是分端部分更新，只发要改的那一端（两端都不给会 400）。
- 两个开关都做成「点一下立即生效 + 失败回滚」，因为它们本身就是安全开关，多一步保存
  容易让人以为已经改了。

**数据保留（`api/stats_api.rs`，不是 config_api.rs）**
- `GET/PUT /api/retention`，五个键：`logRetentionDays` 1–99999 默认 30、
  `logRetentionCount` 1–100000000 默认 10000、`requestLogRetentionDays` 默认 99999、
  `requestLogRetentionCount` 默认 1000000、`dailyAggregateRetentionDays` 默认 99999。
- ⚠️ **PUT 之后网关立刻裁剪**（`request_stats().prune()` + `LogStore::prune()`），超出新上限
  的历史记录当场删除且不可恢复 → 保存前 `confirmDialog` 列出「哪一项改成多少」，
  确认按钮文案是「裁剪并保存」。
- PUT 允许部分字段（`null` = 该项不动）；空对象 `{}` 不写盘、不裁剪。

**存储用量（`GET /api/storage`，只读）**
- `configDir` + `database{file, bytes, available, accounts, logs, requests, dailyDays,
  debug, downstreamRaw, upstreamRaw}`；`debug` 与 `upstreamRaw` 同值（兼容字段）。
- **没有写路由**（旧 relocate / progress 已删），所以界面不做任何「清理」按钮 ——
  清理靠数据保留。
- `available === false` 时各计数回落 0，界面显示「库不可用」而不是伪造读数。

**验证**：`tsc --noEmit` + `build` 均 exit 0；`mobile.js` 1,165.47 kB。

**观察到的事实**：CI 的 macOS runner 排队很久（批 1 的那次运行在推送后 20 分钟仍未开始
编译），所以**推送与 CI 并行推进**——每批推完立刻接着做下一批，等运行结束后再统一核对。

#### 记忆点 · 步骤 4（批 4：模型元数据 + 插件出站设置）

新增：`api/model-metadata.ts`、`api/plugin-settings.ts`、
`pages/model-metadata-sheet.tsx`、`pages/plugin-settings-sheet.tsx`。
改动：`SettingsPage.tsx` —— 「转发与内容」补「模型元数据（models.dev）」，
「接入」补「插件出站设置」。

**① models.dev 元数据（`api/model_meta.rs`）**
- `GET/PUT /api/models/metadata` → `{source, updatedAt, count, modelsDevEnabled}`；
  `source` 三个字面值 `builtin`（内嵌快照）/`cache`（库里缓存）/`network`（本次拉到）。
- PUT **必须**含 `modelsDevEnabled`；默认**开启**（只有字面 `false` 算关）。
- **关掉只停联网刷新**：已装载的索引继续用（内存与库里都不清）—— 界面必须写这句，
  否则用户会以为「关掉就没元数据」。
- `POST /api/models/metadata/refresh` **无请求体、永远 2xx**，成败看
  `result.status`（`refreshed`/`skipped`/`failed`），`skipped` 可能带 `retryAt`；
  **手动刷新有 24 小时间隔**，冷却中回 `skipped` + `retryAt` → 界面要把这个时刻显示出来，
  否则用户只会看到「没反应」。

**② 插件出站设置（ZCode 版本号 / 验证码令牌池 / Cline 伪装头）**
- **按插件申报显示**：`GET /api/plugins` 的 `adminPanels` 含 `captcha_pool` /
  `upstream_headers` 才渲染对应区块（与桌面端 `settings-page.tsx` 同一口径）。
  插件读不到时按「没有面板」处理（隐藏），别画空面板。ZCode 版本号不属申报面板，总是显示。
- ZCode 版本号（`zcode_version.rs`）：`{version, envOverride}`；校验「≤32 字符、
  `[0-9A-Za-z._-]`、**首字符必须数字**」，**空串合法 = 清空覆盖**回落插件内置默认值；
  环境变量 `ZCODE_APP_VERSION` 优先级更高，非空时界面上的值不生效（要提示）。
- 验证码令牌池（`zcode_captcha_pool.rs`）：三个整数 1–10 默认 3 / 1000–30000 默认 2500 /
  1–5 默认 1；**只认 JSON 数字**（字符串 `"2"` 会 400），所以前端要 `Number()` 后再发。
- Cline 伪装头（`cline_headers.rs`）：`{overrides, defaults, effective}`，PUT 是
  **整体替换**；≤64 条、头名 ≤128 且要合法、头值 ≤4096；固定头
  `Authorization`/`Content-Type`/`Accept`/`X-Task-ID`（大小写不敏感）一律 400。
  **空串值 = 这个头不发；删掉一行 = 回落默认值** —— 这两句语义写进了界面说明。
  保存前 `confirmDialog`（整体替换会丢掉没列出来的头）。

**③ 推迟：宫格布局（`/api/sidebar-layout`）**
- 契约已拿到：`GET/PUT {layout}`，**整份替换**，后端只校验顶层是对象；`null`/缺键 = 恢复默认；
  存在 `kv` 表的 `sidebarLayout` 键，且**在云同步范围内**。
- **为什么这轮不做**：这个键**与桌面面板共用**，而桌面那份布局的形状由 `ui/sidebar-layout.js`
  的 MENUS 表定义（宽/窄/分组是桌面概念，插件菜单键还是运行期才有的）。方案里本来就写明
  「实施前先 GET 看一次真实结构再定 schema」—— 我这边拿不到真机样本，**凭猜写进去可能把
  桌面面板的布局改坏**（用户现在还在用桌面面板）。它在本系列里是 P3，不值得冒这个险。
- **将来要做的安全做法**：GET 取回整份对象 → **原样保留所有未知键** → 只在里面加/改一个
  `mobileGrid` 子键 → 整份 PUT 回去；**绝不发 `null` 或空对象**（那会把桌面布局重置）。
  另外要把 `MorePage` 的固定三组改成按该子键渲染。

**验证**：`tsc --noEmit` + `build` 均 exit 0；`mobile.js` 1,180.32 kB。

#### 记忆点 · 步骤 5（批 5：更新出网代理 + 版本信息补全 + 反馈入口）

新增：`api/update-proxy.ts`、`pages/update-proxy-sheet.tsx`。
改动：`SettingsPage.tsx`（软件更新下面加「更新出网代理」行 + 新增「反馈与需求」分组的三行）、
`components/SystemInfoSheet.tsx`（**大幅补全**）。

**① 更新出网代理（`api/update.rs` 的 `updateProxy`）**
- `GET/POST /api/update/proxy`，键 `proxy`；空串 = 清除。
- ⚠️ 容易混：它只管**检查更新 / 下载更新包**的出网；网关**转发上游**走的是**账号级**
  「出网代理」（在添加账号那里配）。界面上写清了这句。
- 本地校验：允许 `http/https/socks5` 前缀，或直接 `主机:端口`。

**② 版本信息补全（`api/system_info.rs` 的六个块）**
原来 SystemInfoSheet 只用了 app/runtime/deployment/security/stats 的一小部分，现在补齐：
- **开关读数**（`features`）：调试模式 / 指纹脱敏 / CORS / 开发者角色兼容 / 保活换行丢弃 /
  自动续写（带轮数）/ models.dev / 面板登录人机验证 / 关注 beta —— 「改完设置回来对一眼」用。
- **安全与计数**：管理员已注册 / 面板登录 / 未注册闸门 / 拒绝无 Key / 允许无 Key 裸跑 /
  GitHub 令牌（`githubTokenOrigin` 为 `env` 时显示「来自环境变量」）/ 更新出网代理 /
  账号与限流中 / 在途与累计请求 / 事件日志 / 待迁移旧数据。
- **许可与源码**：开源许可 / 版权 / 源代码 / 数据库 schema 与库中版本（`schemaVersion`
  / `dbSchemaVersion`）。
- **运行细节**：PID / 启动时间 / WebView 内核 / 容器内运行 / 开发构建 / 详细日志。
- **更新能力**（`deployment.updateCapability`）：mode / packageKind / installSupported / reason。
- ⚠️ 布尔读数用 `flag()` 助手，口径是 **`=== false` 才算关**（后端多项默认开），
  不能用 `=== true`——否则取不到值时会把「默认开」显示成「关」。

**③ 反馈入口（无端点，纯外链）**
桌面端「反馈与需求」的三个 GitHub issue 模板（`bug_report.yml` / `feature_request.yml` /
`provider_request.yml`），手机端用 `lib/community.ts` 的 `openExternal` 打开
（APK 内同窗跳转、PWA 新标签页）。

**④ 顺带修的一个 CI 脆弱点**（提交 `8b42e16`，与设置无关但影响出包）
批 1 那次运行里 **Plugins 作业失败**了，原因是 `scripts/fetch-official-packs.py`
下载官方骨架包时 GitHub CDN 返回 **504 Gateway Time-out**，而那一步没有重试 ——
结果插件作业整个挂掉、deb 丢掉预置插件包（体积从 21MB 掉回 12.8MB）。
已给 `download()` 加退避重试（4 次，2/6/14 秒），并改成**先写 `.part` 再改名**，
避免半个 zip 被后面当成好文件用。

**验证**：`tsc --noEmit` + `build` 均 exit 0；`mobile.js` 1,188.43 kB。

#### 记忆点 · 步骤 6（批 6：云同步；局域网访问与 cc-switch 导入推迟）

新增：`api/cloud-sync.ts`、`pages/cloud-sync-sheet.tsx`。
改动：`SettingsPage.tsx` —— 「安全与数据」组补「云同步」行。

**云同步（`api/cloud_sync.rs`，7 条端点）**
- `GET/PUT /api/cloud-sync`、`POST /test`、`GET /remote`、`POST /upload`、`POST /download`、
  `POST /import-key`。
- **PUT 是整份表单**（不是 patch），缺字段按空串；**密码类字段空串 = 沿用库里那份**
  （所以密码框留空保存不会清掉已存密码，不需要塞伪占位值）。
- GET 只回 `hasPassword` / `hasSecretKey` / `hasSyncPassword` 布尔，**不回显密码**；
  `syncPassword` 在保存时必填 → 前端在「首次配置且没填」时提前拦下。
- 服务商二选一：WebDAV 要 `baseUrl` + `username`；S3 要 `region` + `bucket` + `accessKeyId`
  （+ 可选的 `endpoint`）。另有 `remoteRoot` / `profile` 两个归类字段。
- **三种操作风险不同，界面按等级处理**：测试连接 / 读取远端 = 只读出网，随便点；
  上传 = `confirmDialog`（覆盖远端）；**从云端恢复 = 强确认**（整体替换本机账号与 Key，
  网关替换前会自动备份到 `backups/`）。
- **409 = 远端带独立密钥而本机没有** → 界面引导去下面的「导入密钥」填同步密码。
- 与「整库备份」的分工写进了界面说明：备份是**全库**快照、手动换文件；云同步只带
  **账号与网关 Key**，可自动、可跨设备。
- `status` 各字段是 `Option`，缺省时**键不出现**，所以按可选处理。

**推迟两项（都不是遗漏，是明确不在这轮做）**
1. **局域网访问** —— 要改 Rust：supervisor 现在硬编码 `.env("AGENT2API_HOST", "127.0.0.1")`，
   开放后同网段设备可访问网关。这是**安全取舍**，需要用户拍板；顺带端口可配置也在这条链路上。
2. **cc-switch 导入**（`GET /api/import/cc-switch`）—— 它读的是**网关主机**上的 cc-switch 库；
   iOS 上网关跑在手机里，根本没有那份数据（`available:false` 也是 200）。手机端已有
   「粘贴导入凭证」这条路，所以它在本项目里价值很低，等真有桌面网关场景再说。

**验证**：`tsc --noEmit` + `build` 均 exit 0；`mobile.js` 1,201.61 kB。

#### 批次进度

| 批次 | 内容 | 状态 |
|---|---|---|
| 步骤 0 | UI 设计分析 + 契约提取 + 方案 | **已完成**（`67fd625`） |
| 批 1 | 转发行为（排队/重试/超时/图片压缩/角色兼容/调试模式） | **已完成**（`b9d8206`） |
| 批 2a | 系统提示词（全局 / 分提供商 / 网关三段） | **已完成**（`2324be6`） |
| 批 2b | 指纹脱敏（开关 / 应用提供商 / 词表 CRUD） | **已完成**（`f54e0a2`） |
| 批 3 | 连接与安全 + 数据与存储 | **已完成**（`48c88bc`） |
| 批 4 | models.dev 元数据 + 插件出站设置 | **已完成**（`fc1b5b9`）；宫格布局推迟 |
| 批 5 | 更新出网代理 + 版本信息补全 + 反馈入口 | **已完成**（`709e1f2`） |
| 批 6 | 云同步 | **已完成**（本次）；局域网访问 / cc-switch 推迟 |

**全部批次已完成**（除三项明确推迟：宫格布局、局域网访问、cc-switch 导入）。

#### 记忆点 · 步骤 7（收尾：静态自检 + CI 闸门）

全部批次推完后做了一轮**静态自检**（这些文件没法在本机跑起来，只能查能查的）：

| 检查项 | 方法 | 结果 |
|---|---|---|
| 端点路径拼错 | 把 9 个新 api 模块里的 `/api/...` 与三份契约文档（源自上游 Rust 源码）逐个比对 | **25/25 全部对得上，0 处拼错** |
| 图标名无效 | 扫描所有 `<Icon name='x'>` 与 `Icon.tsx` 的 `PATHS` 表比对 | 全部有效（拼错的话渲染成空白，**编译不报错**） |
| `t()` 占位符缺参 | 括号配对扫描 `t('…{x}…', {…})`，**同时认简写 `{ x }`** | 0 处不匹配 |
| 跳转目标不存在 | `store.push/go('x')` + MorePage 宫格条目 vs `SCREEN_IDS` | 26 处跳转 + 16 个条目全部有效（拼错会**静默回首页**） |
| `ApiError.status` | 云同步靠它判 409 | 存在 ✅ |
| `startedAt` 单位 | 与桌面端 `formatTime` 比对 | 两端都按**毫秒** ✅ |

**固化成 CI 闸门**（提交 `21e81d8`）：`scripts/check-mobile-ui.py` + workflow 步骤
「校验手机端自洽（图标 / i18n 参数 / 跳转 / 端点拼写）」，放在手机 UI 构建之前。
它抓的就是上面那四类 **TypeScript 一个都不拦** 的问题。

⚠️ 写这个检查器时它自己先有两个 bug，值得记下来：最初把 MorePage 的 `{ id: 'x' }`
既当成**图标名**、又在**所有文件**里当成跳转目标 —— 于是报了 13 个假阳性。
正确口径：`{ id }` 只在 `MorePage.tsx` 里是路由；其它文件里的 `{ id }` 是业务数据。

**给未来的命令行**（都在仓库里，不需要我这边的工作目录）：
```bash
python3 scripts/check-mobile-ui.py            # 手机端自洽（图标/i18n/跳转/端点）
git ls-files '*.sh' | xargs -n1 bash -n       # 等价于 CI 的脚本语法闸门
```

#### 记忆点 · 步骤 8（CI 事故：官方骨架包 CDN 整段 504）

**现象**：`Plugins (iOS packs)` 作业在「下载官方骨架包」这步失败，
`urllib.error.HTTPError: HTTP Error 504: Gateway Time-out`。
后果是 deb 丢掉**预置插件包**（体积 21.3MB → 12.9MB），插件作业还连带把
**网页包**的打包步骤一起跳过了（那是同一个作业里的后续步骤）。

**诊断过程（记住这个判据）**：先加重试（4 次 / 2-6-14 秒）**没用** —— 仍然 4/4 都 504。
于是本机直接 HEAD 那个资产 URL 对照：

| 源 | 结果 |
|---|---|
| 直连 `github.com/.../releases/download/v3.4.2/...zip` | **504** |
| `https://ghfast.top/` 前缀 | 504 |
| `https://gh-proxy.com/` 前缀 | 500 |

三个同时失败 ⇒ **上游 CDN 全局故障**，不是 runner、也不是代码问题。
（约 1 小时后自行恢复：HEAD 200、len=11458055。）

**四层修复（提交 `8b42e16` → `1d1b748` → `17e9165`）**：
1. 退避重试（4 次）；
2. **加速源回退**：直连 → `ghfast.top` → `gh-proxy.com`（每个源各试 2 次）——
   与工作流里 `clone_upstream` 已经在用的两个源保持一致；
3. **`--optional` + 步骤门控**：骨架包只是「省得手写 pack.json」的优化，拉不到就
   警告并 `SKELETON=missing`，**跳过打包而不是中断作业** —— 否则主包骨架失败会
   连带跳过网页包的打包，白丢一批本来能出的包；
4. **`actions/cache@v4` 缓存 `.cache/official`**：脚本改成「已有文件就跳过下载」，
   于是「成功下载的那一次」被缓存住，以后再遇到整段 504 也能出带预置包的 deb。

**教训**：这类「上游资源不可用」的失败，先分清是**瞬时**还是**整段**——
重试只对前者有效。判据很简单：在**另一台机器**上直接打那个 URL。

**本轮的交付物**：`ios-20261108-b246` 的 deb —— 含**全部六个批次**的 UI，
已验证 `mobile.js` 与本地构建**逐字节一致**（1,201,608 字节 / `6062d221…`），
supervisor 里 `/factory-reset`、`/start`、`/stop`、`/status`、`/heartbeat` 都在；
**没有预置插件包**（0 个 pack.json）。CDN 恢复后已触发带包重建（run 252）。

#### 记忆点 · 步骤 9（宫格显隐排序 —— 原计划推迟项，用本地偏好解掉）

**先纠正一个判断**：之前我把「宫格布局」推迟，理由是「`sidebarLayout` 键与桌面共用、
凭猜写进去可能改坏桌面面板」。后来去读了桌面的 `ui-islands/src/islands/sidebar-pane.tsx`，
它把手写类型放在文件头，形状是明确的：

```ts
type LayoutGroup = { id: string; label: string; custom: boolean; hidden: boolean; items: string[] }
type Layout = { groups: LayoutGroup[]; hidden: string[] }
```

`items` 是**桌面菜单的 key**（由经典脚本 `ui/sidebar-layout.js` 的 `MENUS` 表定义，
接口挂在 `window.wbSidebarLayout`，读写走 `/api/sidebar-layout` + 本地 localStorage 缓存）。

**于是「用桌面的形状 + 手机的 id」和「在同一个对象里塞 `mobileGrid` 子键」两条路都不好**：
前者会让桌面侧边栏出现认不出的条目，后者会被桌面 `normalizeLayout()` 重建对象时丢掉
（手机这边的偏好就会莫名其妙被重置）。

**最终做法（提交见下）**：宫格显隐排序是**本机界面偏好**，与主题、语言同性质，
所以存 localStorage（`agent2api.mobile.gridLayout`，与既有 `agent2api.mobile.*` 命名一致），
**完全不碰服务端那个共用键**。代价是不跨设备同步 —— 对手机上的菜单布局偏好是可接受的。

新增：`lib/grid-layout.ts`（纯函数：读/写/重排/显隐/恢复默认）、
`pages/grid-layout-sheet.tsx`（分组内 ↑↓ 排序 + 逐条显隐开关 + 恢复默认）。
改动：`MorePage.tsx`（分组加稳定 `id`、按偏好渲染、页头加一个「自定义宫格」按钮）、
`Icon.tsx`（补 `down`，原来只有 `up`）。

**取舍记录**：只做**条目级**显隐与**组内**排序，不做分组级显隐与自建分组（那是桌面
侧边栏才需要的层级）；「设置」条目标 `fixed` 不可隐藏 —— 否则用户把入口藏没了就找不回来。

**★ 自检工具第一次真正发挥作用**：新代码写完跑 `scripts/check-mobile-ui.py`，
它直接抓出两个**编译不报错**的问题：
1. `Icon` 里没有 `down` —— 「下移」按钮会渲染成空白（补了 path）；
2. 工具**自己**的误报：它把 MorePage 的分组 id（`{ id: 'system', title: … }`）
   当成了跳转目标。把条目正则收紧成 `\{ id: 'x',\s*label:` 之后，分组与条目就分开了
   （条目必有 `label`，分组必有 `title`）。

**验证**：`tsc --noEmit` + `build` 均 exit 0；`scripts/check-mobile-ui.py` exit 0；
`mobile.js` 1,206.11 kB。

#### 记忆点 · 步骤 10（云同步补齐 —— 一个**方法层面**的漏洞）

**用户反馈**：设置 → 数据 → 云同步 里没有桌面版那几个预设（坚果云 / Nextcloud /
群晖 NAS / 自定义）。核对后**确实缺**，而且不止预设。

**根因（这条最值得记）**：我这一路的方法是「从上游 Rust 抠接口契约 → 按字段实现」。
但**纯前端的交互增强根本不在契约里** —— 预设表、提示文案、快捷填充、脏值守卫、
校验规则都属于这一类。契约驱动的方法会**系统性地看不见它们**：接口齐了、字段全了、
`tsc` 也过了，用户一打开却发现「桌面上有的东西这里没有」。

**修掉的六处**（`lib/cloud-sync-presets.ts` 新增 + `pages/cloud-sync-sheet.tsx`）：

| # | 缺的东西 | 关键点 |
|---|---|---|
| 1 | **WebDAV 预设**：坚果云 / Nextcloud / 群晖 NAS / 自定义 | 每项带 `baseUrl` 模板 + 说明（坚果云要用第三方应用密码、群晖要先开 WebDAV 服务） |
| 2 | **S3 预设**：Amazon S3 / Cloudflare R2 / MinIO / 阿里云 OSS / 腾讯云 COS / 华为云 OBS / 自定义 | 每项带 `regionPlaceholder`（也用作 Region 输入框的 placeholder）+ Endpoint 填法说明 |
| 3 | 默认值 | `remoteRoot='agent2api-sync'`、`profile='default'` —— 我原来默认空串，空串语义是「根目录 / 无档案名」 |
| 4 | **同步范围写错了** | 我原来写「只有账号与网关 Key」。实际还同步**网关配置、自定义提供商、Agent 配置、代理池/订阅、签到与余额记录**；不在范围内的是事件日志、请求明细、调试报文、面板登录态 |
| 5 | **`dirty` 守卫** | 有未保存改动时，上传/下载会被拒 —— 那两个动作走的是**已保存**的配置，不是屏幕上这份。（顺带把 7 处直接改表单的地方统一收进 `patch()`，否则 `dirty` 漏跟踪） |
| 6 | 远端路径 + 生成时间 | 状态里显示 `remotePath`，远端清单里显示快照 `createdAt` |

**顺带补的两处细节**：下载成功后把**安全备份的位置**说出来（`safetyBackup`，
用户想知道「万一覆盖错了能不能回去」）；409 的文案写全「怎么办」——
笼统说「需要密钥」会让人在本机反复试同步密码，而密钥根本不在这边。

**预设的「当前选中哪个」怎么定**：不是配置，是**从已填字段反推**——
WebDAV 按 `baseUrl` 的 **host** 匹配（用户会在模板后接自己的目录，前缀比法会漏），
S3 按 `region` 与预设占位区域匹配；匹配不上就是「自定义」。这样用户手填别的地址时，
下拉不会谎报成某个预设。

**★ 一个我自己的误判，记下来**：我先用关键词扫桌面源码找同类遗漏，得出
「版本信息缺『复制全部信息』」。**这是错的** —— 手机端 `SystemInfoSheet` 里
`copyAll()` 早就实现了（产出「本机 + 网关」两段纯文本）。我那次扫描搜的是
`clipboard` / `toPlainText`，而实现用的是 `components/ui` 的 `copyText`。
**教训：关键词扫描只能用来「找出候选」，不能用来「判定缺失」**；判定必须看实现。

**于是换了能穷尽的办法**：把桌面前端所有 `t('…')` 文案与手机端做**集合差**。
桌面设置类文案 405 条，手机端缺 248 条 —— 但逐条看下来，绝大多数是
① 错误/提示文案的措辞差异、② 桌面独有概念（托盘最小化、窗口、面板登录重置、
账号导入导出）。**没有第二处功能缺口。**

其中一条还牵出一个**需要核实的功能疑点**：桌面提示词那边的
「（已存一份正文，{n} 行；切成「替换 / 追加」后生效）」看起来像「每种模式各存一份正文」。
去查契约：`PUT /api/prompt` 只有**单一 `promptText`**（外加 `promptMode` / `promptFile` /
分提供商覆盖）—— 那句话是说**正文在「直通」模式下不生效**。所以手机端的实现是对的，
不是缺口。**记下来是因为：文案读起来像功能差异时，要去契约/源码求证，别照着猜。**

**验证**：`tsc --noEmit` + `build` 均 exit 0；`check-mobile-ui.py` exit 0；`mobile.js` 1,211.24 kB。

#### 记忆点 · 步骤 11（路由板块 R2：请求回放 + 链路追踪）

**用户反馈**：「路由这边整个路由配置、请求回放等很多功能全部缺失」。**成立** —— 我此前
只做了 2/12 项。根因是我写在 `RoutingPage.tsx` 里的那句错误判断（详见
`docs/mobile-ui/ROUTING-GAP.md`）：把「桌面端 41 个文件」当成了「都是壳本地事务」，
**没去查网关自己的路由表**。判据一直现成：已发布二进制里就有全部路由字符串。

**新增**：`api/routing-flow.ts`、`lib/routing-trace.ts`、`pages/routing-replay.tsx`、
`pages/routing-trace-sheet.tsx`；`RoutingPage.tsx` 加了顶层模式切换
「策略与预演 / 请求回放」（对齐桌面端的 `mode: 'config' | 'replay'`）。

**★ 三个容易搞错的点，都是查源码才定下来的**

1. **请求列表不走 `/api/routing/replays`**，而是 `GET /api/routing/flow` 加
   `detail=requests`（桌面 `routing-request-list.tsx` 就是这么拉的）；模型候选是同一个
   端点加 `detail=models`。`/replays` 与 `/trace`（带 `status`/`startDate`/`endDate`）
   是另一处「请求日志」形态的入口，不在回放链路上。**光看端点名会选错。**
2. **单次请求明细是 `GET /api/routing/trace/request?id=&ts=`**，`ts` 必须一起带 ——
   `id` 在库里不是唯一键（同一请求重放会复用 id）。
3. **判据本身有口径**，「进行中」是 `status === 0 && error == null`，「成功」还要求
   `error == null`（有些上游回 200 但 body 里是错误）。所以 `lib/routing-trace.ts`
   是从桌面 `routing-trace-model.ts` **逐条对齐**搬过来的，不是各写一份 ——
   各写一份就会出现「手机说成功、桌面说失败」。

**保留下来两个桌面端的好设计**：
- 没有 `attemptDetails` 的老记录**回退成一条推断尝试**（用请求记录里的承载账号），
  并明确标注「未保存完整尝试明细」；直接留空会让用户以为请求没发生过。
- 候选队列快照里**已尝试的账号仍然留着**（尝试明细另记），否则单候选失败时会出现
  「1 个候选但列表为空」的自相矛盾。

**手机端刻意收窄的地方**：桌面筛选有客户端/提供商/账号/会话/活动状态等七八个维度，
手机只留四个（时间窗 / 范围 / 模型 / 搜索）—— 大屏用来交叉分析，挤进手机只会
哪一个都用不上。桌面是「左列表 + 右详情」两栏，手机是一屏列表 + 详情抽屉。

**验证**：`tsc --noEmit` + `build` 均 exit 0；`check-mobile-ui.py` exit 0；`mobile.js` 1,226.05 kB。

⚠️ **待真机核对**：查询参数名（`minutes` `scope` `detail` `offset` `limit` `search` `model`
`id` `ts`）来自桌面壳调用签名 + 二进制字符串交叉验证，属**强推断**；首次在真机上打开
回放页时若报错，先核对这几个参数名。

#### 记忆点 · 步骤 12（路由板块 R1：工作空间）

新增 `pages/routing-workspace.tsx`；`RoutingPage.tsx` 的模式变成三个：
**策略与预演 / 工作空间 / 请求回放**（对齐桌面端的 config / live / replay）。

数据源：`GET /api/routing/workspace?model=` —— **不传 `model` 就是全局**（桌面端
`const globalAccounts = !scope` 同一约定）。

**★ 参与度判据是照抄的，不是自创的**（`routing-config-panel.tsx`）：
```
全局（未选模型）：account.enabled !== false 即参与；
按模型：providerIncluded(id) && !excludedAccounts.includes(account.id)
  providerIncluded(id) = (providerScope === 'all' || providers.includes(id)) && !disabledProviders.includes(id)
```
**这条必须逐字对齐** —— 判据一旦分叉，手机显示「参与」而网关不选它，用户会以为坏了。
所以我把判据写成注释贴在函数上方，改的时候能看见出处。

这一屏装了三件 `/api/routing/queue` 给不了的东西：
1. **谁被限额**（`accountStates`：`limitedModels` + `resetAt`）—— 单看排队顺序看不出「为什么这个账号一直不出现」；
2. **账号健康状况**（`hasCredentials === false` / `needsRelogin` / `isGuest` / `available === false`）——
   `hasCredentials === false` 那种账号在选路里是**静默跳过**的，不标出来用户看不出为什么发不出去；
3. **入驻情况与实时指标**（`providers[].available === false` →「模型绑定不可用」、
   `metrics.running` / `todayRequests` / `todaySuccessRate` / `averageDurationMs`、
   每账号在途连接数、`stickyCount`）。

**判空口径**：`metrics` 用 `available === false` 区分「旧版网关没这个能力」与
「确实是 0」——两者都显示 0 会让用户误判。同样 `todaySuccessRate == null` 显示
「未记录」而不是 0%。

**刻意只读**：这一屏不放「启用账号」开关（桌面端有）——账号启用是**账号页**的事，
路由参与范围是「策略与预演」保存的事，混在一起会让用户搞不清哪个改动何时生效。
页尾写明了这句分工。

**验证**：`tsc --noEmit` + `build` 均 exit 0；`check-mobile-ui.py` exit 0；`mobile.js` 1,235.81 kB。

#### 记忆点 · 步骤 13（路由 R3 + **修掉一个已发布的静默 bug**）

**★ 先说 bug：我的「策略与预演」半边从上线起就是坏的。**

做 R3 时顺手核对桌面端粘性档位，发现它写的是 `'turn'`，而我的类型是
`'off' | 'on'` —— **`on` 这个值根本不存在**。于是去读本地那份 Rust 源码
（`upstream-v3.4.2/routing_api.rs`），才发现更严重的问题：

`PUT /api/routing` 读的是 `config::KEY_ROUTING_*` 这组常量，**形状是**：

```
routingStrategy · routingSticky · routingFailoverBackoff · routingSink
routingBreakerEnabled · routingBreakerThreshold · routingBreakerTimeoutSeconds
routingBreakerSuccessThreshold
```

而我写的是 `strategy` / `sticky` / `failoverBackoff` / `breakerTimeout` / `breakerSuccess`。
后端对**不认识的键静默忽略**（`RoutingPatch::default()` 全 None）—— 所以：

- 保存「成功」但什么都没改（前端还弹了「已保存」）；
- 读回来没有对应字段可填，下拉是空的；
- `failoverBackoff` 我当**毫秒数**渲染，实际它是**布尔开关**（「失败退避」）。
  按毫秒发一个数字，后端会回 400「必须是布尔值」。

**核对方法（可复用）**：把已发布二进制 `agent2api-server` 抠出来做字符串比对——
`routingStrategy` 等 8 个键**全在**，而 `failoverBackoff` / `breakerTimeout` /
`breakerSuccess` **全都不在**。加上源码里的校验分支，两条独立证据锁定。

**改对了什么**（`api/routing.ts` 重写 + `RoutingPage` 策略卡片重写）：
- 键名换成 8 个 `routing*`；
- 粘性档位 `auto / session / turn / off`（不是 `on`），各带说明；
  桌面端的档位说明我也搬过来了（`auto` = 五分钟没往来即释放、客户端会话标识优先、
  内容哈希兜底；`session` = 最长六小时）；
- **补上原本完全缺失的「自愈保护」**：失败退避 / 限流垫底 / 熔断保护三个开关，
  熔断开启后才是三个数值（阈值 1~20、时长 10~600 秒、恢复阈值 1~10）；
- 保存改成**只发变过的键**：后端既然静默忽略未知键，全量发反而会掩盖键名写错
  （这次就是被掩盖了）；
- 策略/粘性用 `SegmentedControl`（与桌面端同形态），标签也照抄
  （顺序优先 / 负载均衡 / 家内轮询）。

**一个必须写进提示的副作用**：粘性档位**一变**，后端会 `clear_route_sticky(None, None)`
清空全部会话绑定。所以保存后的 toast 我改成「粘性档位变了，现有会话绑定已被解除」，
而不是笼统的「下个请求生效」—— 否则用户会以为绑定还在。

**R3 会话粘滞（新增 `pages/routing-sticky-sheet.tsx`）**
- `GET /api/routing/sticky?model=` → `{entries, now, sticky}`；
  `POST /api/routing/sticky/clear`，三种粒度：`{id, model}` / `{model}` / `{all:true}`。
- **倒计时按网关时间算**：记一份 `offset = 网关now - 本机now`，每秒用 `本机now + offset`
  走表。手机时钟与网关差几分钟很常见，直接用 `Date.now()` 会让剩余时间忽长忽短。
- **「没有绑定」不等于「坏了」**：档位是 `turn` / `off` 时网关本来就不保留跨请求绑定，
  界面上明说这一句，否则用户会以为功能没生效。
- 入口放在「策略与预演」的粘滞档位下面（桌面端也是从配置面板打开这个对话框）。
- 单条解除不发确认框（可撤销性高、列表里逐条点），全部解除才二次确认 —— 与桌面端一致。

**验证**：`tsc --noEmit` + `build` 均 exit 0；`check-mobile-ui.py` exit 0；`mobile.js` 1,245.06 kB。

#### 记忆点 · 步骤 14（路由 R4：路由组只读 + 选路预演）

新增 `pages/routing-groups.tsx`（`RoutingGroupsSection` + `RoutingPreviewSheet`）；
接进「策略与预演」模式（放在队列预演之后）。

**★ 为什么路由组只能看**：网关只有 `GET /api/routing/groups`，**没有保存组的 HTTP 路由**
（括号配对复检过，不是正则漏了链式 `.put()`）—— 组的增删改是**桌面壳写库的事务**。
所以手机端只能读；想改必须让网关补一条写路由（与「局域网访问」同属需改 Rust 的项）。
界面上写明这句，否则用户会一直找「新建组」的按钮。

**预演与「此刻队列」的分工**（这是这一屏容易混的地方，标签上也区分了）：
- `/api/routing/preview` = **假设**：不发送请求、不消耗额度、**不推进轮转**，
  且能模拟条件（需要工具调用/图片/视频，「首选失败」后落到谁）；
- `/api/routing/queue`（我用在「队列预演」那块）= **现状**：此刻真实会用的顺序。

**照抄的两个细节**：
1. **没有组时固定按「文本对话」算**（桌面端 `effectiveNeeds = group ? needs : 'text'`）——
   所以「请求需要」这一档只在组预演时出现；
2. **防抖 200ms + 「结果是否对应当前输入」守卫**（`resolvedFor === input`）——
   连点开关时后发的请求可能先回来，不比对输入就会把旧结果画上去。

**R4 只读展示的内容**：组名/绑定模型/描述/策略（`strategyLabel`）/粘性（`stickyLabel`）/
成员（provider · model · 是否参与 · 账号数）+ **可用模型目录**（`catalog` 去重后的
模型清单与「提供商组合」计数）；预演结果显示预演首选 + 可用候选（含每人原因）+
被跳过（含跳过原因）。

**验证**：`tsc --noEmit` + `build` 均 exit 0；`check-mobile-ui.py` exit 0；`mobile.js` 1,253.86 kB。

#### 路由板块进度

| 批次 | 内容 | 状态 |
|---|---|---|
| R1 | 工作空间（参与度 / 限额 / 健康 / 指标 / 此刻队列） | ✅ `bee4fa8` |
| R2 | 请求回放 + 链路追踪 | ✅ `7e9fd70` |
| R3 | 会话粘滞查看与解除 | ✅ `015514d` |
| — | **顺带修掉：路由设置键名写错导致「策略与预演」从未生效** | ✅ `015514d` |
| R4 | 路由组只读 + 选路预演 | ✅ 本次 |
| R5 | 路由档写入（参与范围 / 账号顺序 / 排除项） | ✅ `2af…`（本次） |
| — | 不做：画布布局、路由组写入（需网关补路由） | — |

#### 记忆点 · 步骤 15（路由 R5：参与范围写入 —— 板块收尾）

新增 `pages/routing-profile.tsx`（`RoutingProfileSheet`），入口在「工作空间」的
作用范围卡片上（「编辑参与范围」）；关掉抽屉时刷新工作空间。

**这是这一板块唯一写全局配置的一屏，所以规矩比别处严**：
1. **只发变过的键**（数组按排序后比较、`accountOrder` 按 JSON 比较）—— 后端对不认识的
   键静默忽略，全量发会掩盖键名写错（路由设置那次就是这么被掩盖的，见步骤 13）；
2. **带上 `revision`**：桌面端也传，后端据此做乐观锁 —— 另一台设备改过之后我们这份
   就过期了，宁可报冲突也不要覆盖；
3. **保存前明确确认**（它改的是真实转发用的账号集合），**保存后用服务端返回值回填**，
   不拿本地草稿当准；
4. 按钮上直接显示「保存 N 处改动」，没改动时是禁用的「没有改动」。

**两档参与语义（与 `routing-provider-card.tsx` 同一口径）**：
- `providerScope === 'selected'`：逐家开关写 `providers`；
- `providerScope === 'all'`：开关写 `disabledProviders`（取反 = 排除）；
- 逐条账号开关写 `excludedAccounts`；
- 顺序写 `accountOrder[providerId]`，**有效顺序** =
  `[...new Set([...(已存顺序), ...全部账号])]` 再滤掉不存在的账号 —— 这段是照抄的，
  自己另写一套会出现「界面顺序与网关实际顺序不一致」。

**`profile: null` 是独立动作**：删除该模型的独立配置、回落到继承全局，单独一个按钮 +
二次确认。只在「有独立配置且当前无未保存改动」时才出现（避免「又改又删」的歧义）。

**手机端没搬的东西**：桌面端的拖拽排序（换成 ↑↓ 按钮，与宫格排序同一取舍）、
「全局账号启停迁移」（`migrateGlobalAccounts`）那条遗留事务 —— 它只在旧库升级时用
一次，手机端插进去只会让状态更乱。界面上对 `globalAccountControl` 缺失的情况原样
提示「当前网关尚不支持全局账号启停，请更新网关后重新读取」。

**键名核对方法（这次也用了）**：`providerScope` / `providers` / `disabledProviders` /
`accountOrder` / `excludedAccounts` / `orderChange` / `migrateGlobalAccounts` / `revision`
逐个在已发布二进制里确认存在 —— 步骤 13 的教训之后，凡是写接口都走这一步。

**验证**：`tsc --noEmit` + `build` 均 exit 0；`check-mobile-ui.py` exit 0；`mobile.js` 1,262.50 kB。

**路由板块（R1–R5）已完成。** 剩下两项不做，都不是遗漏：
· **路由组写入**要网关补一条 `PUT /api/routing/groups`（现在只有 `GET`）—— 需改 Rust；
· **画布布局**是桌面交互范式（手机端用列表/分组折叠表达同一份数据）。

#### 记忆点 · 步骤 16（深度缺口 ① 撤回 + ② 请求原始报文）

**先说撤回**：我在 `docs/mobile-ui/DEPTH-GAP.md` 里把「代理订阅」列为缺口 #1，**这是错的**。
去 `gw-src/http.rs` 取契约时看到：

```rust
.route("/api/subscriptions", any(retired_proxy_feature))
.route("/api/subscriptions/{*rest}", any(retired_proxy_feature))
```

`retired_proxy_feature()` 直接返回 **410 Gone + `proxy_pool::RETIRED_HINT`** ——
**代理订阅是网关主动下线的功能**，不是遗漏。已把文档里那条划掉并写明判据。

**★ 教训被修正了一次**：步骤 13 我总结的是「差集/关键词只能产生候选，判定必须回查实现」。
这次说明还要再进一步 —— **回查实现时要看「处理函数本身是否已下线」**。
`/api/subscriptions` 明明是一条存在的路由，但它的处理函数是「已退休」占位。
所以判据应当是三层：① 路由存在？② 处理函数是真实现还是占位/410？③ 前端是否调用？

**② 请求原始报文（已完成）**
- 契约（源码级，`stats_api.rs` 的 `stats_request_raw`）：
  `GET /api/stats/requests/raw?id=` → `{id, requestBody, responseBody, truncated}`；
  400 缺 id；**404 = 正常状态**（正文只在调试模式开启期间的请求上采集，也可能已被清理）。
- 新增 `api/request-raw.ts`：把 404 归一成 `{found:false}`（当错误处理会在界面上报红，
  而它其实是「本来就没有」）；`prettify()` 对 <200k 字符的 JSON 做缩进。
- 新增 `components/RequestRawPanel.tsx`，接进请求日志的「请求详情」抽屉：
  **按需加载**（正文上限 32MB，一点开就拉会让抽屉变慢、白花流量）；
  **显示截断前 6000 字符 + 「复制全文」**（WebView 渲染几万字符会卡；要完整内容的
  场景是贴给别人，不是屏上读）；`truncated` 显示「旧版本保存，可能不完整」。
- 请求日志页补了 `row.id` 才渲染（没有 id 拉不到正文）。

**顺带发现的三个同模块端点**（已写进 DEPTH-GAP，值得单独排期）：
`POST /api/stats/requests/terminate?id=`（**终止一条在途请求** —— 手机上很实用）、
`GET /api/stats/requests/clear-preview`（清理预览）、
`POST /api/stats/requests/compact`（压缩库，重复触发 409）。

**验证**：`tsc --noEmit` + `build` 均 exit 0；`check-mobile-ui.py` exit 0；`mobile.js` 1,265.80 kB。

#### 记忆点 · 步骤 17（深度缺口 ③ 调试报文 + **② 的命名纠正**）

**★ 先纠正步骤 16 的一个错误**：我把 `/api/stats/requests/raw` 显示的面板叫「原始报文」，
**命名反了**。桌面端请求详情有四个标签页：

| 标签 | 数据源 |
|---|---|
| 请求详情 | 列表行自身 |
| **路由回放** | `route` 判定（≈ 我 R2 做的追踪） |
| **预览对话** | **`/api/stats/requests/raw`** —— 两侧正文交给 `wbConversationPreview.render()` 拼成对话预览 |
| **原始报文** | **`/api/debug/traffic?id=`** —— 请求头 / 请求体 / 响应头 / 响应体**四段** |

所以 ② 那个面板已改名为「**请求与响应正文**」（手机端不搬对话预览渲染器：它要按提供商
解析消息结构，属于「另做一套对话 UI」的量级；排查问题时真正要看的是原文）。

**★ 一个省事的契约来源（值得记）**：桌面 `ui-islands/src` 里**没有** `debug/traffic` 的
消费代码，本地也没有 `debug_api.rs` 源码。但**已发布的网关二进制里内嵌了面板的 JS**，
里面有完整的桥与消费方实现（压缩过但可读），直接挖出：

```js
getDebugTraffic: function (id) { return call('GET','/api/debug/traffic?id=' + encodeURIComponent(id)); }
wGe = [{label:'请求头',pick:e=>hL(e.requestHeaders)}, {label:'请求体',…requestBody},
       {label:'响应头',…responseHeaders}, {label:'响应体',…String(e.responseBody||'')}]
function SGe(e){ return [e.requestHeaders,e.requestBody,e.responseHeaders,e.responseBody]
  .some(v => typeof v==='string' ? v.trim()!=='' : v!=null) }   // 四段全空 = 没保存
function hL(e){ if(e==null) return ''; if(typeof e==='string') return e;
  try{ return JSON.stringify(e,null,2) }catch{ return '' } }
```

字段名、四段顺序、标签、归一函数、空态判据**全部照抄**，不是猜的。
（这个技巧值得复用：**二进制里的面板 JS 是端点契约的权威来源**，比翻 Rust 源码还快。）

**顺带确认**：`terminateStatsRequest(id)` 也在桥里 —— `POST /api/stats/requests/terminate?id=`，
桌面端的确认文案是「确定终止这条正在转发的请求？上游连接会立即断开，明细将记为
「请求已被手动终止」。」这条**手机端还没做**，已记进 DEPTH-GAP 的「顺带发现」。

**实现**：
- 新增 `api/debug-traffic.ts`（契约 + `hasTraffic` / `normalizeTrafficValue` / `trafficSections`，
  与面板侧同判据同归一）；
- 新增 `components/TextBlock.tsx`（**抽出来共用**：显示截断前 6000 字符 + 「复制全文」+
  「复制」走 `copyText` 带 execCommand 兜底），②③ 两个面板都用它；
- 新增 `components/DebugTrafficPanel.tsx`：按需加载 + URL/提供商/上游状态码一行 +
  四段 + 「这段没有保存」空态 + `truncated` 提示；
- 请求详情抽屉里两个面板并列渲染。

**判空口径**：`/api/stats/requests/raw` 与 `/api/debug/traffic` 都可能是「200 但没有内容」
或 404 —— **两者都归一到 `{found:false}`**，界面上给一句解释（报文只在调试模式开启期间采集、
也可能已被清理），而不是红色报错。网关的错误文案本身也说了这两种都是正常状态。

**验证**：`tsc --noEmit` + `build` 均 exit 0；`check-mobile-ui.py` exit 0；`mobile.js` 1,268.92 kB。

#### 六项缺口进度

| # | 内容 | 状态 |
|---|---|---|
| ① | 代理订阅 | **撤回**：`/api/subscriptions` 返回 410（`retired_proxy_feature`），功能已下线 |
| ② | 请求与响应正文（`stats/requests/raw`） | ✅ `fd76921` |
| ③ | 调试报文（`debug/traffic`） | ✅ 本次 |
| ④ | 自定义模型增删（`models/custom`） | ✅ 本次 |
| ⑤ | 日志下载（`logs/download`） | ✅ 本次 |
| ⑥ | MCP / Skill 安装（`tools/install-*`） | ✅ 本次 |

#### 记忆点 · 步骤 20（深度缺口 ⑥ 本机接入 —— 六项收尾）

**契约（两处权威源逐字对齐）**：Rust 源码 `gw-src/tools.rs` 的六个 handler +
二进制内嵌面板 JS 的同名封装：

```js
installInfo    = (e)   => GET  /api/tools/install-info?service=<id>
installTargets = (e,t) => GET  /api/tools/install-targets?service=<id>&protocol=<skill|mcp>
apiKeys        = ()    => GET  /api/tools/api-keys
installSkill   = (b)   => POST /api/tools/install-skill   { api_key_id, variant, clients }
installMcp     = (b)   => POST /api/tools/install-mcp     { service_id, mode?, api_key_id, clients }
uninstallSkill = (b)   => POST /api/tools/uninstall-skill { service_id, clients }
uninstallMcp   = (b)   => POST /api/tools/uninstall-mcp   { service_id, clients }
```

形状：`targets` 项 = `{key, label, installed}`；结果是 `{results: [{label, error, …}]}`
（面板侧也按 `{label, error}` 拆分成功/失败）；`/api/tools/api-keys` → `{keys:[{id,name,masked}]}`。
校验也照抄：`mode` 缺省 `http`、只接受 `http|bridge`、**`bridge` 仅视觉分析可用**；
`variant` 无效 / Key 不可用 / `clients` 为空各有 400。

**★ 一个必须先想清楚的取舍**：手机端工具页原本**主动声明不做**这项
（「本机客户端的安装在桌面端完成」）。核实后这个取舍有其道理 ——
skill 档是「由面板安装到**本机客户端目录**」，mcp 档是往客户端配置里写一段，
**写的都是网关所在主机的文件**。iOS 上网关就在手机里，那些目录（Cursor / Cline /
Claude Code 的配置）并不存在；`bridge` 档面板原文也写明「推荐在桌面端使用」。

**所以最终实现分成两半，价值差别很大**：
- **只读那半（任何设备都有用）**：`install-info` 给出**远程 MCP 地址**与工具清单
  （`web_search` / `web_fetch` / `image_analyze`），可以填进**任意**客户端的 MCP 配置
  —— 包括手机上的客户端。这部分带「复制地址」。
- **安装向导那半（有条件有用）**：只有手机端连**桌面网关**时才有意义。
  界面上留了一句明确提示：「目标是**网关所在主机**上的客户端目录 —— 手机连桌面网关时
  才有意义；网关就跑在手机上时那些目录通常不存在」，否则用户会以为装完就有用。

**实现**：新增 `api/tools-install.ts`（六个调用 + `splitOutcomes` 按 `{label,error}` 拆分）
与 `components/LocalAccessSheet.tsx`（接入信息 + 协议切换 skill/MCP + 目标开关
（**默认勾选已安装的**，与面板侧卸载对话框同一口径）+ Key 选择 + 变体 / 接入方式 +
安装 / 移除 + 失败逐条列出）；`ToolsPage` 每行加「本机接入」按钮，页头副标题改掉
（原来写「在桌面端完成」，现在指向每行的入口）。

**又一次踩到同名变量**：`LocalAccessSheet` 里 `const [nextInfo, nextKeys] = await Promise.all(...)`
之后又写了 `const nextKeys = await fetchToolApiKeys()` —— 重复声明（而且那次 fetch 本身也是多余的，
`Promise.all` 已经拿到了）。`tsc` 报 `TS2451 Cannot redeclare`。**记下来：写 `Promise.all`
解构后不要再补一次同一个请求。**

**验证**：`tsc --noEmit` + `build` 均 exit 0；`check-mobile-ui.py` exit 0；`mobile.js` 1,282.95 kB。

#### 记忆点 · 步骤 21（① 局域网访问 a–d：supervisor + 上游补丁，**服务端能力就绪**）

**做了什么**（默认行为逐字不变，开关默认关）：

| 位置 | 改动 |
|---|---|
| `agent2api-ios/ios-ffi/src/bin/agent2api-supervisor.rs` | 不再硬编码 `AGENT2API_HOST`；新增 `GET /lan`、`POST /lan?enabled=0\|1`；`/status` 增报 `panelPort`/`lan`/`host` |
| `agent2api-universal/patches/0006-panel-bind-host.diff` | 上游 `server/mod.rs` 加 `AGENT2API_PANEL_HOST`（默认沿用主 host），使面板能单独钉在回环 |

**★ 差点把别人的代码回退掉**：我本地那份 `agent2api-supervisor.rs` 是**旧版**
（11790 字节），仓库里是 14362 字节（多了 `factory-reset`）。动手前先比对
blob SHA-1 才发现 —— **本地树是部分检出，改任何文件前必须先与仓库比 sha**，
否则会把别人后来的改动一起推回去。已取仓库版为基准。

**契约/事实（读代码确认，不是猜）**：
- supervisor **根本不读** `AGENT2API_HOST`（只读 PROXY_HOME/PROXY_PORT/SUPERVISOR_PORT/SERVER_BIN/UI_DIR），L161 写死 `127.0.0.1`；
- **控制口 3066 也硬编码绑回环**（`TcpListener::bind(("127.0.0.1", control_port))`）→ 这条**不动**：否则开局域网等于把 `/start`、`/stop`、`/factory-reset` 一起送出去；
- 上游两个 listener **共用 `state.host`**（`SocketAddr::new(state.host, port)` / `(state.host, panel_port)`）→ 光有 env **无法**做到「网关出网 + 面板留本机」，所以必须加 `AGENT2API_PANEL_HOST`；
- headless 形态 `AGENT2API_HOST` **默认 0.0.0.0**（`bin/agent2api-server.rs:335`）——iOS 上之所以只听回环，正是因为 supervisor 传了 127.0.0.1；
- CI 检出的上游版本 = `git tag -l 'v*' --sort=-v:refname | head -1` = **v3.4.2**，补丁就是打在这个检出上。

**设计取舍**：桌面端有「局域网访问 + 同时开放网页管理面板」两个开关（后者默认关）；
手机端**只做第一个**，开局域网时把面板搬到 3067 并绑 `127.0.0.1` —— 少一个开关就少
一种配错的可能，而手机上的管理面本来也不必给局域网。**比桌面端默认更严**。
开关落 `<home>/supervisor.json`（本 bin 自己读写），读失败一律按**关**处理（安全默认）。
写开关时顺手把网关 stop+start（等于桌面端「改动需要重启应用生效」），
App 一次调用即可，不用自己编排 stop/start 的中间失败态。

**自己审出的两个错（本地没有编译器，只能靠审）**：
1. `is_running()` 里我在 `child` 借用未结束时调 `guard.take()` → **E0499**
   （原 `status_json` 用 `child_state` 变量就是为绕开这件事）。改成先记结论、出了
   `if let` 再动 `guard`。
2. 生成补丁时 hunk 头**数错**：`@@ -1027,5` 应为 `-1027,6`（漏了前导上下文行）。
   改成**由 body 反推计数**（`old_n = body 里 ' '/'-' 行数`），不再手算。

**验证（本机没有 git / cargo / rustc —— 这是真实约束，不能假装编译过）**：- 写了离线校验器（本机脚本 `verify-diff.py`，未入仓库）：解析 unified diff →
  逐行核对上下文/删除行与目标文件是否**逐字相同** → 重建整文件比 `index` 的
  pre/post blob SHA-1。
- `0006` 对 `mod.rs@v3.4.2`：**PASS**（`hunk @1027: -6 +29 OK`），pre blob
  `63ec13e` 与上游官方值一致。
- **对照组**：既有 `0005` 对 `altcha.rs@v3.4.2` 也是 PASS —— 证明校验器会过也会挂，
  不是空转；同时反证 v3.4.2 就是既有补丁的目标版本。
- Rust 编译与补丁实际应用**只能靠 CI 验证**（CI 打补丁失败会 `exit 1` 并提示重新
  生成，不会静默）。

**★ 补一道跨文件的环境变量名核对（能抓住安全后果的那类拼写错）**：
`AGENT2API_PANEL_HOST` 必须在**两个**地方逐字一致 —— supervisor 设置它、补丁给
`mod.rs` 加的读者读取它。**如果这里拼错，补丁等于不存在**：面板不会单独绑回环，
而是跟着 `AGENT2API_HOST` 一起听 `0.0.0.0`，**管理面直接出网**（不是「功能不好用」
那么轻的后果）。三方核对结果：

| 变量 | supervisor 设 | 谁读 |
|---|---|---|
| `AGENT2API_PANEL_HOST` | ✅ | **只有补丁读**（补丁的全部作用就是加这个读者） |
| `AGENT2API_PANEL_PORT` | ✅ | upstream `bin/agent2api-server.rs` 读 |
| `AGENT2API_HOST` | ✅ | 同一个 bin 读 |

三者逐字一致，没有拼写错位。顺带确认 upstream bin 还会读 `AGENT2API_ALLOW_NO_KEY`
（就是「允许无 Key 裸跑」那个开关）。

**待办**：①f 手机端设置页加入口（前置校验照抄桌面端：已注册管理员 + 至少一把启用
Key）。

#### 记忆点 · 步骤 22（①e iOS App 跟随面板端口 + `lan` 桥 op）

**改动（`PanelViewController.swift`）**：
- 拆开「网关端口」与「面板端口」：新增 `panelPort: UInt16?`（`nil` = 同端口）与
  `panelBaseURL`；**`baseURL` 仍留给 `/health` 探测与嵌入式形态**，只有加载面板
  （`/m`）与桌面面板切换改走 `panelBaseURL`；
- 新增 `syncPanelPort(reloadIfChanged:completion:)`：GET supervisor `/status`，
  读 `panelPort`，变了就更新；变成与网关同端口时清回 `nil`；
- `activateGateway()` 成功后改成 `syncPanelPort{ reload() }`（先问端口再加载）；
- `supervisorCall(op:id:enabled:)` 加 `lan` op：**给了 `enabled` 就
  `POST /lan?enabled=1|0`，没给就 `GET /lan`**；写成功后延迟 1 秒再同步端口+重载
  （否则刚发给 JS 的结果提示会被重载立刻抹掉）。

**★ 路径必须拼字符串，不能用 `appendingPathComponent`**：`/lan?enabled=1` 里的 `?`
会被后者百分号编码成 `%3F`，落成一个不存在的路径。原来的 `start`/`stop`/
`factory-reset` 没有查询串所以看不出这个问题。

**★ 设计 ①e 时担心的风险，查证后排除**：切局域网会把面板从 3065 换到 3067，
**Origin 变了**，而浏览器 localStorage 按 Origin 隔离 —— 看起来会丢登录态。
实际不会：`PanelViewController` 在**每次文档加载前**用
`WKUserScript(source: PanelSessionStore.restoreScript(), injectionTime: .atDocumentStart)`
把 Keychain 里的会话注回 localStorage（`servers.ts` 的 `storeServerAuth` 同时写
localStorage + 原生 `a2aSession` 桥，就是为这件事）。
**唯一缺口**：**Key 模式**的面板凭据走 `readServerKey`（**仅 localStorage**，不在
恢复脚本里）→ 切端口后要重填一次网关 Key。这条要在界面上写明。

**验证**：与仓库版逐行 diff 过（只有预期改动，括号平衡）；**Swift 本地无法编译**
（本机没有 Xcode/工具链），只能靠 CI 的 iOS 任务验证。

**待办**：①f 手机端设置页加入口。

#### 记忆点 · 步骤 23（①f 手机端局域网开关 —— ① 完成）

**改动**：
- `api/supervisor.ts`：`SupervisorStatus` 增 `panelPort`/`lan`/`host`；
  `supervisorCall(op, enabled?)` 支持 `lan` op（**不传 `enabled` 时不能把 `undefined`
  传进去** —— 原生侧用「有没有这个键」区分读/写）；新增 `supervisorLanState()`、
  `supervisorSetLan(enabled)`。
- `pages/SettingsPage.tsx`「服务」卡片：局域网访问开关 + 状态文案 + 说明 + 面板端口行。

**★ 我纠正了自己写在目标里的一条**：目标写的是「前置校验照抄桌面端（已注册管理员 +
至少一把启用中的网关 Key）」，但**读桌面原文发现只有前者是硬性前置**：

> 出于安全考虑，**开启前必须先注册一个面板管理员**：管理接口从此要求管理员会话或
> 网关 Key…；**一把启用的网关 Key 都没有时，转发接口也会拒绝服务**，直到创建第一把。

后半句是**后果说明**，不是拦截条件。所以这里只拦截「未注册管理员」，缺 Key 的情况
用说明文字告知（与桌面端同口径），**不擅自加拦截** —— 加拦截会把「先开局域网、再建
Key」这种正常顺序也挡住。

**★ 加了能力探测，而不是无条件显示开关**：`packaged` 也覆盖 APK，而 Android 侧的
控制桥未必实现 `lan` op。所以这一行只在 **supervisor 真的报了 `lan` 字段**时才渲染
（老版 daemon、没实现的形态自动隐藏）—— 不摆一个按下去必然报错的开关。`status_json`
无论网关是否在跑都会带 `lan`（它读的是设置文件），所以探测不受启停影响。

**又一次自己审出的错**：`Switch` 没导入就用了 —— 我先前用 `import[^;]*\bSwitch\b`
检查过「已导入」，但那个正则被同文件里的 **`ThemeSwitch`** 骗了（它在另一行 import 里，
`import … Switch` 的形式匹配上了）。`tsc` 直接报 `TS2304 Cannot find name 'Switch'`。
**教训：这类「字符出现过」的检查不能替代类型检查，写完就跑 tsc。**

**验证**：`tsc --noEmit` + `build` 均 exit 0；`check-mobile-ui.py` exit 0；
`mobile.js` 1,285.23 kB → **1,290.26 kB**（加了装包顺序不匹配的识别）。

**★ 装包顺序的坑（想过一轮才排除，值得记）**：这一版要同时更新 **deb**（supervisor +
网关 + 面板 UI）和 **IPA**（App 的 Swift）。两种错配：
- **新 deb + 旧 App**：旧 App 的 `a2aControl` 没有 `lan` op（认不出的 op 会退化成
  `GET /status`），于是开关**看起来能点、实际什么都没发生**，而且它也不会跟着换面板
  端口 —— 但那也意味着**设置根本没被改**，所以**不会把面板锁死**（我一度担心「开了
  局域网 → 面板搬到 3067 → 旧 App 还在连 3065 → 面板白屏且关不掉」；实际不会，
  因为旧 App 压根没把开关写进去）。已加一道识别：要求的状态没生效就明说
  「这个 App 版本还不会应用局域网开关，请升级 App」，而不是弹一句「已开启」骗人。
- **旧 deb + 新 App**：旧 supervisor 的 `/status` 不带 `lan`，那一行**根本不渲染**
  （能力探测），点了也不会出错。
⇒ **只装 deb 就够了（我先前在这儿写错了）。** 这个 deb 是**一体包**：`control` 里写着 `Section: Applications` 与 `app + launchd daemon`，包内含 `var/jb/Applications/Agent2API.app/`（App 二进制 253,824 B）与 `var/jb/Library/LaunchDaemons/*.plist` —— 装完 App 图标就出来，**App 也跟着一起换**。IPA 只是「另一种装 App 的途径」（侧载 / TrollStore），不是额外必需。（上面这种错配只在「deb 与 IPA 分开装、且 App 比 deb 旧」时才可能出现。）

#### ① 局域网访问 —— 完成情况

| 子项 | 内容 | 状态 |
|---|---|---|
| a | supervisor 读 `AGENT2API_HOST`（默认 127.0.0.1），控制口仍硬编码回环 | ✅ `ee591a8` |
| b | 持久化设置 + `GET/POST /lan`（loopback-only） | ✅ `ee591a8` |
| c | 补丁 `0006-panel-bind-host.diff` 加 `AGENT2API_PANEL_HOST` | ✅ `ee591a8` |
| d | 开启时网关 `0.0.0.0:3065`、面板 `3067` 绑回环、`/status` 报 `panelPort`/`lan`/`host` | ✅ `ee591a8` |
| e | App 跟随面板端口 + `a2aControl` 的 `lan` op | ✅ `1901b26` |
| f | 手机端设置页开关（能力探测 + 管理员前置校验 + 桌面警告文案） | ✅ 本次 |

**待 CI 确认（本地无 Rust/Swift 工具链，只能靠 CI）**：①补丁能打上；②supervisor 与
App 能编译。**待真机核对**：开关打开后局域网设备能否真的访问 `http://<手机IP>:3065/v1`
（需要真机 + 同网段另一台设备）；面板留在 3067 是否如预期不可从局域网访问。

#### 记忆点 · 步骤 24（② 路由组写入 —— **不需要任何 Rust 补丁**，我之前的判断是错的）

**★ 先纠正一个我说错的结论。** 我之前说「网关只有 `GET /api/routing/groups`，
要补一条写路由」。**这是错的**：上游 v3.4.2 的 `http.rs` 里本来就有

```rust
.route("/api/routing/groups", get(api::routing_groups::get_groups).put(api::routing_groups::put_group))
```

而 `api/routing_groups.rs` 里的 `put_group` 已经带齐了我要做的一切：**成员校验**
（`validate` + `validate_members`）、**revision 乐观锁**（冲突 **409**）、以及
保存后清掉该组的粘性绑定。

**我错在哪（这条比结论本身更值得记）**：那个判断是从**已安装二进制**
（`extract255/agent2api-server`）的字符串推的 —— 而**二进制里读不出 HTTP 方法**，
且那份二进制**比 v3.4.2 旧**。证据：它里面**没有** `put_group` 的特征串
（`路由配置已在其他位置修改` 0 次、`validate_members` 0 次），而本地 `gw-src/http.rs`
与 v3.4.2 的 `http.rs` **字节数完全相同**（91706）且**含** PUT 路由。

⇒ **契约必须以「CI 实际构建的那个 tag 的上游源码」为准**，不能用已安装产物反推；
二进制只适合看字符串常量，不适合看路由表。

**② 的契约（读源码确认）**：

| 项 | 内容 |
|---|---|
| 端点 | `PUT /api/routing/groups`（已存在） |
| 载荷 | `{id, group \| null, revision}`；**`group: null` = 删除该组** |
| revision | **整组内容的 SHA-256**（`revision(group)`），新建时用 GET 的 `newRevision` |
| 冲突 | **409**「路由配置已在其他位置修改，请刷新后重试；草稿未丢失」 |
| 响应 | 与 GET 同形（groups + newRevision + catalog）→ **回读内置** |
| 结构体 | `#[serde(rename_all="camelCase", deny_unknown_fields)]` → **多一个字段就 400**，客户端只能原样回传 |

**★ 零副作用探测**（这一手只有读懂 `save()` 才敢做）：探测用「`group: null`（删）
+ revision 传一个明显不是 SHA-256 的字符串」。因为 `save()` 里 revision 检查排在
**任何写入之前**（`if revision(old) != expected { return Err(...) }`），所以
**有这条路由一定 409、什么都没改**；没这条路由则 404/405。再叠一层保险：用一个
不存在的 id。⇒ 旧版网关可被安全识别为「不支持写入」，界面保持只读并说明原因。

**实现**：
- `api/routing.ts`：新增 `RoutingGroupMember`/`RoutingGroupBody`/`RoutingGroupsPayload<Catalog>`
  （`catalog` 泛型化，各页面自己定形状）、`putRoutingGroup`、`probeRoutingGroupWrite`；
- `pages/routing-group-edit-sheet.tsx`：**只改安全子集** —— 组名、说明、成员参与开关；
  草稿从读到的对象展开（`{...group, name, description, members}`），**不认识的字段逐字回传**；
  保存前给**改动摘要 + 二次确认**；**409 自愈**（重拉清单、把最新 revision 顶上来让用户再存一次）；
- `pages/routing-groups.tsx`：每组加「编辑」（首次点击做探测并缓存）、修正原先写错的
  注释与说明文字、把本地类型改成 api 层的别名（定义只有一份）。

**为什么只做安全子集**：对外模型 ID、策略、粘性、成员增删都**直接影响真实转发**，
桌面端在画布上有拖拽与校验配合；手机上只做桌面端也要点两次对话框的那类轻量修改。

**自己审出/编译逼出的三处**：①`Switch` 没导入（`tsc` 报 TS2304；我先前那个
「已导入」的正则被 `ThemeSwitch` 骗了）；②类型重复定义导致 `catalog` 不兼容 →
改成泛型 + 别名；③JSX 里用泛型组件要显式给类型实参（`<RoutingGroupEditSheet<RouteModelChoice> …/>`）。

**验证**：`tsc --noEmit` + `build` 均 exit 0；`check-mobile-ui.py` exit 0；`mobile.js` 1,290.10 kB。

**待真机核对**：装上新 deb 后编辑能否保存成功；用**旧网关**时应显示「网关不支持写入」
而不是报未知错误；409 路径（桌面端同时改）能否自愈。

#### 记忆点 · 步骤 25（① 收尾：面板/网关 origin 全量审计 —— 抓到一个真 bug）

**做这件事的由头**：①e 只改了 `reload()` 用 `panelBaseURL`，但文件里**还有别的**
用 `baseURL` 的地方。开了局域网后两个监听分家，**哪些该跟着面板走、哪些必须留网关**，
必须逐个定性 —— 猜错就是真机上白屏/静默失败。

**方法**：把每个 `baseURL` 用量按「这个 URL 由哪个监听提供」分类。

| 位置 | 该用哪个 origin | 处理 |
|---|---|---|
| `reload()` `/m`、`toggleDesktopPanel` 的 `/` 与 `/m` | 面板 | ①e 已改对 |
| `selfCheckPanel()` 的 `/health` | **网关**（网关路由） | 保持不变 |
| `selfCheckPanel()` 的 `/m`、`/` | 面板 | **修复** |
| 404 回退加载站点根 | 面板 | **修复** |
| `openLoginContainer(gateway:)` | 面板（拿它拼 `api/session/login/callback`） | **修复** |
| `probeHealth()` 的 `/health` | 网关 | 保持不变 |
| `syncPanelPort()` 的 `/status` | supervisor 3066 | 保持不变 |

**★ 抓到的真 bug（如果不修，真机上表现为「白屏 + 诊断条」）**：`selfCheckPanel()`
用同一个 origin 依次探 `/health` `/m` `/`。开了局域网后 `/m` 在 3065 必然 404 →
自检判 `/m` 不正常 → **把诊断条顶上来**、并且**回退去加载 3065 的根**（也是 404）
→ 用户看到白屏加一堆诊断信息，而面板其实好好地在 3067。修法是把 `/health` 单独
留在网关 origin，`/m` 与 `/` 走面板 origin。

**同一次审计还发现**：`LoginContainer(gateway: baseURL…)` 拿它拼
`api/session/login/callback`，而 `/api/*` 由**面板**监听提供 —— 传网关端口会让
**第三方登录静默失败**（容器里回调 404）。改成 `panelBaseURL`。

**顺带**：`AppDelegate.swift` 不涉及端口；`Bridge.swift` 只用
`if host == "127.0.0.1" || host == "localhost"` 判断「算不算外部地址」，与本改动无关
（两个文件都从仓库取来核对过 —— 本地树只有 2 个 Swift 文件，**又印证了本地是部分
检出、改任何文件前必须先与仓库比 sha**）。

**验证**：与仓库版逐行 diff 只有**本次这三处**（①e 的改动已在仓库里，所以不出现在
diff 中），无夹带改动；Swift 编译仍待 CI。

#### 记忆点 · 步骤 26（CI 验证点定位 + 符号唯一性核对）

**CI 里到底哪几步验证这次改动**（iOS 任务的步骤清单，从已成功的 run 273 读出）：

| 步 | 名称 | 验证什么 |
|---|---|---|
| 4 | 打补丁（插件宿主闸门 + 能力表端点） | **补丁 0006 能否打上**（失败即 `exit 1` 并提示重新生成） |
| 9 | 编网关守护进程（Mach-O，launchd 用） | **supervisor 能否编译**（`cargo build --bin agent2api-supervisor`） |
| 14 | 校验手机端自洽（图标 / i18n 参数 / 跳转 / 端点拼写） | 与本地**同一个** `check-mobile-ui.py` |
| 16 | 打 IPA + 打包 deb（rootless / rootful 两版） | **Swift 能否编译** + 出包 |

⇒ 以后要说「Rust/Swift 编译过了」，就引这几步的日志，别用别的间接证据。

**符号唯一性核对**（来回改多次最容易留下重复声明，只在编译期才炸）：

```
Rust  supervisor.rs: PANEL_LOOPBACK_PORT / SETTINGS_FILE / settings_path / lan_enabled /
                     gateway_host / panel_port / is_running / query_flag / set_lan
                     —— 均 声明 1 次、被引用（无死代码）
Swift PanelViewController.swift: panelPort / panelBaseURL / syncPanelPort
                     —— 均 声明 1 次、被引用
调用点：supervisorCall(op:id:enabled:) 唯一一处调用带上了 enabled（L747）
```

**① 端到端链路复核**（从点开关到面板换端口，逐跳对过一遍）：
界面 `supervisorSetLan(true)` → 桥投 `{op:'lan',enabled:true}` → Swift 拼
`POST /lan?enabled=1`（**拼字符串**，不用 `appendingPathComponent`，否则 `?` 会被编码）
→ supervisor `query_flag` → `set_lan` 落盘 + stop/start → `start_child` 读开关后设
`HOST=0.0.0.0` + `PANEL_PORT=3067` + `PANEL_HOST=127.0.0.1` → 网关按补丁把面板绑回环
→ `/status` 回 `panelPort=3067,lan=true,host=0.0.0.0` → Swift 收到 200 → 派发
`a2a-control-result` → JS 校验 `updated.lan === next` 通过 → 延时 1s 做
`syncPanelPort(reloadIfChanged:true)` → WebView 重载到 3067（会话由 `restoreScript`
在文档加载前注回，不丢登录）。
时间预算也对过：`set_lan` 内含 stop+start（最多等 15s 健康检查），Swift 请求超时 30s、
桥超时 35s —— 不会误判超时。

#### 记忆点 · 步骤 27（「CI 过了」到底等于过了哪些检查）

逐层把 CI 的检查点与**本地能跑的等价命令**对上，免得以后用含糊的「CI 过了」当证据：

| 层 | CI 位置（iOS 任务） | 等价本地命令 | 结果 |
|---|---|---|---|
| 上游补丁 0006 | **第 4 步** 打补丁 | 本机 `verify-diff.py`（模拟 `git apply`） | ✅ **run 278 第 4 步 success**（离线校验器事前的预测得到独立确认）|
| supervisor Rust | **第 9 步** 编网关守护进程 | 本机**无 cargo**，跑不了 | 待 |
| 手机端自检 | 第 14 步 | 同一个 `scripts/check-mobile-ui.py` | ✅ 本地已过 |
| 手机端类型 + 构建 | 第 15 步 `cd desktop-tauri/mobile && npm run build` | `tsc --noEmit` + `vite build` | ✅ 本地已过 —— 且 `build` 的定义就是 `tsc --noEmit && vite build`，**两层等价** |
| App（Swift） | **第 16 步** 打 IPA | 本机**无 Xcode**，跑不了 | 待 |

**改动确实会进包**（读命令确认，不是推测）：
- 第 15 步把新编的 `desktop-tauri/ui/m` **覆盖进上游 checkout** → deb / IPA 打包用的就是我们新编的 `mobile.js`（我的 TS 改动全在这条链上）；
- 第 9 步的 supervisor 编出来拷到 `out/ios/`，再由 `build-allinone-deb.sh --supervisor …` 打进 deb（我的 Rust 改动在这条链上）；
- 第 16 步 `xcodebuild` 编 App（我的 Swift 改动在这条链上）。

⇒ 一句话：**手机端那两层本地就能做全等验证；Rust 与 Swift 两层只有 CI 能验**，
所以涉及这两层时不许说「验证通过」，只能说「等 CI 的第 9 / 16 步」。

#### 真机验证清单（① 局域网访问 + ② 路由组编辑）

**前提：装 deb 就行**（一体包：App + 守护进程 + 网关 + supervisor + 面板界面）。
IPA 只在你想「侧载 / TrollStore 单独装 App」时才需要。

只有**分开装**的时候才要小心版本错配：
- 新 deb + 旧 App：那一行会显示，但点了提示「需要升级 App」，且**不会写设置**（不锁面板）；
- 旧 deb + 新 App：那一行**根本不渲染**（旧 supervisor 的 `/status` 不带 `lan`）。

**① 局域网访问**

1. 设置 → 服务：确认「网关服务」在跑，且**多出「局域网访问」一行**（默认关）。
   - 若没这一行 → `supervisor.json` 探测没拿到 `lan` 字段 → deb 没换新。
2. 先别注册管理员就点开关 → 应被**拒绝**并提示「请先在面板注册管理员…」（桌面端同口径）。
3. 注册管理员后再开 → 提示「已开启…网关正在重启」，约 1 秒后面板会自动重载
   （端口从 3065 换到 3067）。
4. 同网段另一台设备：`curl http://<手机IP>:3065/v1/models` 带网关 Key → 应有响应；
   不带 Key 或 Key 无效 → 应被拒（`v1FailClosed`）。
5. **反向确认面板不出网**：那台设备访问 `http://<手机IP>:3067/` → 应**不通**
   （面板钉在回环）。这条是 B 方案的核心保证，务必试。
6. 关掉开关 → 提示「已关闭…」，面板自动回到 3065。
7. 后台化测试（预期行为）：App 切到后台 → 网关按设计**被停掉**，局域网设备随之失联；
   回前台自动恢复。**这是「不做 C（后台常驻）」的预期结果**，不是 bug。

**② 路由组编辑**

1. 路由 页 → 路由组 → 展开一个组 → 点「**编辑**」。
   - 新网关：打开编辑抽屉（首次点击会先做一次零副作用探测）。
   - **旧网关**：应弹「当前网关不支持保存路由组（缺少 PUT /api/routing/groups），
     请升级网关后再试」，并**保持只读**（不是未知错误、不是白屏）。
2. 改组名 / 说明 / 关掉某个成员的参与 → 点保存 → **先出现改动摘要**（每条一行：
   「组名：A → B」「成员 X：参与 → 不参与」）→ 确认后保存 → 提示「已保存路由组」。
3. 保存后列表**立即回读**（响应就是整份新数据），关掉抽屉再展开应看到新值。
4. **409 路径**：在桌面端同时改同一个组（比如改组名），再回手机上保存 → 应提示
   「这个组在别处被改过：已载入最新版本，请确认改动后再次保存」，再点保存应成功
   （revision 已被顶成最新）。
5. 反向确认**没别的字段被改**：保存后到桌面端看那个组 —— 对外模型 ID、策略、粘性、
   成员列表与账号范围都应**原样不变**（手机上只改了组名/说明/参与开关）。

#### 记忆点 · 步骤 28（CI 原文证据：补丁 + supervisor 都过了；**Swift 还没**）

**run 278 的 iOS 任务全绿**（步骤 4/9/10/14/15/16 全 success）。日志原文摘录：

打补丁（第 4 步）——前五行是既有的 0001–0005，最后两行是**我这次的 0006**：
```
== apply agent2api-universal/patches/0006-panel-bind-host.diff
✅ 已应用
```

编守护进程 / supervisor（第 9 步）：
```
cargo build --release --target aarch64-apple-ios --bin agent2api-supervisor
target/aarch64-apple-ios/release/agent2api-supervisor: Mach-O 64-bit executable arm64
-rwxr-xr-x 1 runner staff 375K agent2api-supervisor
cp …/agent2api-supervisor  …/var/jb/usr/local/bin/agent2api-supervisor    ← rootless
cp …/agent2api-supervisor  …/usr/local/bin/agent2api-supervisor          ← rootful
```

⇒ **补丁 0006 在真实 CI 里打上了**；**supervisor 的 Rust 改动编过了**（iOS arm64），
而且**两个 deb 变体都装进了新编的 supervisor**（这条同时证实了「改动会进包」）。

**★ 但这批日志**只**证明这些 —— 必须精确界定范围**：run 278 的提交是 `ee591a8`，
它包含 supervisor + 补丁 0006，**不包含**后来的 Swift 改动（`1901b26`）、设置页
（`eb31dae`）、②（`606ac90`）、origin 修复（`0f237aa`）。所以：

| 改动 | 是否已被 CI 验证 |
|---|---|
| 补丁 0006 | ✅ run 278 第 4 步 |
| supervisor Rust | ✅ run 278 第 9 步 |
| 手机端 UI（①f/② 之前的状态） | ✅ run 278 第 14/15 步 |
| **Swift（①e + origin 修复）** | ⏳ **未验证** —— 要等 281/283/287/290 的 iOS 任务 |

**顺带确认了零副作用探测的安全性**（这条不查清不敢留）：探测依赖「revision 检查在
任何写入之前」，而 `config::try_update_raw_field` 的实现是

```rust
let result = mutate(&mut value)?;        // 闭包返回 Err → `?` 立刻返回，后面全不执行
if value == before { return Ok(result); }
...
if !save_raw(&next.raw) { ... }          // 唯一的落盘点
```

⇒ `save()` 的 revision 失配错误**发生在任何落盘之前**，探测确实什么都不改。
（同一函数还看到 `CONFIG_UPDATE_LOCK` 串行化、以及「值没变就不写」的短路。）

#### 六项缺口最终状态（上一批：步骤 16–20）

| # | 内容 | 结果 |
|---|---|---|
| ① | 代理订阅 | **撤回**：`/api/subscriptions` 返回 410（`retired_proxy_feature`），功能已下线 |
| ② | 请求与响应正文 | ✅ `fd76921` |
| ③ | 调试报文 | ✅ `1a87975` |
| ④ | 自定义模型增删 | ✅ `ceea7f3` |
| ⑤ | 日志文件下载 | ✅ `510a56e` |
| ⑥ | 本机接入（MCP / Skill） | ✅ 本次 |

三项**待真机核对**（都是「参数/过滤是否如预期」，不阻塞功能）：
1. 请求回放的查询参数名（步骤 14 记的）；
2. `/api/logs/download` 的筛选是否真的收窄内容（最坏是下载整份）；
3. 本机接入的 `targets`/`results` 具体字段（形状取自面板 JS，未在真机跑过）。

#### 记忆点 · 步骤 19（深度缺口 ⑤ 日志文件下载）

**先确认「补的是哪一层」**：日志页原本**已经有**「导出」按钮 —— 它把**当前渲染的分组**
（数据库里筛选后的条目）落成 JSON，是客户端行为。⑤ 要补的是另一种东西：
`GET /api/logs/download` 拿**网关日志文件本身**（`Content-Disposition: attachment`，
保留原始行格式，适合整份贴给上游排查）。**两个动作不是一回事**，所以界面上分成
「导出」（原有按钮）与「下载日志文件」（新增图标按钮），而不是替换掉原有那个。

**★ 为什么这个端点不能用 `apiCall`**：它回的是**纯文本文件**，不是 `{success,data}` 信封；
`apiCall` 按 JSON 解析会直接失败。所以用 `resolveUrl` + `authHeaders` 自己发一次
（`api/client.ts` 已经导出这两个），再 `response.text()`。

**顺手加的健壮性**：
- 发请求前先 `refreshPanelAuthIfExpiring()`（面板令牌会过期，裸 fetch 不会自动续期）；
- **回的是 JSON 就当成错误**：读 `content-type`，若是 `application/json` 就解析出
  `error`/`message` 抛出来，**不会把错误信封当日志存成文件**；
- 文件名优先从 `Content-Disposition` 取，`filename*=`（RFC 5987，含百分号编码）与
  `filename="…"` 两种写法都认；取不到才回落 `agent2api-logs-<日期>.log`；
- 落盘走 `lib/download.ts` 的 `saveBlob`（iOS 走原生 `a2aFile` 桥、浏览器走 `<a download>`）。

**查询参数**沿用列表那一套（`logQueryString(LogQuery)`，来自共享模块 `ui-shared/logs`）。
⚠️ **待真机核对**：`download_logs` 与 `query_logs` 同模块，路由表里只看到路径，
**过滤是否生效不确定**。最坏结果是「下载到整份日志」，不影响拿到内容 —— 所以这条
不阻塞功能，但要在真机上确认一次筛选是否真的收窄了内容。

**踩到的自己造成的错**：改 `LogsPage.tsx` 时我用「把 A 行替换成 B 行」的方式插入代码，
误删了紧邻的 `const totalGroups = …` 一行（它后面被 `pageCount` 用）。`tsc` 立刻报错
才发现。**教训：插入代码要用「在 X 后面加」而不是「把 X+Y 换成 X」，别把邻行卷进替换范围。**

**验证**：`tsc --noEmit` + `build` 均 exit 0；`check-mobile-ui.py` exit 0；`mobile.js` 1,274.12 kB。

#### 记忆点 · 步骤 18（深度缺口 ④ 自定义模型增删）

**契约（从二进制内嵌面板 JS 挖的，两个字段）**：
```js
addCustomModel:    (provider, id) => POST /api/models/custom        { provider, id }
removeCustomModel: (provider, id) => POST /api/models/custom/remove { provider, id }
```

**★ 适用范围是从面板侧抄的判断，容易搞错**：`addCustomModel` / `removeCustomModel`
**只服务内置家**。自定义提供商的模型清单是**整表保存**的（走 `/api/custom-providers/models`，
面板侧有单独分支 `as(provider)`），从 `models/custom` 加会和那边打架 —— 所以手机端的
登记抽屉里只列内置家，并写明「自定义提供商请在那边改」。

**两条校验照抄面板侧 `WI(provider, id)`**（文案一致，顺序一致）：
1. 清单里已有同 id →「模型 ID「{id}」已存在，请使用已有模型」；
2. 已有启用中的绑定 →「模型 ID「{id}」在该提供商已有启用绑定，请先关闭它再添加」。
**判重口径也照抄：忽略大小写**（面板侧 `ss()` 两边小写化）—— 不照抄会出现
「手机说能加、网关说已存在」。

**可移除的判据**：面板侧 `function o7(e){ return e.source === "manual" || as(e.provider) }`。
手机端**只取前半条** `source === 'manual'`（手动登记）—— 手机端的 `sourceLabel()`
早就把 `'manual'` 显示成「手动」，判据是现成的；后半条（自定义提供商）不在这里做。
移除确认文案也照抄：「确定移除自定义模型「{id}」？这条登记会被直接移除，之后
`/v1/models` 不再广告它、请求它也会被拒。」

**改动**：`api/gateway.ts` 加 `addCustomModel` / `removeCustomModel` / `isManualModel`；
新增 `pages/models-add-custom-sheet.tsx`；`ModelsPage` 页头加「登记自定义模型」（plus 图标）、
行上对手动登记的模型显示「移除」、页尾说明改成「手机端做启停，以及登记 / 移除自定义模型」。

**踩到的编译错误**：`ModelsPage.tsx` 原本就 import 了 `Button` / `confirmDialog` / `store` /
`providerLabel`，我又 import 一遍 → `TS2300 Duplicate identifier` 四处。删掉重复的即可。
（教训：**给已有文件加 import 前先读它的 import 块**，别凭印象追加。）

**顺带确认缺口 #8（新增映射）确实存在**，且拿到了确切载荷：
`addModelMapping(alias, target, provider, reasoning?, enabled?, create?)` →
`POST /api/models/mappings`，后三个参数**按「有没有传」决定进不进请求体**（三态语义）。
另发现 `POST /api/models/capabilities`（能力位覆盖，各键三态：不给=不改 / null=恢复原值 / 给值=覆盖，
**只服务内置家**）。

**验证**：`tsc --noEmit` + `build` 均 exit 0；`check-mobile-ui.py` exit 0；`mobile.js` 1,272.77 kB。

## 4. 常用事实

- 手机端 API client：`desktop-tauri/mobile/src/api/client.ts` 的 `apiCall`。
- 组件库导出：`desktop-tauri/ui-kit/src/index.ts`（Sheet/Input/Label/MultiSelect/Switch/Button/confirmDialog…）。
- 图标名：`mobile/src/components/Icon.tsx`（有 plus/settings/copy/eye/trash/refresh…，没有 share/download 等，需要时添加）。
- 多服务器：`mobile/src/lib/servers.ts`（serverIdentity/apiBase/baseLabel）。
- provider 标签：`mobile/src/lib/providers.ts` 的 `providerLabel`。
- 手机路由表：`mobile/src/lib/routes.ts` 与 `App.tsx` 的 `RB`（home/report/accounts/assistant/more…）。
- iOS 原生壳：`agent2api-ios/app/Agent2API/PanelViewController.swift`。
- supervisor：3066 控制口；网关 3065；App 前台 /start、后台 /stop、心跳 5s/15s。
- 分析文档：`docs/MOBILE-UI-GAP-ANALYSIS.md`、`docs/MOBILE-UI-DEVELOPMENT-PLAN.md`。

## 5. 工程注意

- 不要提交 `node_modules/`、`ui/m/`、`ui/sw.js`。
- 改完必须 `pnpm exec tsc --noEmit` 通过再推送。
- 桌面独有能力（写客户端配置、本地 stdio MCP/Skill、桌面安装器）在手机端标注“桌面专属”，不硬搬。
- GitHub PAT 不要写进任何文件；用户侧需要撤销旧 PAT。
- **本机构建环境**（无全局 node/npm）：
  - node：`C:\Users\Admin\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`
  - pnpm：`…\dependencies\pnpm\bin\pnpm.mjs`（用 `node pnpm.mjs …` 调）
  - 先 `$env:PATH = "<node bin>;" + $env:PATH`，否则 npm 脚本里的 `node` 找不到。
  - 工程目录：`desktop-tauri/mobile`；`pnpm exec tsc --noEmit` + `pnpm run build`。
- **文件编码铁律**：含中文的文件**只能**用 `write`/`edit` 工具或 Python（显式
  `encoding='utf-8', newline='\n'`）写；**绝不要**过 PowerShell 的 `Get-Content -Raw` /
  `Set-Content`（按 GBK 解码 + 写 BOM + 吃掉引号和换行，`build-ipa.sh` 就是这么坏的）。
  下载文件一律 `Invoke-WebRequest -OutFile`；控制台是 GBK，**不要**用 PowerShell 直接打印中文。
- **deb 产物校验**：`desktop-tauri/ui/m/mobile.js` 的 SHA256 必须与 deb 内
  `usr/local/share/agent2api/ui/m/mobile.js` 一致（证明 deb 装的是本次源码构建）。
- GitHub API 走 `Invoke-RestMethod`，头 `Authorization: token <PAT>` + `User-Agent`；
  push 用 blobs → trees → commits → refs 四步。Actions 产物下载走
  `https://api.github.com/repos/<repo>/actions/artifacts/<id>/zip`（Release 资产走
  `/releases/assets/<id>` + `Accept: application/octet-stream`）。本机直连 GitHub 常超时，
  用户侧可用 `https://ghfast.top/` 或 `https://gh-proxy.com/` 前缀加速。

#### 记忆点 · 步骤 29（一个我自己造成的、必须还原的副作用：行尾被改成 LF）

**症状**：这次改动清单里 `docs/DEVELOPMENT-MEMO.md` 显示 **+1793 / −1405** —— 而我这轮
只加了大约几百行。**数字不对就是线索**。

**原因**：这个文件原本是 **CRLF**（基线 `e0fad5b`：1405 行 CRLF、0 个纯 LF）。我用
Python 写入时写的是 `newline='\n'`，于是**整个文件的每一行都算改动**：

| | 基线 e0fad5b | 我改后 1a5bb49 |
|---|---|---|
| CRLF 行 | 1405 | 0 |
| 纯 LF 行 | 0 | 1793 |

**为什么必须还原，而不是「反正内容对就行」**：
1. 这是**无关的格式化改动**，把真实内容改动埋在 1793 行噪声里 —— 谁 review 都看不出
   我到底改了什么；
2. 它会**长期**污染后续每一个 diff（只要文件还是 LF，而其它分支/工具按 CRLF 写，就会
   反复全文件冲突）；
3. 与仓库既定约定不一致。

**做法**：把本地副本转回 CRLF 再推。**代价**是这一次 push 的 diff 仍然是全文件级
（LF→CRLF），但仓库从此回到原约定，**之后的 diff 才是干净的**。

**教训（真实可复现）**：用脚本改文本文件时，**先看原文件的行尾**再决定写入方式；
Python 里要么用 `newline=''`（保留原样）并自己拼行尾，要么显式选对。写完的核对方式
是数一遍：`CRLF 行数 == 总行数`（或两者都应为 0）—— 一行命令就能发现这类问题，
而**编译、类型检查、自检脚本全都不会报**（它们只看内容）。

**顺带核对**：这次改动的其它文件行尾都**没被动过**（`DEPTH-GAP.md` +31/−4、
`ROUTING-GAP.md` +11/−5、Swift +96/−15、Rust +142/−18、各 TS/TSX 变动都是小差额）
—— 只有这份 CRLF 的 memo 中招。新写的 `0006-panel-bind-host.diff` 用 LF 是**对的**
（git 补丁就该是 LF，CI 也成功 `git apply` 了）。


#### 记忆点 · 步骤 30（② 载荷字段集核对 —— 「原样回传」这个前提必须证实）

② 的草稿是「**展开读到的对象 + 覆盖组名/说明/参与开关**」，它靠的前提是：客户端回传的
字段集与上游**逐字一致**。因为上游结构体带 `deny_unknown_fields` —— **多一个字段就
400**，少一个（无 `default` 的）也 400。这不是「宽容处理」，所以必须点数而不是假设：

| | 上游 Rust（`config/routing_groups.rs`） | 手机端 TS（`api/routing.ts`） |
|---|---|---|
| 组 | `id, name, model, description, strategy, sticky, members` | **完全相同** |
| 成员 | `id, provider, model, included, accounts` | **完全相同** |

两个结构体都**没有** `skip_serializing_if` / `flatten` / `skip_deserializing`
（只有 `description` 带 `#[serde(default)]`，那只影响反序列化）⇒ 序列化输出就是
这 7 + 5 个字段。所以「展开 + 覆盖三项」产出的载荷**结构上必然合法**，
`deny_unknown_fields` 不会拦。

**为什么值得单独查这一条**：如果字段集错了，症状是**每一次保存都 400**，报错来自 serde
（`unknown field` / `missing field`），很容易被误读成「网关不支持写入」，从而把功能
整个判死。⇒ 「API 边界上的结构等价」属于实现前就该点数的东西。

**（同时演练了步骤 29 的教训）**：改这份 CRLF 文件时用 `open(..., newline='')`、
锚点里带 `\r\n`、写完复核 `CRLF 行数 == 总行数` —— 行尾保住了。
另记一个小坑：第一次锚点没匹配，因为我在锚点里写了 ASCII 括号 `(`，而文件里是**全角
`（`** —— 中文文档里的括号必须从原文复制，不能凭印象打。

#### 记忆点 · 步骤 31（①f 前置校验的字段名核对 —— 顺带修掉一个会误人的分支）

**核对**：①f 的前置校验读的是「面板管理员是否已注册」。上游 `api/panel.rs` 里：

```rust
fn panel_status() -> Response {
    ok_json(serde_json::json!({ "registered": access::admin_registered() }))
}
```

⇒ `GET /api/panel/status` 的字段名就是 **`registered`**（`bool`），与桌面端
`panelAdminStatus().registered` 是同一份事实。**这条必须查**：如果字段名不同，
手机端读到 `undefined`，校验会**永远拒绝**开启 —— 功能整个不可用，而报错还指向
「请先注册管理员」，极难定位。

**顺带修掉一个会误人的分支**：原来写的是 `if (!status.registered)`，于是「**读不到
状态**（响应不是预期形状 → `undefined`）」与「**未注册**」被合并成同一句提示
—— 用户明明注册过却被告知「请先注册管理员」，看起来就像功能坏了。
改成三分支（都仍然**拦截**，安全方向不变，这个开关读不到就绝不放行）：

| 读到 | 提示 |
|---|---|
| `true` | 放行，继续写开关 |
| `false` | 「请先在面板注册管理员，再开启局域网访问」 |
| 读不到 | 「读不到面板管理员状态，请刷新面板后重试」 |

**验证**：`tsc --noEmit` + `build` 均 exit 0；`check-mobile-ui.py` exit 0；
`mobile.js` **1,290.35 kB**。

#### 记忆点 · 步骤 32（Swift 编译 —— CI 原文证据，run 279）

**run 279（push 触发，sha `1901b26`）iOS 任务整体 success**，其中第 16 步
「打 IPA + 打包 deb」success。日志原文：

```
EMBED=0 ./agent2api-ios/scripts/build-ipa.sh
EMBED=1 ./agent2api-ios/scripts/build-ipa.sh
SDK: /Applications/Xcode_16.4.app/.../iPhoneOS18.5.sdk
==> [7/7] 打 IPA
```

**整份日志里 `error:` 行数 = 0**；`PanelViewController.swift` 只出现**既有警告**
（`53:13` 未使用的 `build`、`760:35` / `763:31` 未使用的返回值 —— 都在我没改的区域）：

```
PanelViewController.swift:53:13: warning: initialization of immutable value 'build' was never used
PanelViewController.swift:760:35: warning: result of call to 'save(serverId:json:)' is unused
```

⇒ **①e 的 Swift 改动编译通过**（`panelPort` / `panelBaseURL` / `syncPanelPort` /
`a2aControl` 的 `lan` op / `supervisorCall(op:id:enabled:)`）。

**范围仍然要分清**：run 279 的提交是 `1901b26`，**不含**后来那三处 origin 修复
（`0f237aa`）。那三处由 run 288（push，`0f237aa`）覆盖，当时还在排队 ——
所以这一步只证明「①e 编译通过」，不证明 origin 修复也编译通过（两者都是 Swift，
后者的证据要单独看）。

**至此各层验证状态**：

| 层 | 证据 |
|---|---|
| 补丁 0006 | ✅ CI run 278 第 4 步（原文 `== apply …0006…` → `✅ 已应用`） |
| supervisor Rust | ✅ CI run 278 第 9 步（`Mach-O 64-bit executable arm64`，进两个 deb 变体） |
| 手机端 UI | ✅ 本地三项 + CI 第 14/15 步（`npm run build` 本身就含 `tsc --noEmit`） |
| **Swift ①e** | ✅ **CI run 279 第 16 步**（`Xcode_16.4` / `iPhoneOS18.5.sdk`，0 个 error） |
| Swift origin 修复 | ⏳ run 288 排队中 |

**顺带发现的一个仓库级问题（值得单独提）**：`build.yml` 同时配了
`push: branches: [main]` 与 `workflow_dispatch`，而且**没有 `concurrency` 段** ——
于是**每一次 push 都会排一整套全平台构建**（`only` 默认 `all`，每个都要一台 macOS
runner）。我这一轮 push 了十几次，就往队列里塞了 13 个这样的运行，**这是我自己造成的
排队**。而且这个 token **没有取消 Actions 运行的权限**（取消请求得到 401），所以那些
运行只能自己排空。

⇒ 两条可直接采用的改进：①给工作流加
`concurrency: { group: ${{ github.workflow }}-${{ github.ref }}, cancel-in-progress: true }`，
让被覆盖的运行自动取消；②我的**文档类改动应该攒着和代码一起推**，不要每个记忆点单独 push
（每次都是一整套构建）。

#### 记忆点 · 步骤 33（包内验证的方法 + 阴性对照）

**动机**：CI 步骤绿只说明**构建过程**没出错，不说明**产物里真的有我的改动**。本地又没有
cargo / xcodebuild，所以最后一道验证放在**可安装的包**上：直接读包里的二进制与前端资源，
找只可能来自本次改动的字符串。**先做阴性对照**，否则「找到了」没有说服力。

**脚本**：本机 `verify-deb.py`（未入仓库，与 `verify-diff.py` 同类）。纯 Python 解 `ar`
归档 + 解 `data.tar.xz`（不依赖 ar / tar 命令），只提取关注的几个文件再搜标记：

| 层 | 标记字符串 | 为什么它特异 |
|---|---|---|
| supervisor（①a/b/d）| `supervisor.json` | 我新加的常量（开关持久化文件名）|
| 网关（①c 补丁）| **`AGENT2API_PANEL_HOST`** | 补丁新引入的环境变量名，上游 v3.4.2 没有这个串 |
| supervisor 日志（①d）| `lan access = ` | 只有控制口 `/lan` 那条路径会写 |
| 手机端 UI（①f）| 「已关闭 · 只监听 127.0.0.1」 | 新增文案 |
| 手机端 UI（②）| 「编辑路由组」 | 新增文案 |

**阴性对照**：拿改造前的 `ios-202608...-b276`（构建自 `e0fad5b`，公开 Release 资源、
下载不需要 token）跑一遍 → **0/5 命中** ⇒ 标记确实特异、脚本确实能读到包内文件。

**顺带看清的包内布局**（rootless 变体）：
```
./var/jb/usr/local/bin/agent2api-server              20,251,472 B
./var/jb/usr/local/bin/agent2api-supervisor             373,920 B   ← 与 CI 日志的 375K 对得上
./var/jb/usr/local/bin/ui/m/mobile.js                 1,282,951 B
./var/jb/usr/local/share/agent2api/ui/m/mobile.js     1,282,951 B   ← UI 两份（与 plist 的
                                                                      AGENT2API_UI_DIR 对应）
```

**还发现 token 的两个权限边界**（都得到 401）：**不能取消 Actions 运行**、**不能下载运行产物**。
⇒ 所以包内验证**只能走公开的 Release 资源**（那条路不需要 token），运行的 `ios` 产物
（含 IPA）我这边拿不到 —— 要由你来下载。

#### 记忆点 · 步骤 34（从代码构造出的一条真实坏路径：网关停止时改开关会让面板消失）

**路径**（读代码推出来的，不是猜的）：设置 → 点「停止网关」→ 网关已停 → 此时点
「局域网访问」开关 → supervisor 写设置但**不重启**（`is_running` 为假）→ 可是 `/status`
照样报 `lan:true, panelPort:3067` → App 的 `syncPanelPort` 发现端口变了 → **重载到 3067**
→ 那里没有监听 → **面板消失**（用户得靠状态条上的重试按钮把网关拉起来才能回来）。

**根因**：开关改的是**子进程启动参数**，其生效前提是网关会被重启；而「网关没在跑」这个
前置条件会让「落盘」与「生效」脱节，但 `/status` 仍然如实报出新端口 —— 于是 App 照着
新端口去加载一个空端口。

**修法**：**网关不在运行态时禁用这个开关**，并在同一处给一句说明（先启动网关再改）。
这比「允许改然后处理后续状态」简单得多，也避免让用户撞上那个消失的面板。

**验证**：`tsc --noEmit` + `build` + `check-mobile-ui.py` 三项全过，`mobile.js` 1,290.63 kB。

**（本次推送按新规矩）**：代码改动 + 攒下的记忆点**一次推**，不再让每个记忆点单独触发
一整套全平台构建。

## 记忆点 · 步骤 35（网关状态 × 局域网开关：状态矩阵核对）

修「网关停止时改开关会让面板消失」那条时，顺手把两个维度的状态全排了一遍，确认**没有
引入新死角**：

| 网关 | 局域网 | 开关 | 行为 |
|---|---|---|---|
| 运行中 | 关 | 可用 | 打开 → supervisor 落盘并重启 → 面板搬到 3067 ✓ |
| 运行中 | 开 | 可用 | 关闭 → 落盘并重启 → 面板回到 3065 ✓ |
| 已停止 | 关 | **禁用** + 提示 | 不会误触 ✓ |
| 已停止 | 开 | **禁用** + 提示 | 提示「先启动网关」，启动后即可关掉 ✓ |

**关键一问：最后一格会不会变成新死角？** 不会。网关停止时面板之所以还能显示，是因为
页面是**之前加载好的**（`/api/*` 调用失败但界面还在），而提示正好指向恢复路径；用户在
设置里点「启动网关」后，`activateGateway → POST /start` 会带着 `lan=true` 把面板起在
3067，`syncPanelPort` 再把它重载过去 ✓。

另需记清一条**既有性质**（不是本次引入的）：**停止网关本来就会让面板的接口全部失效**
（与局域网无关）。所以「停止网关后界面看起来还在、但点什么都报错」是原有行为，
不要把它归因到本次改动。

---

## 记忆点 · 步骤 36（环境事件：会话中途 token 失效，以及它如何影响收尾）

**现象**：会话中途，所有 GitHub API 调用开始返回 **401** —— 包括此前一直正常的
`GET /user`。用匿名访问同一个仓库却成功。

⇒ 判定：**不是权限范围问题，是凭证本身失效**（`/user` 都 401）。

**影响与不受影响**（这条决定了当时该怎么继续）：

| 能力 | 状态 |
|---|---|
| 推送（写操作） | ❌ 不可用 |
| 读仓库 / 读 CI 状态 | ✅ 匿名可用 |
| 下载 Release 资源 | ✅ 匿名可用（此前下 b276 成功） |
| 下载 Actions 运行产物（IPA） | ❌ 需要 token（早先即为 401） |

**关键点**：**收尾所需的验证不需要 token** —— 「Swift origin 修复的编译」靠匿名读 CI
第 16 步，「包内验证」靠匿名下载公开的 Release deb。所以 token 失效**不阻塞收尾**，
只阻塞「发现新问题后再修再推」。

**当时已推到哪里**：到 `5c425ea` 为止共 14 个提交（①a–f、②、审计文档更正、若干记忆点）。

**做法（值得沿用）**：把待补的记忆点写成这份**附页文件**，而不是留在会话里 ——
否则 token 一旦失效，这些内容就随会话消失了。

---

#### 记忆点 · 步骤 37（Swift origin 修复已验证 + 发布包已出）

队列跑完后（其间我误发的取消请求延迟生效，把 run 288 取消了——不过覆盖面不受影响）：

| run | 提交 | 第 16 步（打 IPA + 打包 deb）|
|---|---|---|
| 279 | `1901b26` | ✅ |
| **296** | `0c4ef6f` | ✅（覆盖 **origin 修复**在内的全部 Swift）|
| **290** | `3971f0e` | ✅ 并**发布 `ios-20261108-b290`**（6 个资源）|
| **298** | `5c425ea` | ✅（最新代码）|

⇒ **Swift 全部编译通过**，且各层验证闭环（补丁 0006 / supervisor / 手机端 / Swift）。

#### 记忆点 · 步骤 38（包内验证通过 8/8；以及一个「验证方法本身出错」的教训）

从**公开 Release** 下 `ios-20261108-b290` 的 deb（rootless arm64，21.4 MB），逐文件核对：

```
[命中] agent2api-supervisor: supervisor.json
[命中] agent2api-supervisor: AGENT2API_PANEL_PORT
[命中] agent2api-supervisor: missing enabled=0|1
[命中] agent2api-server:     AGENT2API_PANEL_HOST      ← 补丁确实在网关二进制里
[命中] bin/ui/m/mobile.js        : 已关闭 · 只监听 127.0.0.1 / 编辑路由组
[命中] share/agent2api/ui/m/mobile.js: 同上两条
```

**阴性对照**（改造前的 b276）：这些标记**全为 0** ⇒ 特异性成立。
⇒ **可安装的包里确实包含本次全部改动**（这是本地没有 cargo/xcodebuild 时能给出的最强证据）。

**★ 一个必须记下的教训：我第一次挑的标记是不可靠的。**

我最初把 `lan access = `（`set_lan` 里 `log(&format!(...))` 的一段）当标记，结果在包里**查不到**，
于是报了 FAIL。逐层查下去：

- 该字面量在源码里**纯 ASCII、确有**（`sup-main.rs` L347），且该文件在所有提交里 blob 都是
  `6f52b29093`（**从未变过**）；
- 同一 `/lan` 路径的**其它**字符串都在（`{"lan":`、`missing enabled=0|1`、`set_lan` 里
  `json!` 的键 `lan`）；
- `log()` 有真实副作用（`eprintln` + 写 `supervisor.log`），不可能被优化掉；
- 同类 `log()` 字面量（`start failed: `、`try_wait failed: `、`stopping gateway pid=`）**都在**。

⇒ 结论：**这两个 `log()` 字面量确实不在产物里，机制我没能查清**（我试过：非 ASCII 空格、
整条模板含占位符、字面量被拆成多段、字符串后缀合并、4 字节路由字面量被内联成 arm64 立即数）。
**功能影响为零**——丢的只是两行日志；开关照样落盘（写入用的键与文件名都在），
响应与错误提示也都在。

**真正的教训是我自己的**：验证时**不能拿「我以为一定在的串」当标记**，必须先用
**新旧两个包做对照**，确认「旧包无、新包有」，并且**在二进制里真的能查到**。
现在这组标记（`supervisor.json` / `AGENT2API_PANEL_PORT` / `missing enabled=0|1` /
`AGENT2API_PANEL_HOST` / 两条 UI 文案）就是逐个比对过 b276 与 b290 之后才用的。
这条已经写进 `verify-deb.py` 的注释里，避免下次再犯。

#### 记忆点 · 步骤 39（更正：token 并没有失效）

步骤 36 我把「所有 GitHub API 返回 401」判定为**凭证失效**，**这个结论下得太绝对了**。
后来用**同一个 token** 再测：`GET /user` 正常（认证为 `vbox-Ai`），读仓库、推送都正常。

⇒ 更正为：**那是一次暂时性故障**（当时 `/user` 也是 401，所以不像权限范围问题；
也可能是我连续大量请求触发的临时限制）。**教训**：拿到 401 时可以说「当前不可用」，
但不要直接下「凭证已失效」的结论；隔一段时间用最小请求（`GET /user`）复测一次再说。

**同时被这次事件验证有效的做法**：把待补内容落成**文件**（附页）而不是留在会话里 ——
即使真的推不了，内容也不会丢。这次附页最终并入了本文件。

#### 记忆点 · 步骤 40（更正：deb 是一体包 —— 只装 deb 就够；顺带解开步骤 38 那个谜）

**用户的一句话纠正了我两轮错误回答**：「我一直只装 deb，装完桌面就有图标」。查下去他对、
我错：

`control` 文件里写得明明白白：
```
Package: com.chiyu.agent2api
Description: Agent2API gateway + panel (app + launchd daemon)
Section: Applications
```
包内结构（rootless 变体）：
```
var/jb/Applications/Agent2API.app/Agent2API        253,824 B   ← App 本体
var/jb/Applications/Agent2API.app/Info.plist
var/jb/Applications/Agent2API.app/Icon-*.png
var/jb/Library/LaunchDaemons/com.chiyu.agent2api.plist        ← 守护进程
var/jb/usr/local/bin/agent2api-server  agent2api-supervisor   ← 网关 + 监督进程
var/jb/usr/local/{bin,share/agent2api}/ui/m/mobile.js         ← 面板界面（两份）
```
脚本名本来也是 `build-allinone-deb.sh`。⇒ **deb = App + 守护进程 + 网关 + supervisor + 界面，
一体**；IPA 只是「另一种装 App 的途径」（侧载 / TrollStore），**不是额外必需**。

**★ 我为什么会错，这是重点**：我说「deb 里没有 App」的依据，是 `verify-deb.py` 输出的
4 个文件 —— 而那 4 个是**我自己按文件名过滤出来的**（只挑 `agent2api-supervisor` /
`agent2api-server` / `mobile.js`）。**我从没列过整包内容。** 一个只筛自己要看的文件的
脚本，其输出**不能**用来断言「包里没有别的东西」。教训：**要先列全量清单，再做过滤**。

**deb 里的 App 就是新 App（有证据）**：

| 标记 | b276（旧 deb）| b290（新 deb）|
|---|---|---|
| `panelPort`（①e 新增：解析 `/status` 的新字段）| 0 | **3** |
| `panelBaseURL`（①e 新增：让面板跟着端口走）| 0 | **1** |

⇒ 装新 deb **同时**把 App 换新，所以 ① 也能只靠 deb 测（前提是不要另外把旧 IPA 装回去）。

**★ 顺带解开步骤 38 那个「字面量不见了」的谜**：我当时拿 `lan access = `（`log(&format!(...))`
的一段）当标记，查不到就报了 FAIL，并把机制记为「未查清」。这次查 App 二进制时发现了
**关键反例**：`/status` —— 一个**必然存在、且每次轮询都会用到**的旧字面量 —— 在 App 二进制里
**也是 0**（`/start`、`/factory-reset` 同样是 0，甚至连源码里就是拼出来的）。

⇒ 结论：**短字符串字面量可能以指令立即数（分散在 mov/movk 里）的形式编进代码，而不以连续
字节存在数据段。** 所以「按字节搜不到某字面量」**不能**推出「这段代码不在二进制里」。
这也正是步骤 38 那个现象的成因 —— 不是我的代码丢了，是我的**检索手段**不适配。

**可用的标记要满足两条**（`verify-deb.py` 注释里已写）：①新旧包对照过（旧 0、新非 0）；
②**实测在二进制里真的能查到**。这次实测可用的：`panelPort`、`panelBaseURL`、
`supervisor.json`、`AGENT2API_PANEL_PORT`、`missing enabled=0|1`、`AGENT2API_PANEL_HOST`、
两条 UI 文案；**不可用**：`/status`、`/lan?enabled=`、`lan access = ` 这类短串/插值片段。

## 附录 A · iOS 运营要点（并入自 `docs/HANDOVER.md`，该文件已删除）

> 2026-11-09 整理：原 `HANDOVER.md`（2026-11-06，`18464f4`）里的**运营类**知识并入本节，
> 它的**分析类**内容（当时的功能缺口）已由 `docs/mobile-ui/` 下三份新文档承接。
> 之所以要并进来：这些是"删掉就会丢"的东西——补丁清单、版本规则、发布流程、运行时布局、
> 排障入口，记忆点其余部分都没有覆盖。

### A.1 发布流程

```
Actions → build → Run workflow
  only    = store      # 只跑 plugins + ios + release
  publish = true       # 只有 true 才写 Release；push 触发的构建不发布
```

依次：`plugins`（编两个 iOS 插件包）→ `ios`（deb + IPA，预置插件）→
`release`（发快照 tag `ios-YYYYMMDD-b<run>`，并覆盖 `v{版本}` / `web-v{版本}` 两个插件通道）。

> **`make_latest` 只能给一个**：快照 `ios-*` 必须 `false`，`v{version}` 必须 `true`。
> 否则网关 stable 通道查 `/releases/latest` 解析不到 `v{version}`，
> 面板会显示「当前网关平台暂无插件包」。

### A.2 产物与命名契约

```
out/ios/Agent2API-<ver>-{rootless,rootful}-iphoneos-{arm64,arm64e}.deb   # 4 只，各 ~22 MB
out/ios/Agent2API-client.ipa  /  Agent2API-standalone.ipa                 # 只在 Actions artifact 里
out/packs/agent2api-providers-<pv>-aarch64-unknown-linux-gnu.zip
out/packs/agent2api-web-providers-<pv>-aarch64-unknown-linux-gnu.zip
```

命名与路径是**契约**，改动前先看上游 `update.rs` 的 `asset_name()`：

- 资产名 = `{pack_id}-{version}-{target}.zip`；iOS 上 `target` **恒为**
  `aarch64-unknown-linux-gnu`（网关的 `target_triple()` 对非 win/mac 都返回它）；
- 插件通道 tag：`v{version}`（providers）、`web-v{version}`（web）。

### A.3 版本规则（最容易错）

| 版本 | 来源 | 用途 |
|---|---|---|
| 上游 tag（当前 `v3.4.2`） | `aimod-cc/Agent2API` | 代码基线；每次构建自动取最新 |
| **`CURRENT_VERSION`** | 上游 `agent2api-server` 的 `CARGO_PKG_VERSION` | 网关自己的版本；**插件包版本必须 ≥ 它**，否则整包不加载、也装不上 |
| deb / App 的 `3.4.<run>` | 插件清单 `major.minor` + GitHub run_number | **只是构建戳**，与兼容性无关 |
| App 顶栏括号里的 sha | 本仓库提交 | 定位构建来源 |

`scripts/align-plugin-version.py` 在 plugins / ios / release 三处作业里跑，保证清单版本不低于上游 tag。

### A.4 运行时布局要点

```
程序（跟着"根"走）
  <root>/Applications/Agent2API.app
  <root>/usr/local/bin/agent2api-server          ← daemon，以 root 运行
  <root>/Library/LaunchDaemons/com.chiyu.agent2api.plist
  <root>/usr/local/share/agent2api/{ui,packs}

数据（固定，不跟根走）
  /var/mobile/Library/agent2api/                 ← AGENT2API_PROXY_HOME / HOME
      agent2api.db  server.log  plugins/
```

- **daemon 以 root 运行**（plist 不设 `UserName`）；签名用 `plugin-entitlements.plist`
  （`platform-application` + `no-sandbox` + `get-task-allow` + `skip-library-validation`）。
  曾设 `mobile` → RootHide 上建不了库，日志报 `[Storage] 数据库不可用`。
- **数据必须放 `/var/mobile`**：`.jbroot-*` 由 root 创建且名字随机，放里面既读不动、重装还丢。
- **插件预置**：deb 里带 `usr/local/share/agent2api/packs/{id}/{version}/` + `plugins.json`，
  `postinst` 拷进 `$DATA/plugins/` 并**写注册表**——注册表是网关判断"装了什么"的唯一来源
  （它不会自己扫目录）。由 `scripts/stage-plugin-packs.py` 生成。
- **机器人校验默认关**（`AGENT2API_CAPTCHA_ENABLED=0`）；面板默认只监听 `127.0.0.1`，
  真正的门槛是账号口令。

### A.5 六个补丁（0001–0005 为既有，0006 为本轮新增）

| 补丁 | 目标 | 一句话 |
|---|---|---|
| `0001-plugin-host-ios-exec-gate` | `plugin_host` | iOS 上允许 spawn 插件进程（闸门） |
| `0002-host-capabilities-endpoint` | `api/host.rs` 等 | 面板拿宿主能力表 |
| `0003-plugin-index-own-repo-and-no-rollback` | `update.rs` / `packages.rs` | 索引指向本仓库；失败不回滚只记日志 |
| `0004-plugin-store-own-repo-unsigned` | `update.rs` / `compatibility.rs` / `policy.rs` | 签名要求改为读文档字段；release 一律列全量；镜像通道不再强制验签；补齐路径放行未签名包 |
| `0005-altcha-secret-stable` | `altcha.rs` | 把 HMAC 密钥固定为进程内唯一（修"前端验证成功、服务端说无效"） |
| `0006-panel-bind-host.diff` | `server/mod.rs` | 加 `AGENT2API_PANEL_HOST`，使面板能单独钉在回环（本轮 ①c） |

打补丁是 `git apply --3way`，失败会 **fail loudly**（上游改了这些文件就要重新生成补丁）。

### A.6 排障第一步（不用 SSH）

**永远先看 Sileo 的安装日志**：`postinst` 会打印 jbroot、布局、`launchctl bootstrap` 的
原始报错、`launchctl print` 前 12 行、`ls -l $DATA`、`server.log` 末 60 行。

再看（用 Filza）：`/var/mobile/Library/agent2api/server.log` ← daemon 自己的日志（首选）。

### A.7 历史踩坑摘要（原样保留，都能复现）

| # | 现象 | 根因 | 修法 |
|---|---|---|---|
| 1 | 面板「暂无插件包」 | `/releases/latest` 被 `ios-*` 快照占用 | 补丁 0004 改为一律列全量 + 快照 `make_latest:false` |
| 2 | 下载完爆红「未通过官方签名校验」 | 镜像通道无条件验签 + 自建包无签名 | 0004 去掉该条件 |
| 3 | 「需要补齐插件 / 已加载 0 家」 | 插件版本 < 网关 `CURRENT_VERSION` | `align-plugin-version.py` + 预置 |
| 4 | CI 只有 Windows 红 | 上游 NSIS 模板缺 `RestartManager` 宏 | 改 `--bundles msi`，打包 `continue-on-error` |
| 5 | macOS 作业 1 秒被取消 | `macos-14` 标签被下线 | 三个 macOS 作业改 `macos-15` |
| 6 | iOS 被插件作业带崩 | `needs: [plugins]` + 依赖被取消 | ios `if: always()` |
| 7 | 前端"验证成功"但服务端"无效" | `altcha::secret()` 不可用时每次随机 | 0005 `OnceLock` + 幂等补写 |
| 8 | 「网关未响应 3065」 | RootHide 上 plist 写死 `/usr/local/...` | postinst 解 jbroot 并改写 plist |
| 9 | 「数据库不可用」 | 数据在 jbroot 里 + daemon 以 mobile 跑 | 数据固定 `/var/mobile`；daemon 改 root |

#### 记忆点 · 步骤 41（M0 + M1 落地：备份进度 bug + 五个小项）

**本轮做完的**（按计划 M0 + M1）：

| 编号 | 做了什么 | 契约依据 |
|---|---|---|
| **M0** | 修备份恢复进度路径：`/api/backup/restore/progress` → **`/api/backup/progress`**（输出到 `api/backup.ts` 与 `pages/backup-restore-sheet.tsx` 两处，注释一并更正） | 上游 `http.rs` 的 backup 五条路由里**没有** `restore/progress`；处理器是 `backup_api::restore_progress`。此前该请求一直 404，进度条永远停在 0% |
| **M1.1** | 设置页新增「面板账户」只读行（用户名 / 是否可登录）| 上游 `panel.rs::panel_account`：未注册只回 `{registered:false}`；否则 `{registered:true, username, loginEnabled}`。字段名与桌面端 `PanelAccount` 类型一致 |
| **M1.2** | 日志页副标题补「库内共 N 条」 | 上游 `logs_api::stats_logs` 序列化 `store.stats()`，桌面端 `LogStats = {lastId?, total?}`；`total` 是库里总量（原来的「原始记录 N 条」只是**当前筛选**的匹配数，容易被读成总量）|
| **M1.3** | 定时签到页加「立即执行一次」按钮 | 上游 `auto_checkin::run_now`：返回 `{...summary, state}`；**已有一次在执行时返回 400「签到正在执行中，请稍候」**（所以 400 要当"正在跑"提示，不是故障）|
| **M1.4** | ZCode 定时领取的**验证任务**常驻提示（轮询 + 滑块 + 回传 + 取消）| `zcode_claim_verification.rs` 用 body 的 `action` 分两个动作；协议逐字对齐桌面端 `ui/zcode-claim-verification.js`：poll `{action,clientId,ready}` / complete `{action,clientId,requestId,accountId,planId,status,param?,message?}`，`status` 四态 verified/timeout/cancelled/failed |
| **M1.5** | 签到「活动福利」段加「积分与活动」卡 | `/api/usage`（`{kind,unlimited,totalLeft,planLeft,bonusLeft}`+明细，400=无活动会话、503=需插件）；`/api/checkin/status`（归一成 `active`/`todayCheckedIn`，**无活动回 null**）|

**验证**（三项本地检查全过）：

```
pnpm exec tsc --noEmit          → exit 0
pnpm run build                  → exit 0   mobile.js 1,290.63 → 1,296.80 kB
check-mobile-ui.py --root <repo> → exit 0
```
Rust/Swift 未改动，所以不涉及 CI 第 9/16 步；手机端改动会在 CI 第 14/15 步复核。

**★ 撤销一条：A13「工具服务 API 文档」不是缺口。**

手机端文档页 `pages/DocsPage.tsx` 用的是**共享组件** `ui-shared/docs-api-browser`，
它内部调 `apiReferenceSections()` —— 其中已含 `toolApiSections`（就是
`ui-shared/docs-api-tools.ts` → `tools-api-doc.ts` 那份 Markdown，含端点/参数/错误码/示例），
还有专门的 `MarkdownArticle` 与「复制文档」按钮。**手机端本来就有这份文档。**

**★ 根因是搜索范围，不是关键词**：我只在 `desktop-tauri/mobile/src` 里搜。
手机端**大量复用 `ui-shared` 与 `ui-kit`**，所以"mobile/src 里搜不到"**推不出**"手机上没有"。
这已经是第二次同类误判（第一次是 A9 模型映射新增）。

⇒ 已把该教训写进 `MISSING-LIST.md` §H.2：**核对任何一项都要搜三处**
（`mobile/src`、`ui-shared`、`ui-kit`），并已按此**复查全部 A 项**：
除 A13 撤销外，其余缺口（短信登录、插件本地安装、请求维护三件套、精简路由、
`/api/config`、账号限流器配置、路由结构编辑）在共享层确实也没有。

**一条也顺手核实了**：A11 限流器配置在共享层有一个 `limiters` 命中，但那是
`ui-shared/assistant-read-accounts.ts` 里**给助手工具读**的段（`section==='limiters'`），
属于"读"，不是"配置界面" ⇒ **A11 仍是真缺口**。

**真缺口总数因此从 13 修正为 12。**

#### 记忆点 · 步骤 42（M2.1 短信登录落地：AutoClaw 国内版 / Loomy / Tabbit）

**为什么这一项重要**：AutoClaw 国内版与 Loomy 的账号体系**没有网页授权码** ——
官方客户端唯一的自助入口就是手机号 + 验证码。手机端此前只有「网页登录」与
「粘贴凭证」，这两家就都加不进来（而它们恰好是国内用户最常用的）。

**做成了什么**：账号页多一个入口「手机验证码登录」→ 选提供商 → 填号 → 发码 →
填码（可带备注名）→「登录并添加」；成功后账号直接落库（响应与 `POST /api/accounts`
同形，走「已添加」收尾：关面板 + 刷新列表）。

**★ 契约先核对救了一次**：`provider` 必须传 **`autoclaw`**，**不是 `workbuddy`**。
`workbuddy` 只是 `login_start` 的缺省值；通用发码端点按 `provider` 决定地区
（`autoclaw` / `autoclaw-intl`），传别家 id 会被**明确拒绝**
（上游 issue #93 的教训：以前「未知值也落国内版」，代价是把 Loomy 的号码静默
发去 AutoClaw 站点、还回成功响应）。若照抄默认值，这条链路第一次点就会 400。

**三家档案（逐条对齐桌面端 `ui/sms-login.js`，不自己发明）**

| 家 | 发码 | 登录 | 中间态字段 | 手机号规则 |
|---|---|---|---|---|
| AutoClaw 国内版 | `POST /api/session/login/sms/send` | `POST /api/session/login/sms/verify` | `deviceId` | `1[2-9]` 11 位 |
| Loomy | `.../login/loomy/sms/send` | `.../login/loomy/sms/verify` | `msgid` | `1[3-9]` 11 位 |
| Tabbit 国内站 | `.../login/tabbit/sms/send` | `.../login/tabbit/sms/verify` | `uuid` | `1[2-9]` 11 位 |

发码载荷固定带 `supportsCaptcha: true`（不带的话网关回 409 而不是 200+captcha 状态）；
被风控拦下时上游回 `{status:'captcha', captcha:{verifyUrl, message}}`，**重发要沿用
那一轮的 uuid**（否则上游当成另一次会话，刚过的验证对不上）。

**手机端两处「有意不同」**

1. **KukuAI 不做**：它的发码必须在官方页面里点（风控签名只有页面能生成），桌面端是
   壳开隐藏窗口自动填号、再读 **HttpOnly** Cookie 交回（`login/kuku/complete`）。
   手机 App 没有这套壳能力 ⇒ 归入平台不适用，硬做只会得到一条点不通的路。
2. **Tabbit 滑块验证页不自动开**：App 的 WebView **不支持 `window.open`**
   （`lib/community.ts` 里写明 Capacitor 会忽略它），同窗跳转又会把面板顶掉。
   所以给「复制验证页地址」让人用浏览器打开，滑完回来点「已完成验证，继续发送」
   —— 与桌面端打不开窗口时的兜底同一形态。**要在 App 内直接打开需要壳加一个
   openURL 桥（Swift 改动）**，记为可选后续项。

**保留的桌面端行为**：发码与登录共用一把锁（不能并点）；**冷却 60 秒且成功/失败
都进冷却**（「过于频繁」那种失败正是最该冷却的，60 是官方桌面端写死在客户端的
口径，不是猜的）；**改手机号 = 换一轮登录**（清掉中间态与风控会话）；验证码 6 位、
手机号按家正则，先在界面挡一次。

**新增/改动文件**：`api/sms-login.ts`（新）、`pages/sms-login-sheet.tsx`（新）、
`pages/AccountsPage.tsx`（加入口）。

**验证**：

```
pnpm exec tsc --noEmit          → exit 0
pnpm run build                  → exit 0   mobile.js 1,296.80 → 1,303.35 kB
check-mobile-ui.py --root <repo> → exit 0
```
未改 Rust/Swift ⇒ 不涉及 CI 第 9/16 步。

#### 记忆点 · 步骤 43（M2.2 请求记录维护三件套：预览 / 清理 / 压缩）

**做成了什么**：请求页头部多一个垃圾桶按钮 → 维护面板：
预览（命中明细 / 含报文原文 / 库占用 / 上次压缩）→ 选清理方式（全部删除 / 仅清空报文原文）
→ 输入「删除」两个字确认 → 执行；面板里另有独立的「压缩数据库」入口。

**★ 这一项的关键是"别把不可恢复的操作做错"**，所以契约核到字段级：

| 接口 | 语义（上游注释原文口径） |
|---|---|
| `GET /api/stats/requests/filters` | `{models:[…], providers:[{id,label}]}`，候选来自**明细里实际出现过的值**（已删除账号的 provider 也能筛到） |
| `GET /api/stats/requests/clear-preview` | `all`=命中明细行数、`raw`=两侧报文按 ID 去重的请求数、`upstreamRaw`/`downstreamRaw`=各侧行数、`dbBytes`=**全库**占用（不按筛选）、`vacuumRunning`/`lastVacuum` |
| `DELETE /api/stats/requests?mode=raw\|all` | `raw` 只清报文原文（保留明细与日报）；`all` 连明细一起删，**无筛选时连日报归零**；返回 `{deleted, raw, upstreamRaw, downstreamRaw}` |
| `POST /api/stats/requests/compact` | 后台 VACUUM，只表示受理：`{success,started:true}` / 已在跑 409 / 库不可用 500 |

**两条上游护栏原样照搬，没有绕开**：

1. **无筛选时必须显式带 `all=1`**（上游：「未指定筛选条件：要清空全部请求数据请显式带 all=1」）。
   桌面端做法是 `hasFilters ? 筛选 : all=1`，手机上同样。判定我写成**偏向保守**：
   只要可能算筛选就不加 `all=1` —— 那样最多被上游 400（安全失败），而不会静默全删。
   判据按上游 `FilterPlan` 的实际条件取：`model`/`provider`/`client`/`apiKey`/
   `productionOnly`/`completedOnly`/`status`/`startDate`/`endDate`。
2. **预览与执行共用同一份筛选**：`filter_from_params` 读的键与列表**同名**，
   日期是 `date_bounds` 读的 `startDate`/`endDate`（与列表完全一致）——
   所以手机上直接把列表当前的筛选对象传给两边，"预览说删 N 条"就是"删掉的那 N 条"。

**安全设计**：危险确认沿用手机端既有先例（`reset-library-sheet` 的「输入两个字确认」
+ destructive 按钮）；确认按钮的措辞按模式给出**具体数字**（「永久删除 N 条请求记录」
/「永久删除 N 条记录的报文原文」）；压缩是单独入口，明写"只回收磁盘、不删数据"。

**新增/改动**：`api/request-maintenance.ts`（新）、`pages/requests-maintenance-sheet.tsx`（新）、
`pages/RequestsPage.tsx`（加入口 + 传当前筛选）。

**验证**：
```
pnpm exec tsc --noEmit          → exit 0
pnpm run build                  → exit 0   mobile.js 1,303.35 → 1,309.78 kB
check-mobile-ui.py --root <repo> → exit 0
```

#### 记忆点 · 步骤 44（M2.3 精简路由）

**做成了什么**：模型页头部多一个入口 → 「压缩路由」面板：总开关 + 规则列表
（来源模型 / 压缩模型 / 单条启用 / 删除）+ 添加规则 + 保存。

**契约（上游 `api/compact_routes.rs` + `config/compact_routes.rs`）**

- `GET /api/models/compact-routes` → `{config:{enabled, rules:[{client,source,target,enabled}]},
  revision, clients:[{id:'zcode',label:'ZCode'}], models:[…已滤掉图片模型…], maxRules:200}`
- `PUT /api/models/compact-routes` body **`{config, revision}`**（`deny_unknown_fields`），
  成功后返回与 GET 同样的视图（所以保存完直接用返回刷新界面，不再多打一次）
- 服务端两道校验：`validate`（≤200 条、**客户端只支持 `zcode`**、来源/压缩模型非空且
  去空格后不变、≤256 字符、无控制字符、来源≠压缩、同客户端来源不可重复）
  与 `validate_models`（两个模型都必须在**当前可用模型清单**里）
- **修订号防覆盖**：`revision` 是配置 JSON 的 SHA-256；别处改过 → **409**
  「压缩路由已在其他位置修改，请重新读取后再保存；当前草稿未丢失」

**三处刻意的界面决定**

1. **不给客户端选择器**：上游目前只认 `zcode`，给一个只有一项的下拉是噪声；
   面板里直接写明"目前只支持 ZCode"，选了别家也会被服务端拒。
2. **冲突（409）不覆盖也不丢草稿**：给「重新读取并保留我的改动」——
   重新拉最新配置**只换 revision**，用户的规则原样留着，再点保存。
   既不静默覆盖别人的修改，也不用让人重填一遍。
3. **已失效的旧规则仍可显示**：上游 `validate_models` 明确允许"已失效的旧规则保留、
   关闭或删除"，所以选择器会把规则里引用但当前清单里没有的模型**补进选项**并标
   「（已失效）」——否则那条规则的来源模型会显示成空白，看起来像数据丢了。

本地校验（`validateCompactRoutes`）的文案与上游**逐条同句**，用户先看到的是同一句话。
新增/改动：`api/compact-routes.ts`（新）、`pages/compact-routes-sheet.tsx`（新）、
`pages/ModelsPage.tsx`（加入口）。

**验证**：
```
pnpm exec tsc --noEmit          → exit 0
pnpm run build                  → exit 0   mobile.js 1,309.78 → 1,315.71 kB
check-mobile-ui.py --root <repo> → exit 0
```

#### 记忆点 · 步骤 45（M2.4 插件本地包安装）

**做成了什么**：插件页多一个「从文件安装…」——选手机里的插件包（zip）→ 读成
base64 → 上传给网关 → 网关校验并安装。与「从 Release 下载」的区别只有**包从哪来**：
这里包在手机上，**装的位置仍然是网关**。

**契约（上游 `api/plugins.rs` + `core/plugin_host/packages.rs`）**

- `POST /api/plugins/install` body **`{packB64}`** → 成功 `ok_json(result)`（与启停/卸载
  同一族，桌面端就把它当 `PluginMutation`）
- **`MAX_PACK_BYTES = 24 * 1024 * 1024`**；`MAX_PACK_BASE64_BYTES = (MAX_PACK_BYTES+2)/3*4`；
  `MAX_PACK_UPLOAD_BYTES = MAX_PACK_BASE64_BYTES + 1 MiB`（给 JSON 开销留的余量）
- 失败一律 400：空包（「请求体是空的：请选择插件包 zip 后重试」）、超限
  （`pack_size_error()`）、`prepare_pack` 校验不过、`安装失败：{error}`
- 上限**不用写死**：`GET /api/plugins` 的响应里就带 `maxPackBytes`

**实现要点**：读包做成与桌面端逐条一致的两道闸门（先用 `file.size` 挡、读完再用
base64 长度挡），上限从网关读并在本地 clamp 到 96 MiB 兜底；文案沿用桌面端的
「插件包大小不能超过 {n} MiB」。手机上这一步比桌面更要紧：24 MiB 的包会变成约
32 MiB 的字符串一次性进内存，所以"读之前先拒"是必要的。

**⚠️ 一条必须真机验证的**：iOS WebView 里 `<input type="file">` 能否真的拿到文件内容
（取决于壳有没有实现文件选择回调）。**浏览器/PWA 下这条路径是确定的**，App 里要实测；
代码里已标注，不会替我下结论。

新增/改动：`api/plugins.ts`（加 `installPluginPack`）、`pages/PluginsPage.tsx`（入口 +
读包 + 双闸门）。

**验证**：
```
pnpm exec tsc --noEmit          → exit 0
pnpm run build                  → exit 0   mobile.js 1,315.71 → 1,317.22 kB
check-mobile-ui.py --root <repo> → exit 0
```

#### 记忆点 · 步骤 46（M2.6 账号限流器配置）

**做成了什么**：账号详情页多一个「限流规则」入口（副标题显示"几组生效中"）→
编辑面板：规则组（启用 / 动作 跳过|停用 / 范围 整个账号|仅列出的模型）+
每组多条条件（与前一条的关系 与|或 / 额度来源 / 模型范围 / 指标 / 比较 / 阈值 /
统计窗口）+ 命中读数 + 增删；保存写回账号。

**契约（上游 `store_crud.rs` / `store_view.rs` / `accounts_batch.rs`）**

- **读**：规则就在账号记录里 —— `limiterGroups`（新，权威）/ `limiters`（旧）。
  账号列表与快照都带着它，**不需要为读规则单独打接口**。
  旧格式用桌面端同一套换算（`groupsOf`）转成新形状。
- **写**：`PATCH /api/accounts/{id}` body `{limiterGroups:[…]}` —— 与改备注名同一条路
  （`store_crud.rs`：`patch.get("limiterGroups")` → `record.set("limiterGroups", next)`）。
  两个键同时出现时**新的胜出**；PATCH 只改传进去的键，账号其它字段不受影响。
- **实时读数**在 `GET /api/accounts/usage/snapshot`：`limiterStates`（命中与读数）、
  `quotaSources`（额度来源）、`limiterModels`（按 provider 的模型清单）。
  只读记录表、不打上游；手机端**早就有**这个接口（`fetchUsageSnapshot`），
  只是 `UsageSnapshot` 类型当初没写这三个键 —— 所以这里显式断言而不是乱改公共类型。

**两条不破坏数据的做法**

1. **改字段用展开**（`{...condition, threshold}`）：`condition.source` 是一整份额度来源
   快照，界面不认识它的全部字段、也不需要认识 —— 展开能原样带回去（round-trip 安全）。
2. **保存整组**：`limiterGroups` 是整块替换，所以面板始终持有完整草稿，不做增量提交。

**范围界定（有意的，不是砍功能）**：手机端 `AccountSheet` 原本写着"账号的凭证、
代理、限流规则都是多字段表单，编辑仍回桌面端"。这一项把**限流规则**单独做出来，
因为它最常被临时改（账号被上游限了就让它先跳过）；**凭证/代理仍留桌面端**。
条件字段与桌面端一一对应，标签/描述文案从 `accounts-limiter-model.ts` 移植
（`lib/limiter.ts`，同一批中文作为 i18n key）；若将来那份上移到 `ui-shared`，
手机端应改为 import。

新增/改动：`lib/limiter.ts`（新，移植只读换算）、`api/limiter.ts`（新，写入口）、
`pages/account-limiter-sheet.tsx`（新，编辑器）、`pages/AccountSheet.tsx`（入口 + 摘要）。

**验证**：
```
pnpm exec tsc --noEmit          → exit 0
pnpm run build                  → exit 0   mobile.js 1,317.22 → 1,329.46 kB
check-mobile-ui.py --root <repo> → exit 0
```

#### 记忆点 · 步骤 47（M2.7 路由组结构性编辑：模型 ID / 策略 / 粘性 / 成员增删 / 账号范围 / 删除）

**先评估后改**：语义评估单独成文并**先推送**（`docs/mobile-ui/M2.7-ROUTING-EDIT-EVALUATION.md`，
提交 `fb57bd1`），之后才动代码。这正是评估要回答的问题：改哪些字段会改变**真实转发行为**。

**评估的三条结论（都有源码依据）**

1. **保存后清旧模型的粘性**：`put_group` 里写死
   `if let Some(old) = old { clear_route_sticky(None, Some(&old.model)); }` ——
   即使只改了策略，进行中的会话也会重新选号。**必须让用户知道**。
2. **改「对外模型 ID」= 换入口名**：客户端请求里的 `model` 要跟着改，否则落到别的路由或不匹配。
3. **有护栏可用**：`POST /api/routing/preview` 是**无副作用**草稿预演 → 保存前先看
   「会选中谁、谁被挡、为什么」。结构性编辑唯一能"先看后改"的手段。

**实现（`PUT /api/routing/groups`，与 ② 同一接口，这次是加字段）**

- 新增可改：`model`（带显式确认 + 红字提示）、`strategy`/`sticky`（选择器）、
  成员**增删**、成员的**参与账号**白名单；并新增**删除整组**（`group: null` + revision）。
- 三条护栏落地：① 草稿从读到的对象**展开**，只覆盖动过的字段；② 面板内可直接**预演草稿**；
  ③ 改模型 ID 时确认框里明说两句（客户端改名 + 清粘性），另在改动摘要里红字再写一遍。
- 未知 `strategy`/`sticky` 取值**原样保留**（不让一次编辑把配置改掉）。
- 账号白名单用 `/api/accounts`（catalog 里没有账号 id，只有 `accountCount`）；
  「加成员」用 catalog（provider+model 唯一，已存在的自动排除）。

**★ 遗漏复查（按你的要求，每项做完都要查）**

我写了一个对账脚本，把「我写入的键集合 / 载荷键」与**上游结构体**逐字对照，并扫陈旧表述：

| 检查 | 结果 |
|---|---|
| 组对象键 = `id,name,model,description,strategy,sticky,members`（展开 + 显式覆盖） | ✅ 逐字一致（`deny_unknown_fields` 多一个键就 400，这条必须过） |
| 成员对象键 = `id,provider,model,included,accounts` | ✅ 逐字一致 |
| PUT 载荷 = `{id, group, revision}` / DEL = `{id, revision}` / PREVIEW = `{model, group}` | ✅ 与 `GroupSave`/`Preview` 一致（后者的 profile/global/needs/failFirst 有缺省，不发） |
| 陈旧表述（"都在桌面端""只做安全子集""路由组（只读）""只读成员增删"） | ⚠️ **查出 3 处矛盾表述 —— 已修**：`routing-groups.tsx` 的模块注释与页面提示仍写着"结构性编辑在桌面端"，`routing-group-edit-sheet.tsx` 的 catalog 注释含糊 |
| 护栏自检 9 项（模型确认两句 / 预演 / 展开 / 409 / 删除确认 / 未知值保留 / 成员 id 去重 / 已存在成员排除） | ✅ 9/9 |
| 三项本地检查 | ✅ tsc 0 · build 1,329.46 → 1,337.48 kB · self-check 0 |

**复查脚本自身也修了两次**：第一版用正则截断提取代码块（误报键集合不一致），第二版用括号配对
但把 JS 简写 `id, provider,` 与 `model: choiceModel` 的值当成键（又误报）——最终改成
**精确断言源码字面量**。教训：检查器本身也要对齐事实，误报会浪费在追假问题上。

新增/改动：`api/routing.ts`（预览 + 删除辅助）、`pages/routing-group-edit-sheet.tsx`（整份扩展）、
`pages/routing-groups.tsx`（接线 + 表述更新）、评估文件（未决点归档）。

#### 记忆点 · 步骤 48（M3 调研：`/api/config` 到底有什么 —— 结论：只有一项要补）

**调研结论（先核源码，不猜）**：这条接口**比名字窄得多**，不是"整份原始配置"。
`GET /api/config` 只回 5 个键，逐项判完如下：

| 键 | 判定 | 依据 |
|---|---|---|
| `sanitizeFingerprints` | **不需要** | 与 `GET /api/sanitize` 同键同值，手机端已有 `/api/sanitize`（脱敏页） |
| `apiKey` / `apiKeySet` | **不需要** | 旧版单 Key 的兼容字段；现代路径是 `/api/keys`（手机端已能管网关 Key） |
| `defaultModel` | **不需要** | 这条接口**只读**它：POST 根本不接受该键（读 `post_config` 的分支只有 apiKey 与 locale） |
| **`locale`** | **要补** | POST 接受的第二个键。它是**计费语言**（网关日志原文「计费语言已更新为 …」，由 `core::billing` 消费，决定积分/计费文案的语言）；手机端的语言开关只写 `localStorage`，**不写回网关** → 英文用户在手机上只能看到中文积分简报 |

**另一条旁证**：桌面端**没有任何文件**用 `/api/config`（桌面走各自的细粒度端点），
所以这条接口只服务旧客户端兼容与上面那 5 个键 —— 这也解释了为什么它长得这么"窄"。

**做了什么**：设置页「外观与语言」里新增一行**计费语言**——
`GET /api/config` 读当前值、`POST /api/config` 只发 `{locale}` 写回，保存后以后端回读为准。
界面上与「界面语言」明确区分：界面语言只改这台手机的文案，计费语言决定网关（插件侧）
返回的积分/计费文案用哪种语言。

**★ 刻意的保守做法**：POST 里的 `apiKey` 分支会**真的动 Key**（`null` = 删除），
所以写语言时**只发 `locale` 一个键**，绝不顺手带其它键 —— 这一点写进了 `api/config.ts` 的注释，
复查里也专门核了载荷。

**遗漏复查**：路由确实存在（`http.rs` 里 `/api/config` 同时挂 GET 与 POST）✓；
载荷只含 `locale` ✓；网关值不在界面语言清单时**原样列出**（不让它显示成空白）✓；
新增 i18n 键无占位符参数（自检通过）✓。
三项本地检查：tsc 0 · build 1,337.48 → 1,338.79 kB · self-check 0。

新增/改动：`api/config.ts`（新）、`pages/SettingsPage.tsx`（计费语言一行）。

**至此 12 条真缺口全部收口**：11 条实现 + 1 条（A7）经调研后只有其中的 `locale` 一项需要补，
其余三项有据地判定"不需要做"。剩下的是 M4 明细核对（签到计划 extras、助手子项）——那两项
属于"同一功能两侧都有、手机上可能只用了部分字段"的逐页比对，不是缺失。

#### 记忆点 · 步骤 49（M4 字段级核对：签到计划 extras 与助手子项 —— 结论：都已够用，只余一个界面取舍）

**方法**：不看文件名看**能力面** —— ① 用上游接口契约列字段；② 逐端点比两侧的 URL 集合；
③ 再看界面入口是否真的接上（api 里有没有函数 ≠ 界面上能不能用）。

**签到计划（原 E3）——已覆盖，且手机端字段面更宽**

- 上游保存接口的注释只列了 `{id?, label?, enabled?, time?, providers?}`，而手机端 `SchedulePatch`
  还有 `timeEnd` / `providerTimes` / `retryTime` / `retryGapMinutes` —— **比注释列的多**。
- 桌面端 `checkin-schedule-extras.tsx` 的"附加项"是**保活模型**与**出行时刻**；
  手机端把它们放在**地区设置**里（`saveKeepalive` / `saveTravel` / `runTravel` 三个函数在
  `CheckinRegionSettings.tsx` 里都有界面入口）⇒ **功能在，落点不同**。
- 这个"落点不同"值得记：只看文件名会以为缺了 extras，实际是同一能力换了容器。

**助手（原 E9）——端点面完全一致，只差一个界面取舍**

- 两侧 `/api/assistant/*` 端点集合**逐条相同**（chat / config / images / images/files /
  sessions / sessions{fork} / sessions{title}）——**桌面没有手机缺的端点**。
- 手机端机械核对到的能力：回放（`replay`）、分叉（`fork`）、历史、停止生成、删除整条对话 ✓。
- **唯一差异**：桌面的 `assistant-message-operations.ts` 提供**消息级操作**（编辑/删除/重新生成
  **某一条**消息），手机端没有 ⇒ 记为**可选**（不是缺失：端点一致，是窄屏界面取舍），
  已列入 `PLAN-MISSING-ITEMS.md` 的「## 可选（桌面端有、手机端有意不做）」章节。
- **顺手更正一个数字**：我当初写"桌面 39 个助手文件"，实测 **21 个**（手机 14 个）——
  那个数记大了，已在 `MISSING-LIST.md` §E 里划掉更正。

**这一步的方法教训**：核对"有没有"时，**命中数/文件数这类数字也要复核**。
我这次是靠重新枚举文件清单才发现 39 那个数是错的 —— 数字错了会让后续判断全建在错前提上。

**三项本地检查**：本轮只改文档，无代码改动；上一轮代码（M3）的三项检查已过。

#### 记忆点 · 步骤 50（M5：为窄屏重做「消息级操作」+ 一次判错的更正）

**先更正上一轮的错误结论**：步骤 49 里我写「手机端没有消息级操作」——**错的**。
它一直都在：由**共享组件** `ui-shared/assistant-message-actions` 渲染，
**桌面与手机是同一个组件**，提供 编辑 / 删除 / 分叉；手机端 `AssistantPage.tsx` 的
`operateMessage(bubble, 'edit' | 'delete' | 'fork')` 也已接好（编辑改内容 → 重建列表 → 持久化；
删除走共享的 `removeAssistantMessage`；分叉先持久化再 fork）。

**错因（第三次同类）**：我只搜**中文 UI 文案**（"重新生成""编辑消息"…），
而实现用的是**英文 action 名**。教训升级：核对"有没有"时，
**关键词必须同时覆盖：UI 文案、实现里的标识符、端点路径**——三者任缺一个都会漏判。

**但需求本身成立**：那个共享组件是**按桌面端做的** —— 三个 15px 纯图标小按钮
（`size='icon-sm'`、无文字、只有 `title`），常驻在每条消息下。手机上：
触屏没有 hover 所以 `title` 永不显示（只能猜图标）、点击区约 28px 低于触屏习惯的 44px
（编辑与删除还相邻）、每条消息挂三个按钮把聊天内容挤得很碎；编辑用的是居中 `Dialog` + 10 行文本域。

**做了什么**（不动共享组件 ⇒ 桌面端零影响）：新增
`components/MobileMessageActions.tsx`，把交互改成**手机形态**：
- 入口收成**一个「⋯」**（不再三个裸露图标），
- 点开是**底部动作面板**，四项都带文字与图标、整行可点（≥52px）：
  复制正文 / 编辑 / 从这条分叉 / 删除（红色），
- **编辑改到底部面板**里（`Sheet` + 文本域），不再是居中小窗，
- 语义与共享组件**完全一致**（编辑/删除/分叉的行为、删除的关联工具结果确认文案都照旧），
  另加了手机端常用的**复制正文**。

`AssistantPage.tsx` 两处调用（用户气泡、助手气泡）换成新组件。

**遗漏复查（本项）**：
- 换掉调用后**共享组件的 import 变成未使用**（tsc 不报，因为那是死代码不是类型错误）——
  复查抓出来并已清除 ✓；
- 确认共享组件**仍被桌面端使用**（`assistant-messages.tsx`）⇒ 没有变成死代码 ✓；
- 我用的 5 个图标名（copy/edit/trash/share/chev）在手机端图标集里都存在 ✓。
三项本地检查：tsc 0 · build 1,338.79 → 1,338.94 kB · self-check 0。

新增/改动：`components/MobileMessageActions.tsx`（新）、`pages/AssistantPage.tsx`（换用 + 清 import）。

#### 记忆点 · 步骤 51（助手本地图片/文件：手机端本来是完整的；我判错一次，并修掉两处真窄）

**问题**：助手支持发本地图片和文件吗？手机版优化过没有？

**结论（先回答）**：**支持，而且手机端是完整的** ——
- **图片**：走多模态内容块 `{type:'image_url', image_url:{url}}`（不是自定义字段，模型侧本来就能看见）；
  上限 6 张 / 单张 10 MiB / 桌面端同口径；超过 1600px 或体积偏大时用 canvas 重编码（webp，**只在更小时才用**）。
- **文本文件**：读原文 → 每轮请求带「元信息 + 顶层字段 + 前 1200 字符」→ 全文由
  **`read_attachment` 工具分页读取**；这三件事都在**共享层**（`ui-shared/assistant-files.ts`、
  `assistant-account-import-tools.ts`），两端同一套。

**★ 我先判错了一次（同类第四次）**：我说「手机端缺 `read_attachment` 工具」——**错**。
它通过共享工厂注册在 `lib/assistantTools.ts`：`const readAttachment = createAttachmentReadTool(t)`
并放进 `ASSISTANT_TOOLS`。错因：我搜的是字面量 `read_attachment`，而手机端引用的是**工厂产物** `readAttachment`。
⇒ 教训再收紧：**共享工厂的产物名 ≠ 工具 id 字符串**；核对「有没有某能力」时要沿**工厂函数名**一起搜。

**但两处「真窄」确实存在，已修（纯手机端）**：

| 问题 | 旧行为 | 现在 |
|---|---|---|
| **图片类型被硬限制**（两道：选择器 accept + `prepareImage` 白名单） | 只收 PNG/JPEG/WebP ⇒ **iPhone 默认拍照是 HEIC，用户在手机上根本选不了自己的照片**（桌面端是 `image/*`，所以只在手机端暴露） | 只按 `image/` 前缀判断；解不开的格式给**可读原因**（提示转 JPEG/PNG），而不是一律拒绝 |
| **文本文件只收 `.json`/`.info`** | `.txt`/`.md`/`.csv`/`.log` 附不上，而底层管线本来就是通用的 | 放宽到 **14 种纯文本扩展名**；二进制仍被两道挡住（扩展名不在表里不收 + `\u0000` 嗅探）；刻意**不含** `.env`/`.pem`/`.key` |

**一处刻意的结构性做法**：`accept` 与判定**同源于一个 `TEXT_FILE_EXTENSIONS` 常量**
（页面用 `accept={ATTACHMENT_ACCEPT}`，不再硬编码），所以"可选类型"与"实际判定"**结构上不可能漂移** ——
这类不一致的典型症状是「选了文件却什么都没发生」，很难查。

**★ 检查器自身翻车四次（本轮最花时间的地方）**：我先想用正则比对 accept 取值，
被 `.map()` 生成式写法骗过；改用构建产物 grep，又被 **minify 把字符串拆开**骗过。
最后改成**结构性断言**（accept 与判定是否同源同一个常量）——它不依赖取值形态，反而更强。
**教训**：检查器被生成式/压缩后的代码骗到时，**换断言层次**（结构 > 取值），别在同一层反复调正则。

**遗留（已写进 PLAN §可选）**：**桌面端**文本附件仍只收 `.json`/`.info`（本轮范围是手机端未改）；
要统一的话，把手机端那张 `TEXT_FILE_EXTENSIONS` 上移到 `ui-shared/assistant-files.ts` 两端共用。

三项检查：tsc 0 · build 1,338.94 → 1,339.23 kB · self-check 0；结构性断言 7/7。
