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
