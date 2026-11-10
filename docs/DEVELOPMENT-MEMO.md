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

#### 记忆点 · 步骤 52（U1：修两处面板破版 —— 账号页头部竖排 + 助手输入区）

**问题来源**：真机截图。①账号页标题「账号」与副标题被挤成**一字一行**、右侧 5 个按钮溢出屏幕；
②助手页输入区**看不到「+」**且输入框占了近半屏。

**① 账号页头部（根因确定，不是玄学）**：`.m-head-actions` 在面板样式表里**一条规则都没有** ——
`PageHead` 渲染出的这个容器没有 `flex-wrap`、也没有宽度约束，5 个按钮按内容撑开，把左侧标题区
压到只剩一个字宽 → 文字逐字换行。修法（`styles/mobile.css`）：
   · 标题区 `flex: 1 1 0; min-width: 0`，标题/副标题 `nowrap + 省略号`（一行读得完胜过竖排）；
   · 动作区 `flex-wrap: wrap` + **`max-width: 62%`** —— 只靠 flex 收缩时标题仍可能只剩省略号，
     这条给标题兜底份额，按钮改为换行（账号页 5 个会排两行）。
**风险已核**：全应用 `PageHead` 的标题都在 **2–6 字**（「账号」「转发设置」「自定义提供商」…），
所以 nowrap 不会截坏任何一个标题 ✓。

**② 助手输入区**：代码里「+」**是存在的**（`size='icon-touch'` = 36px 圆形），所以属于
"渲染出来但看不见 / 高度不受控"，而我**无法在本地真实渲染**去分辨是配色还是布局。
**处置（关键取舍）**：不猜，改成**把几何写死**——`+` 明确 34×34 圆形 + 边框/底色/前景色 + 图标 18px；
输入框明确 `height/minHeight: 36`、`maxHeight: 120`、`textAlign: left`、`appearance: none`。
这样"看不见/过高"两个症状都变成**确定性**的，不再依赖共享 ui-kit 的默认值（可能是版本差异或样式未命中）。

**遗漏复查（本项）**：CSS 括号平衡 54/54 ✓；CSS 类名与 `PageHead` 渲染的 DOM 一致 ✓；
`+` 尺寸、图标尺寸、输入框三项几何、左对齐都在 ✓；**回车发送 / Shift+回车换行 / 粘贴附图 /
附件 accept 常量** 全部未被破坏 ✓；动作区上限不会影响"无动作区"的页面（那些页面标题拿满宽度）✓。
三项检查：tsc 0 · build 1,339.23 → 1,339.52 kB · self-check 0。

改动：`styles/mobile.css`（页头规则）、`pages/AssistantPage.tsx`（输入区几何）。

**待做（同一批 UI 需求，用户已提）**：U2 底栏改悬浮胶囊 + 网关状态小胶囊（状态配色）+ 出错弹小日志窗；
U3 顶部改**悬浮版本胶囊（左）+ 悬浮圆形图标按钮（右）** —— U3 在**原生 Swift**（`PanelViewController.swift`），
要重新出包，CI 的 iOS 作业即编译证据。

#### 记忆点 · 步骤 53（U2：底栏改悬浮胶囊 + 状态胶囊与出错小日志窗）

**目标（用户真机截图 + 口述）**：底栏做成截图里那种**悬浮胶囊**；网关提示做成**小胶囊**、不同状态
不同颜色；**出错直接弹一个小日志窗**。

**① 悬浮底栏：一个容易漏掉的约束**
`.m-tabbar` 原本是 `.m-app` 的 flex 子项（`flex: none`），自己占一条高度，所以滚动容器**不需要**
底部留白。改成 `position: fixed` 之后它**脱离布局流** → 内容会一直排到屏幕底、被胶囊盖住最后一截。
所以这次同时加了同高的占位块 `.m-tabbar-gap`（**留在流里**）：视觉上悬浮、布局上仍占位，
两边的滚动条一行都不用改。占位块与胶囊在**同一个组件、同一个 fragment** 里返回，
并且都在两个 `return null` 分支之后 —— 三者必须同生同灭（复查专门核了这一点）。

**同权重胜负问题**：`.m-tabbar` 在**共享 ui-kit 的样式表**里也有同名规则，同权重时谁赢取决于
两个样式表的**导入顺序**。所以覆盖规则加了 `.m-app` 前缀把权重抬上去 —— 形态不该由导入顺序决定。

**② 状态胶囊 + 出错弹窗（`components/StatusCapsule.tsx`，新）**
- 只保留**两种真有信息量**的状态：**已离线**（琥珀）/ **网关已停止**（红）；正常时**不显示**
  （常驻一个"运行中"胶囊只是噪音）。
- 数据来源分两路：离线状态来自 `usePwa()`；网关状态来自**原生桥**的 supervisor（跨端口 fetch 会被
  CORS 拦，只能走桥）。**桥不存在就永久停手**（`setBridgeMissing(true)`）——浏览器/桌面面板上不显示
  这一条，而不是显示一个猜出来的状态。
- 出错：订阅与轻提示**同一条 `toast`**（比较对象身份避免重复触发），`tone === 'err'` 时**直接开窗**，
  窗里同时给「本次会话记录到的错误」与「网关侧 `level=error` 日志」（`GET /api/logs?level=error&limit=20`，
  字段名照 `ui-shared/logs` 的 `LogQuery` 契约），底部给「打开日志页」。
  这样做的理由：toast 3.5 秒就没了，错误常被下一条顶掉、来不及看。

**③ 顺带清掉前提已消失的样式**：离线提示改为胶囊后，`.m-notice-top` 的三条规则与三条
`.m-app[data-offline='true']` 内边距覆盖全部删除 —— 那三条的前提是"顶部有一条通栏、它吃掉了安全区，
所以页面标题不用再让一次"。胶囊是在流里、自带外边距、**不再吃安全区**，留着覆盖反而会把标题挤住。
删除时写了注释说明为什么一起删（否则下一个人看到 `.m-notice-top` 会以为还有人在用）。

**★ 一次真实的类型错误（值得记）**：我凭记忆写了 `import { fetchSupervisorStatus }`，tsc 直接报
「no exported member」。真相是 `supervisor.ts` 导出的是 **`supervisorStatus`**，而 `SettingsPage` 里
用的是**别名导入**（`supervisorStatus as fetchSupervisorStatus`）—— 我把"调用点的别名"当成了"导出名"。
**教训**：不要凭记忆写导入名，**照现有调用方的 import 行抄**（那行里同时有真名与别名）。

**遗漏复查（本项）**：占位块与胶囊同生同灭 ✓；死样式已清（真正的 `.m-notice-top` 规则数 = 0）✓；
顶部只剩一个提示（别处没有第二处离线提示）✓；`logs` 路由存在 ✓；日志查询用契约字段 ✓；
两个 ❌ 都是我检查器的误报（子串命中了注释与新组件自身），已用精确断言复核 ✓。
三项检查：tsc 0 · build 1,339.52 → 1,341.81 kB · self-check 0。

改动：`components/StatusCapsule.tsx`（新）、`components/PwaNotice.tsx`、`components/Shell.tsx`、
`styles/mobile.css`。

**待做**：U3 顶部改悬浮版本胶囊 + 悬浮圆形图标按钮（**原生 Swift**，`PanelViewController.swift`），
需重新出包；CI 的 iOS 作业即编译证据。

#### 记忆点 · 步骤 54（U3：原生顶部改悬浮 chrome + 状态条改小胶囊）

**先澄清一件事**：用户看到的顶部那条不是网页，是 **UINavigationBar**（标题 = 构建戳，
右上 `rightBarButtonItem` 在「桌面面板/手机面板」之间切换）。所以这条要动 **Swift**
（`agent2api-ios/app/Agent2API/PanelViewController.swift`），且**必须重新出包**。

**★ 关键取舍：只改外观，不藏导航栏**
导航栏负责**安全区与内容避让**（`viewWillAppear` 里就是靠它把 Web 内容顶开的）。若把它藏掉
再自己铺一层浮层，Web 内容会钻到刘海/状态栏下面。所以这里只把导航栏**外观改成透明**
（`UINavigationBarAppearance.configureWithTransparentBackground()`），把
`titleView` 换成版本胶囊、`rightBarButtonItems` 换成两枚圆形图标按钮（`iphone` /
`desktopcomputer`）——避让逻辑一行不动，风险远小于自绘浮层。

**顺带修掉一个旧手感问题**：原来那枚按钮是 `toggle`，点同一面也会重载页面；
新实现 `switchPanel(desktop:)` **幂等**（`guard showingDesktop != desktop else { return }`），
并且**当前显示的那一面会高亮**（图标按钮没有文字，用配色区分）。

**状态条：底部 170px 黄条 → 顶部小胶囊**
- 形态：整圆角 + 半透明底，高度由内容撑开（`greaterThanOrEqualToConstant: 36`），
  文字**两行封顶**（原来给到 12 行，十几行的诊断串会把面板压掉）；
- **位置改到顶部**：底部要留给面板自己的**悬浮标签栏**（U2 刚做的），两者不能再叠在一起；
- **点胶囊弹小窗**看完整日志（`UIAlertController`，含「重试」「关闭」）——这就是用户要的
  "小小的胶囊提示 + 有错误就弹一个小日志出来"；
- 「重试」按钮仍留在胶囊里（不强迫用户先开窗）。

**★ 一个为了让改动面最小而做的设计（值得复用）**
"按状态配色"需要知道当前状态文本，而那段文本是在 **8 个不同调用点**分别赋给
`statusLabel.text` 的。逐个加色调参数会显著扩大 Swift 改动面，而 **Swift 在本地编译不了**，
每轮验证都要等一次完整 CI 构建。于是做了一个 6 行的 `ToneLabel: UILabel` 子类：
**在 `text` 的 `didSet` 里回调**，配色逻辑收在一处（`applyTone(for:)`），**调用点一行都没改**。
判据只用现有文案里稳定的几个词（失败 / 错误 / `— JS —` / `— supervisor —` / 正在启动），
并在注释里写明这是折中、将来可以改成从调用点显式传色调。

**★ 一次真实的自我误删（复查抓到）**
我替换 `viewDidLoad` 时**顺手删掉了 `if PanelViewController.backend == .embedded { startEmbeddedGateway() }`**
——那是内嵌形态启动网关的唯一入口，删了就是**功能回归**（App 装上永远起不来网关）。
复查的第 ② 项（"误删检查"：逐个核对 viewDidLoad 里原本有的调用是否都还在）把它抓出来了，
已补回。**教训**：替换整段初始化代码时，要**逐行核对"原来有的调用还在不在"**，
不能只看"我加的东西进去了"。

**静态复查（Swift 编译不了时的替代手段）**：残留引用 0（`toggleDesktopPanel` /
`rightBarButtonItem` 全清）✓；viewDidLoad 里 8 个原有调用都在 ✓；`{}` 215/215、
`()` 469/469 平衡 ✓；`statusBar` 高度约束只有一处 ✓（不会两处打架）；
用到的 UIKit 符号在 iOS 15 目标下均可用 ✓；9 条关键语义全保 ✓。
**编译证据来自 CI 的 iOS 作业**（本机无 Xcode，不能声称"编译通过"）。

改动：`agent2api-ios/app/Agent2API/PanelViewController.swift`。

**U1–U3 至此全部完成**，等待一次发布出 deb（用户要求尽量少构建：本推送触发的那次构建即编译证据，
通过后再发一次发布构建）。

#### 记忆点 · 步骤 55（云同步「点了没反应」：两条根因 + 修法）

**真机反馈**：填好坚果云信息 →「测试连接」**提示成功**，但「保存设置 / 读取远端 / 上传到云端 /
从云端恢复」**全都没反应**；关掉面板再打开，**又回到没填写的状态**。

**先记一条好消息（U3 的编译证据）**：`34f9cfa`（U3 原生改动）的推送构建 **completed/success**，
iOS 作业成功编译了 `PanelViewController.swift` —— 本机没有 Xcode，所以这正是我要的编译证据。

**根因（两条，都是契约读出来的，不是猜的）**

**R1 = 起因：保存被「同步密码」必填挡在接口之前。**
`api/cloud-sync.ts` 顶部的契约注释写得清楚：**`syncPassword` 在保存时是必填的（首次配置必须给）**。
`save()` 的第一件事就是 `if (!form.syncPassword && !settings?.hasSyncPassword) throw ...` ——
**在调 `PUT /api/cloud-sync` 之前就抛了**。用户以为"填了坚果云信息就够了"，所以保存从未成功。

**R2 = 放大：所有失败只写进行内一行 `ErrorNote`，而且它在表单顶部。**
用户在**下面**填字段、点**下面**那排按钮，报错却出现在**上面**的视野之外 → 表现成"点了没反应"。
另外 `upload` / `download` 有 **`dirty` 守卫**（表单改过但没保存 → 直接 `setError` 后 `return`），
所以四个按钮是**同一条链上的四种失败**，全都被这行看不见的小字吞掉。

**为什么"测试连接"偏偏成功（这条最关键，也是误导来源）**：按契约 `POST /api/cloud-sync/test` 用
「已存密文 + 本次输入明文」拼临时设置、验证可达并**创建远端目录** —— 它**不需要同步密码**。
所以"测试成功 ≠ 配置可用"，而界面从没说明这一点。

**"重开又空白"不是第二个 bug**：因为保存从未成功，`GET /api/cloud-sync` 自然回空 ✓
（`applySettings` 的回显逻辑本身是对的：把 `webdav.baseUrl` / `username` 等逐字段填回表单，
密码类字段按契约留空=沿用旧值）。**这条我特意核实过**，避免只治症状、留下真的持久化问题。

**修法（都在同一文件，直击症状）**
1. `run` 的 catch：除写行内 `ErrorNote` 外**同时弹即时提示**，并把行内那条**滚动到可视区**
   （`errorRef.scrollIntoView`）—— 失败必须**当场**被看到；
2. 新增 `fail(message)`，让两处 `dirty` 守卫与失败路径**同一套可见性**（行内 + 提示 + 滚动）；
3. 未保存时把「上传到云端 / 从云端恢复」**直接置灰**，并就地说明「先点上面的『保存设置』」——
   把"点了没反应"变成"看得到为什么不能点"；
4. 界面补两条说明：**操作顺序**（填好 → 保存 → 再读取/上传/恢复）与**「测试连接」的语义**
   （只验证可达、不保存、不校验同步密码）。

**遗漏复查**：`errorRef` 已接到渲染处 ✓；`setError(t(` 后静默 return 的旧写法**无残留** ✓；
`useRef` 已补进 import ✓；三项检查 tsc 0 · build 1,341.81 → 1,342.90 kB · self-check 0 ✓。

**★ 又一次我自己的脚本 bug（值得记）**：等待发布的链式脚本崩在 `os.fdopen`，报
`UnboundLocalError: cannot access local variable 'os'` —— 因为我在 `api()` 函数体里写了一句
`import os`，Python 因此把 `os` 视为**整个函数的局部名**，而它在前面 `os.fdopen` 处还没被赋值。
**教训**：不要"就地"补 import；要么顶部统一导入，要么用别名（`import os as _os`）。
本次崩溃发生在"发发布构建"这一步之前，**没有把包发出去**，无副作用。

**改动**：`pages/cloud-sync-sheet.tsx`。

#### 记忆点 · 步骤 56（U4：助手设置缺口 —— 契约当尺子量出五项没入口）

**用户直觉是对的**："助手这边只有简单的模型选择，没有桌面面板那些设置功能"。

**取证方法（这次没走弯路）**：不再靠搜界面文案（那已经被证明会漏判四次），
改**拿契约当尺子** —— 把 `AssistantConfig` 的字段逐个对齐手机端有没有入口：

| 契约字段 | 手机端现状 | 结论 |
|---|---|---|
| `model` / `apiKeyId` / `titleModel` / `titlePrompt` | 已有入口（模型选择器 / Key 选择 / 标题设置面板） | ✅ 不缺 |
| `reasoning`（思考等级） | 无 | ❌ 补 |
| `mode`（变更前确认 / 完全访问） | 无 | ❌ 补 |
| `systemPromptEnabled` + `systemPrompt` | 无 | ❌ 补 |
| `tools`（工具勾选表） | 无 | ❌ 补 |

**一处容易搞混的地方（值得记）**：手机端**早就有一页叫「系统提示词」**（`pages/PromptPage.tsx`），
但那是**网关侧**的提示词装配（模式 / 正文 / 分提供商 / 网关装配），**不是**助手注入的那条
`systemPrompt`。两件同名不同物，差点被我当成"已经有了"。

**实现**：新增 `components/AssistantSettingsSheet.tsx`（底部面板），三块与桌面抽屉对齐：
思考等级（**跟随模型** + 8 档有序列表）、权限模式（两档）、系统提示词（开关 + 编辑 + 恢复默认）、
工具（逐条开关 + 全选 / 全不选 + 已勾选计数，按 `kind` 标注只读 / 改动 / 执行）。
入口放在助手页页头（「清空」旁边那枚齿轮）。

**两条刻意的对齐**
1. **取值域照抄后端**：`['off','none','minimal','low','medium','high','xhigh','max']` —— 桌面端注释写明
   这组档位与后端 `model_rules::REASONING_LEVELS` **逐字一致**、且只在前端写死这一份；
   我沿用同一约定并在注释里说明，**不自己发明档位**。
2. **保存语义与桌面一致**：**改动即时保存**（没有「保存」按钮），只有系统提示词正文在弹层里编辑、
   弹层自带取消 / 保存；每次保存拿**服务端回读**的那份覆盖本地（输入区胶囊读同一份配置）。

**复查**：五项字段在实现里都有落点 ✓；档位常量**单点写死**（1 处）✓；面板已接进页面 ✓；
入口按钮 ✓；保存走共享 `saveAssistantConfig` ✓；**模型选择器未被破坏**（仍在渲染 ✓）✓；
三项检查 tsc 0 · build 1,342.90 → 1,348.56 kB · self-check 0 ✓。

**★ 又一次检查器误报**：我用 `'AssistantModelPicker open='` 判定"模型选择器是否还在"，报了 0 处
—— 因为 JSX 里标签名与 `open=` **不在同一行**。改用正则 `<AssistantModelPicker\s` 才判对。
**教训同上**：检查器要按**语法结构**判定，不要按"同一行里出现的字面串"判定。

**改动**：`components/AssistantSettingsSheet.tsx`（新）、`pages/AssistantPage.tsx`（入口 + 渲染）。

#### 记忆点 · 步骤 57（首页 / 助手页右上角那两枚圆形按钮：为什么"点了没反应"）

**用户问**：首页和助手页右上角各有一个圆形按钮，是干嘛的？点了好像没反应。

**查证结果（两枚是不同按钮，各自有不同成因）**

| 页面 | 按钮 | 真实动作 | 为什么像"没反应" |
|---|---|---|---|
| 首页 | **刷新** | `store.refresh(true)` | `refresh()` 开头有守卫 `if (packaged && !server) return` —— **打包形态且未选服务器时直接返回、什么都不做**；而且刷新过程**没有任何可见反馈**（按钮不转、也不提示），即使真刷新了也看不出来 |
| 助手页 | **清空**（图标却是 `refresh`）| `clear()` 清空当前会话 | 图标是**环形箭头**（"刷新"的造型），与动作对不上 → 认不出来；而且**空会话时按钮是禁用的**（`!bubbles.length`）→ 点了确实什么都不发生；清空本身也**没有提示** |

**修法**
1. **首页**：`canRefresh = !(packaged && !server)` —— **做不到就不显示**（本页本来就有下拉刷新，不会因此少一个能力）；
   刷新中按钮**转起来**（复用下拉指示器那套 `m-ptr-rotate` keyframes，不另写动画），
   刷新结束且无错时弹一条「已刷新」；失败时页面本来就有 `ErrorNote`，所以只在没出错时提示。
2. **助手页**：图标 `refresh` → **`trash`**（语义对上）；`clear()` 里加一条「已清空当前会话」提示
   （它是纯本地重置，原来生效了也看不出来）。

**★ 又一次类型错误（我自己的）**：给首页加按钮时我把 `Button` 加进了 `../components/ui` 的导入，
tsc 报 **`Duplicate identifier 'Button'`** —— 因为 `Button` 在手机端的 `components/ui` 里
**既没导出、也另有来源**（`@ui`），而首页本来就导了它。
**教训**：加导入前先看这个文件**已有**的导入（尤其同名组件可能来自另一个包）；
"我加的是同一个名字"在 TS 里是重复声明，不是覆盖。

**复查**：`IconButton` 在首页已无残留引用（0 处，不留死导入）✓；`canRefresh` 与提示都在 ✓；
清空按钮段内确认是 `trash`、且该文件已无 `refresh` 图标 ✓；清空提示 ✓。
三项检查：tsc 0 · build 1,348.56 → 1,349.03 kB · self-check 0 ✓。

**改动**：`pages/HomePage.tsx`、`pages/AssistantPage.tsx`。

#### 记忆点 · 步骤 58（U6：真机四条反馈 —— 状态胶囊位置、底栏悬浮、顶部精简与单图标、去掉横条）

**用户装上 b325 后的四条反馈**，逐条对照代码找到成因（不是照着感觉调）：

**① 状态胶囊移到「底栏上方」+ 更长 + 「重试」错位**
U3 里我把它放到了**顶部**，这次按要求挪回**底部、并抬到悬浮标签栏之上**：
`bottomAnchor = safeArea.bottom - tabBarClearance(72)`（72 ≈ 标签栏 56 + 离安全区 8 + 间隙 8；
原生量不到 Web 里的 CSS 变量，所以这份数值只能在原生侧再写一遍，注释里写明了这一点）。
「更长」是把 `trailing` 从 **lessThanOrEqual 改成 equal**（原来胶囊长度随文字忽长忽短）；
「重试错位」的真因是**两行文字**：文字换行后按钮虽仍垂直居中，视觉上却与第一行不齐 ——
改成**单行 + 截断 + 固定高度 40**，按钮与文字落在同一条基线上（完整诊断串仍点开小窗看）。

**② 底栏要"整个悬浮"，不要"背景还有个框架"**
两处原因，都改了：
· 我那圈 `box-shadow: …, 0 0 0 1px var(--m-line)` 的**描边**让整条看起来像"被框住的底栏" → 去掉，只留投影；
· 底色从 86% 不透明改到 **68% + `blur(24px) saturate(1.6)`** —— 悬浮感的前提是**能看见内容从它下面经过**。
占位块保留（否则内容会被胶囊盖住最后一截），它本身透明，不构成"框架"。

**③ 顶部左边只要精简版本号**
新增 `shortStamp` = `v` + `CFBundleShortVersionString`（即 `v3.4.325`）；完整构建戳（含 sha 与构建时间）
**保留在 `buildStamp` 里**，点状态胶囊能在小窗看到 —— 排查用信息不必常驻在顶栏。
⚠️ 这次编辑里我**误改了一个 Info.plist 键名**（`A2ABuildNumber` → `AABuildNumber`），复查第①项（残留引用）
把它抓出来了：那会让构建号静默变成 `?`。已修回。**教训**：改这类"照抄键名"的代码时，
键名要**逐个字符对**，别顺手重写整行。

**④ 顶部右边只要一枚图标（表示"要切过去的那一面"）+ 不要底层横条**
· 两枚并排 → **一枚**：图标与无障碍标签都表示**目标面**（在手机面板时画桌面图标，反之画手机图标），
  动作 `togglePanel` 取反切换；`switchPanel` 里改为调用新的 `updatePanelButton()`（名字从复数改单数，
  旧名 `updatePanelButtons` / `showMobilePanel` / `showDesktopPanel` 已全部清掉，复查确认 0 残留）。
· **横条**：只调 `configureWithTransparentBackground()` 不够 —— 还得显式清
  `backgroundColor` / `backgroundEffect` / `shadowColor` / `shadowImage`，并且**在导航栏与 navigationItem
  两处都设**（不同滚动态取的不是同一份），再补 `bar.isTranslucent = true` 与空背景图。

**复查（Swift 改不了本地编译，静态能查的都查了）**：旧符号残留 0 ✓；新符号 7 个全部有定义 ✓；
9 条关键语义 8 条直接通过、第 9 条（"只留一枚按钮"）先是**我检查器把函数定义也算成调用**导致的误报，
改用带引号的调用点判定后确认**恰好 1 个**（定义另 1 个）✓；括号 215/215、470/470 平衡 ✓；
四个改动的函数各只有 1 处定义（无重复片段）✓。
面板侧三项检查：tsc 0 · build 1,349.03 kB · self-check 0 ✓。

**改动**：`agent2api-ios/app/Agent2API/PanelViewController.swift`、`desktop-tauri/mobile/src/styles/mobile.css`。

#### 记忆点 · 步骤 59（U7：助手设置补齐两项 + 明确的「新会话」+ 网关胶囊自动收起）

**用户对照截图**（那是**桌面面板**：地址栏是 `frp-gap.com`、右侧抽屉带「原先在『设置 → AI 助手』的配置都搬到这里了」）
指出手机端还差两块：① 助手设置里的 **API Key 与模型**（桌面的「默认行为」里有，我 U4 只补了思考等级/权限模式/
系统提示词/工具）② 桌面左侧那颗 **「新会话」**按钮在手机端没有。

**① 设置面板补「API Key / 模型」两行** —— **不另做第二套弹层**，只把入口收进来：
点行 → 关掉设置面板并打开页面上**已有**的模型选择器 / Key 选择器（`onOpenModel` / `onOpenKey`），
两行右侧显示当前值（`modelLabel` / `keyLabel`）。这样对照桌面端不再"像少了两项"，也不必先退回输入区。

**② 「新会话」按钮**：那枚按钮的动作其实是 `clear()`，而它**会换一个新的会话 id** —— 语义就是「新会话」，
与桌面左侧那颗一致。之前用环形箭头图标 + 叫「清空」，对不上（用户的原话是"左边侧边新会话的按键功能也没有"）。
改成**加号图标 +「新会话」**，并**去掉"空会话时禁用"**（新会话本来就允许在空会话上按；禁用正是"点了没反应"的来源）。
配套：`clear()` 里原来 `if (busy) return` 是**静默返回** —— 既然按钮不再禁用，就必须把原因说出来，
现在改成提示「正在生成回答，先点停止再开新会话」。

**③ 网关状态胶囊自动收起**：真机反馈"弹窗一直显示"。原来的胶囊一旦出现就永久挂着（网关正常时也在最上面占一条）。
新增 `statusHideTimer`：**每次状态文本变化都重排一次 4 秒定时器**，到点 `statusBar.isHidden = true`；
新的状态会重新显示并重新计时（那些 `isHidden = false` 的赋值点本来就在）。
两个细节：**点开小窗时先取消自动收起**（否则刚打开就消失）；`deinit` 里 invalidate（与其它定时器一致）。
刻意**不做**"错误时永久保留"——那正是用户要避免的"一直显示"。

**复查**：面板 12 项断言全过（含"页面把四个新参数都传了"）；Swift 6 项断言全过（定时器声明/4 秒/重排/取消/deinit 清理/单一定义）；
其中两条先报 ❌ 又是**我检查器的缺陷**：一条用固定 300 字窗口找图标，被我写在该按钮里的长注释挤出窗口；
另一条用 `split('onStatusTap')` 取正文，而该标识符**首次出现在手势装配处**（不是函数定义）。改用
"正则取到 `</Button>`" 与"按 `func` 定义定位"后两项都通过。
三项检查：tsc 0 · build 1,350.53→1,350.61 kB · self-check 0；Swift 括号 217/217 平衡。

**改动**：`components/AssistantSettingsSheet.tsx`、`pages/AssistantPage.tsx`、`PanelViewController.swift`。

#### 记忆点 · 步骤 60（U8：补上「静态表单」加账号路径 —— 小浣熊这类家手机上终于能加）

**用户报的问题**：手机端加小浣熊账号提示「此提供商未声明动态登录方式…手机端不会猜测凭证字段」，
而且**所有资源平台都一样**。问是不是没适配完全。

**根因（契约读出来的，不是猜的）**
- 手机端**只有一条路**：`GET /api/session/login/methods?provider=X`；`methodsUnavailable()` 判的是
  **HTTP 501** ⇒ 网关对"没实现动态登录"的家回 501 ⇒ 界面直接拒绝。
- **桌面端根本不依赖这条路**：它对 **27 家**走 `add-account-configs.ts`（51 KB、**纯数据、无 JSX**）
  的静态表单，字段名**直接对应 `POST /api/accounts` 的请求体**（小浣熊就是 `token` /
  `refreshToken`（`inputKey: 'refresh'` 只改 DOM id）/ `name`）。
- ⇒ 「所有资源平台都这样」是因为**这张表没搬过来**，不是某一家没适配。

**实现（复用 > 重写）**
- 新增 `lib/add-account-static.ts`：**直接 import 桌面那份配置模块**（手机端本来就有从 ui-islands
  复用模块的先例）⇒ **单一数据源，字段名不可能两边漂移**；并实现与桌面**逐条对应**的提交语义：
  `provider` 起手、按 `field.key` 平铺（`inputKey` 不进请求体）、`jsonExpand` **解析后并键**且解析失败
  就地拦下、可选且空值不发、地区写 `mode`、备注名写 `name`。
- 新增 `pages/add-account-static-sheet.tsx`：手填字段（`rows` 决定 Textarea / `maxLengthOf` /
  `fieldIdOf` 与桌面**同一函数**）+ **从文件导入**（文本 → `authFileContent`；二进制 → `authFileB64`，
  与桌面同键名）+ 提交 `POST /api/accounts`。
- **回落接法**（关键）：`DynamicForm` 在 `methodsUnavailable(failure) && hasStaticConfig(provider)` 时
  回调父组件，把表单**整块换成静态面板** ⇒ **动态优先、静态兜底**，今天能用的家行为不变，
  且所有入口自动覆盖（不用改 AccountsPage 的调用点）。

**一条刻意的诚实标注**：「网页登录」在桌面端由**桌面壳的桥**驱动（`workbuddyDesktop.startLogin`）、
「读本机客户端登录态」要读电脑上的文件（部分家还要 Windows DPAPI 解密）—— 手机端**做不到**，
所以这两段**不渲染但写明原因**并指向等价路径（手填 / 导入凭证文件）。
另一个坑：**不能**用 `desktopImportAvailable()` 当手机端的判据 —— 它读桌面壳注入的 `platform()`，
手机端拿到空串，会误判成"桌面导入可用"从而渲染一段做不到的界面。

**复查**：覆盖 **27 家 / 61 个字段**（其中 1 个 `jsonExpand`、40 个可选）；**16 项断言全过** ——
12 项提交规则与桌面逐条一致、4 项回落接线、3 项诚实标注。三项检查：tsc 0 ·
build 1,350.61 → 1,397.78 kB（+47 KB 就是这份 27 家配置真被打进去了）· self-check 0。

**并行进度**：U6（run 329）、U7（run 330）的推送构建均 **success** ⇒ 编译闸门全绿。

**改动**：`lib/add-account-static.ts`（新）、`pages/add-account-static-sheet.tsx`（新）、
`pages/add-account-dynamic-sheet.tsx`（501 回落）。

#### 记忆点 · 步骤 61（U9：手机端实现「网页登录 / OAuth」+ 复查抓出的四处遗漏）

**用户要求**：「网页登录」也要实现，否则有些平台根本没法用（不能缺）。

**关键查证：手机端**能做**，不需要动 Swift。**
桌面端把这步交给壳（`workbuddyDesktop.startLogin`），是因为它要开**内嵌窗口**并捕获 Cookie；
但**网关侧是一条普通 HTTP 流程**：
  1. `POST /api/session/login/oauth/start` → `{state, authUrl}`（路由表与处理器都核过）；
  2. 官方页完成登录 → 回调到 `127.0.0.1:<端口>`；
  3. `GET /api/session/login/wait?state=` → `{pending?, done?, error?, session:{accountId}}`。
**第 2 步在手机上同样成立**：打开官方页的是**手机自己的浏览器**，回调打到的 `127.0.0.1` 就是
**手机自己的本机网关** —— 与桌面端**网页面板**（无壳）走的是同一条路（配置注释写明网页端那一级
「整季收起，用 webHint 说明唯一那条路（在新标签页中打开）」）。**OAuth 与网页登录共用同一套端点**，
所以一段代码覆盖两者。

**实现**：新增 `api/web-login.ts`（启动）+ `pages/add-account-static-sheet.tsx` 里的登录分段：
尽力 `window.open`、**同时把地址显示出来并给「复制链接」**（Capacitor WebView 忽略 window.open，
与 Tabbit 短信同一个坑）、「再打开一次」、「我已完成」（立即查）、**每 3 秒轮询**（上限 100 次 = 5 分钟）、
「取消」（调 `cancelDynamicLogin`），以及**兜底**「粘贴回调地址」→ `/api/session/login/callback`。

**★ 复查抓出的四处真遗漏（都改了）**
1. **轮询竞态**：3 秒一跳的长循环里，关窗后仍会对已卸载组件 `setState` → 加 `mountedRef` 守卫；
2. **`oauth` 分段没渲染**：若某家只声明 oauth，面板会空着 → 与网页登录合并成同一段（同端点）；
3. **`sms` 没渲染**：改为指引到账号页已有的「手机验证码登录」（不重复做第二套）；
4. **`guest` 没渲染**：智谱清言的访客模式手机端确实没接入 → **如实写明**并指向可用替代
   （手填 / 导入凭证 / 网页登录）。

**仍存在的真实空缺（如实记）**：`guest`（一键换发访客凭证）手机端未接入 —— 它需要一个我尚未
核到契约的端点；界面上已说明，不静默缺失。

**复查结果**：边界条件 **7/7**（轮询上限、取消判据、取消调网关、启动记录 state、空地址报错、
回调兜底、卸载守卫）✅；分段覆盖 **7/7**（manual / file / web / oauth / sms / guest / blocked 都有落点）✅。
三项检查：tsc 0 · build 1,401.19 → 1,402.26 kB · self-check 0。

**推送范围核对**：仓库 HEAD 与本地比对的待推清单里，`docs/mobile-ui/DEPTH-GAP.md` 与
`ROUTING-GAP.md` 是**旧源码树的残留**（早前合并文档时已从仓库删除）——**刻意不推**，
避免把已删文档又带回去。

**改动**：`api/web-login.ts`（新）、`pages/add-account-static-sheet.tsx`、`lib/add-account-static.ts`。

#### 记忆点 · 步骤 62（U10：访客模式补齐 —— 之前的"空缺"其实是"没查契约"）

**背景**：U9 我把「访客模式」（只有智谱清言）标成手机端未接入的真实空缺。用户要求继续查契约补上。

**契约（查到了，而且比预想简单）**：
- 桌面端 `add-provider-blocks.tsx` 的注释写明：**载荷只有 `{ provider, guest: true, name? }`**，
  打 **`POST /api/accounts`**；网关的 **Chatglm 分支**再按 `guest` 去插件打一次**空 body** 的
  `guest/access` 换证（`core/account_store/mod.rs` 也记着"实现已搬到插件"）。
- 配置侧类型：`guestLogin?: { noteHtml, button, busyText?, namePlaceholder? }`。
- ⇒ **不需要新端点、不需要原生改动** —— 手机端用已有的提交函数（`POST /api/accounts`）就能做。

**实现**：把「暂未接入」那段说明换成真分段 —— 备注名输入（`namePlaceholder`）+ 按钮（`config.guestLogin.button`
与 `busyText`），点击提交 `{ provider, guest: true, name? }`，复用同一套 `submit()`（成功即刷新列表并关窗）。
另补一处状态重置：换提供商时清空访客备注名与回调地址。

**★ 一条值得记的判断**：U9 里我写"手机端暂未接入"，听起来像"做不到"，但**它只是"这个端点我还没核"**。
这两者在汇报里必须分清：前者是能力边界，后者是待办。这次查了 10 分钟就补齐了 ——
**凡是没有"技术上不可能"证据的缺口，都不该被写成能力边界**。

**复查**：契约键名 `guest: true` 到位 ✓、文案与按钮全部取自配置（`config.guestLogin.*`）✓、
`namePlaceholder` 已用 ✓、换提供商重置 ✓、旧文案「手机端暂未接入」残留 **0** ✓。
三项检查：tsc 0 · build 1,402.26 → 1,402.59 kB · self-check 0。

**至此手机端与桌面端在「加账号」上的分段对照**：手填 ✅ / 导入凭证文件 ✅ / 网页登录 ✅ / OAuth ✅ /
短信 ✅ / 访客模式 ✅ / 动态登录 ✅；唯一仍不对齐的是**读本机客户端登录态** —— 那一条是**技术不可能**
（要读电脑上的客户端文件，部分家还要 Windows DPAPI 解密），界面已注明原因并给出替代路径。

**改动**：`pages/add-account-static-sheet.tsx`。

#### 记忆点 · 步骤 63（CI 优化 A 档：取消过期构建 + 文档不触发 + 作业超时）

**背景**：操作者问"是不是编译得太多了"。量化后的结论（都从运行记录里量的）：
- 仓库是 **public** ⇒ **Actions 分钟不计费**，损失的是**等待时间与排队竞争**，不是钱；
- 单次 push 会跑满矩阵：iOS 13–23 分、Plugins 3–6 分、**macOS dmg 22–27 分**、Windows 13–21 分、
  Linux 11–15 分、Web 4–5 分、Android≈跳过 —— **约 25–27 分钟墙钟、5–6 个作业并行**；
- **2026-11-09 当天共触发 29 次运行**；
- 实测工作流里 **没有 `concurrency`**（0 处）⇒ 新提交不会取消旧构建 ⇒ run 328–333 同时开跑，
  白烧还**占住 macOS runner**，这正是那次发布（run 334）的 iOS 作业**排队近 10 分钟**的原因；
- **没有 `paths` 过滤**（0 处）⇒ 改一行面板 CSS 也要连编 4 个桌面平台。

**顺带纠正一处我自己的错误表述**：上一轮我说"平台作业无条件全跑"是**不准的** —— 它们**都有
`if: ${{ !inputs.only || inputs.only == 'all' || … }}`**；push 时 `inputs.only` 为空、`!inputs.only`
成立，所以全跑。B 档（push 只跑 iOS+Plugins）的落点就在这些 `if:` 上，不是新加条件。

**A 档已实施**（`.github/workflows/build.yml`，8 作业超时全部加上）：
1. `concurrency: group: ${{ github.workflow }}-${{ github.ref }}` +
   **`cancel-in-progress: ${{ github.event_name == 'push' }}`** —— 关键是**只让 push 互相取消**，
   手动发布（workflow_dispatch）**绝不被取消**；
2. `push.paths-ignore: ['docs/**', '**.md']` —— 只改文档/备忘不再触发构建；
3. 各作业 `timeout-minutes`：macOS 45、Windows 40、其它 30（按 runner 分别给），防止卡死作业白占。

**校验**：环境里没有 PyYAML/js-yaml（两种都试过，实测不在），所以用**结构自查 6 项**代替：
push 段含 paths-ignore ✓、concurrency 位于 permissions 之前 ✓、cancel-in-progress 只看 push ✓、
三种超时值都在 ✓。缩进按原文件既有层级写（`push:` 下的键 4 空格、`concurrency:` 键 2 空格、
`timeout-minutes` 与 `runs-on` 同缩进），改动摘要已逐行核过。**未做**：B 档（push 只跑 iOS+Plugins）
与 C 档（push 只编译检查不打包）—— 操作者选定"就 A 方案"。

**改动**：`.github/workflows/build.yml`（30,797 → 31,260 字节，备份 build.yml.bak）。

#### 记忆点 · 步骤 64（U11：状态胶囊改为"按状态变化显示 + 只在出错时留驻 + 缩短一半"）

**操作者报的问题**：① 网关信息"有事没事就弹出来"（怀疑网关不稳）② 胶囊变红是什么、看不到内容
③ 胶囊太长，要缩短至少一半。

**根因（查证，不是猜）**：**不是网关不稳，是 U7 的自动收起没做干净**。
- `ToneLabel` 重写了 `text` 的 `didSet`：**只要发生赋值就回调，未比较新旧值**；
- 应用里有 **5 秒**心跳与健康定时器，会**反复赋同一个状态摘要** ⇒ 每次赋值都触发
  「显示 + 重排 4 秒自动收起」⇒ **收起后被 5 秒轮询顶回来**，形成"反复弹"。
**红色的判定**（`applyTone(for:)`）：文字含「失败」「错误」或带 `— JS —` / `— supervisor —`
⇒ `.systemRed`（真出错了）；含「正在启动」「等待」⇒ 橙；其余 ⇒ 黄。看不到内容是因为 U7 之后
胶囊是**单行截断**。

**操作者给的规则（已记入项目记忆）**：启动时显示一次 → 启动成功提示一次 → **网关正常期间完全不显示**
→ **只有出错才显示**（错误摘要放胶囊里）→ 点胶囊弹出完整错误日志。

**实施（集中在唯一漏斗 `statusLabel.onText`，避免漏路径）**
1. `ToneLabel.didSet` 加**新旧值比较**：相同文字不再回调；
2. 新增 `presentStatus(_:)`：把状态归一成**状态键**（error / starting / waiting / ready），
   **仅当状态键变化**才显示；`ready`（正常）**不显示**；`error` **常驻且自动收起被取消**（等用户点开或恢复）；
   显示的是**短标题**（`正在启动网关…` / `网关已就绪` / `等待网关…` / `网关出错了：<首行 16 字>`）；
3. 递归防护：`writingStatusTitle` 挡住"写短标题 → 再次触发 onText"；
4. 完整文本另存 `statusFullText`，`onStatusTap` 改读它 ⇒ **胶囊短、点开是小窗里的完整日志**；
5. 宽度：左右各 12 的满行约束改为 **居中 + 最宽 0.55 屏宽**，宽度由短标题与「重试」的固有尺寸决定。

**验证**：花括号 228/228、圆括号 491/491 平衡；五处改动逐项在位；`applyTone(for:` 调用点收敛到 1 处
（`presentStatus` 内）。**Swift 的编译结论只能来自 CI**（本地无 Xcode），已推送并起守候等 iOS 作业结论。

**改动**：`agent2api-ios/app/Agent2API/PanelViewController.swift`。

#### 记忆点 · 步骤 65（U12：趋势图"一整块蓝" —— 单日数据的柱宽占满绘图区）

**操作者报的问题**：「按天 Token 趋势」显示成一整块蓝色，怀疑 UI 没处理好。

**根因（读代码确认，不是渲染失败）**：`components/MobileReportTrend.tsx` 里
```
max      = Math.max(...values, 1)
barWidth = Math.max(0.1, (width - gap*(n-1)) / Math.max(1, n))     // width = 300
size     = row.value / max * 84
opacity  = (row.value === max) ? 1 : 0.4
```
当 **n = 1**（操作者截图里坐标轴两端都是同一天，正是单日）：`barWidth = 300`（占满宽）、
`size = 84`（占满高）、且它等于 max ⇒ `opacity = 1` ⇒ **一根满宽满高不透明的柱子 = 一整块纯色**
✓。数据没错，是**少数据量的呈现退化**。

**修法**：柱宽加**上限 28**，并把整组柱子**居中**（多数据时行为不变，仍是密集柱形；少数据时
变成中间一根细柱）。改动四处：`const slot`、`Math.min(slot, 28)`、`barsOffset`、
`x={barsOffset + index * (barWidth + gap)}`。

**复查**：四处改动各 1 处在位 ✓、单日柱宽上限生效 ✓；三项检查 tsc 0 ·
build 1,402.59 → 1,402.66 kB · self-check 0 ✓。

**改动**：`desktop-tauri/mobile/src/components/MobileReportTrend.tsx`。

#### 记忆点 · 步骤 66（U13：WorkBuddy 账号手机上能加了）

**操作者报的问题**：手机端加 WorkBuddy（国内版/国际版）仍提示「此提供商未声明动态登录方式」。

**根因**：WorkBuddy **不在**静态表里（桌面端配置模块头注释写明：它结构特殊——账号版本 +
打开方式 + 第三方入口开关，单独一个组件），所以 `configOf()` 取不到 ⇒ 没有静态回落 ⇒ 落到 501 提示。
即 U8 只搬了静态表，**没搬这个特殊块**。

**契约（查证后确定）**
- 版本 → provider id：`edition === 'intl' ? 'workbuddy-intl' : 'workbuddy'`；
- 版本判定：凭证里的 domain 命中 `workbuddy.ai` ⇒ 国际版（文件自带事实优先）；
- 凭证有效性：必须含 **`accessToken` + `uid`**（否则桌面端报「不是有效的凭证文件…」）；
- 提交：`{ ...record, provider: workbuddyProviderId(landed) }`（+ 备注名）；另有
  `{ provider, importDesktop: true }` = **读本机客户端登录态**（手机做不到，界面注记）。

**实施（手机端可等价的两条）**
1. `lib/add-account-static.ts`：新增 `workbuddyConfig()`，并让 `configOf()` = 静态表优先、
   查不到再回落到 WorkBuddy 这两家 ⇒ **`hasStaticConfig()` 随之为真，动态面板 501 后自动切到
   静态面板**（U8 的回落链路直接复用，不用再动入口）；
2. 同文件新增 `parseWorkbuddyCredential()`：解析 JSON、**校验 accessToken + uid**（缺就返回 null，
   由界面报错，**不猜**）、按 declared/domain 判定 provider（`workbuddy.ai` ⇒ 国际版）；
3. `pages/add-account-static-sheet.tsx` 的文件导入里加 WorkBuddy 分支：**解析后把平铺记录 POST 上去**，
   而不是把整段文本当 `authFileContent`（后者正是桌面端刻意不做的形状）；
4. 手填段留空（凭证不是一个 token 能拼出来的），只给「导入凭证文件」+ 凭证目录说明；
   网页登录复用 U9 那条（oauth/start → 打开或复制地址 → 轮询 → 粘回调兜底）。

**复查**：lib 侧 `workbuddy-intl` 6 处、回落表达式 1 处、`parseWorkbuddyCredential` 1 处、
`accessToken`/`uid` 各 5 处、`workbuddy.ai` 判定 1 处；sheet 侧分支 4 个关键点各 1 处 ✓。
三项检查：tsc 0 · build 1,402.66 → 1,404.37 kB · self-check 0 ✓。

**改动**：`mobile/src/lib/add-account-static.ts`、`mobile/src/pages/add-account-static-sheet.tsx`。

#### 记忆点 · 步骤 67（U14：上游文案中性化 + 导出可选范围 + 导入可选文件 + 分类分段）

**① 「上游未配置」中性化**
操作者问"设置里和首页上面显示上游未配置是什么意思"，并建议"直接改成图标加 Agent2API 名称"。
查证：`upstreamConfigured` 在 `api/health.rs` 与 `api/session.rs` 里**都**来自
`auth().get_config_summary()` 的 `configured`，而 `auth.rs` 里那条原因常量是
**`UNCONFIGURED_REASON = "暂无可用登录态"`** —— 所以它表示**网关自带那个上游服务（health.rs 同时
回报 `product: WorkBuddy`、`transport: upstream-api`）有没有可用登录态**，**与面板里添加的
提供商/账号毫无关系**。这解释了"一切照常可用却一直挂着待配置"。
改法：设置页标题改为**品牌 + Agent2API**（复用已有 bolt 图标，不新画），警示徽标改为
**仅在上游确实配好时显示中性「已连接」**；首页那枚状态点同源，改为中性「已连接」+ 常绿
（面板既然拿到 session，连接本来就是通的），并删掉不再使用的 `gateway` 变量。
⚠️ 仍**未核清**的是"网关自带上游具体在哪一步配置/登录"（不影响本次改动，文案已中性化）。

**② 导出可选范围**（原实现一点就全量）
契约：`POST /api/accounts/export-files`，选择器 `{ id }` 或 `{ provider }`，**两者都传以 id 为准**
（accounts_export.rs）；响应 `{ total, files, failed }`。新增 `pages/export-accounts-sheet.tsx`：
全部（仍走 `GET /api/accounts/export`，含自定义提供商定义）/ 按提供商（列该家与其账号数）/
仅勾选（接口一次只收一个选择器 ⇒ **逐条请求再合并 `files`**）；`failed` 会提示不静默丢弃。
账号页那颗「导出」改为打开该面板，旧的 `exportAll` 与 `exporting` 状态移除。

**③ 导入可选文件**（原实现只能粘贴）
`account-import-sheet.tsx` 加 `<input type=file>`（accept `.json/.txt/.info` 等）+ `file.text()`
读取、去 BOM、2 MB 上限、空文件与读取失败都有提示；读到的文本填进同一个内容框 ⇒ **仍走同一条
提交路径**（`authFileContent`），不新增第二条落库方式；粘贴路径保留。

**④ 分类分段**（对齐桌面第 1 步）
分段：全部 / Agent / Web / 已建 API / API 模板。判据**与桌面同源**：`custom-` 前缀 = 自定义提供商
（网关 `is_custom_provider_id`，见 custom_providers.rs 的模块头），其余按网关 provider 摘要里的
`category`（`provider_category()` / 默认 agent，见 providers/mod.rs）。每组带计数。
「API 模板」在手机端**没有模板数据**（模板来自桌面壳的 `wbPresetProviders`），所以这一档
**不列假数据**，而是把用户送到已有的「自定义提供商」页新建（`store.go('custom-providers')`）。

**复查**：41 项断言里 39 项直接通过，另 2 项先报 ❌ 又是**注释里出现了那些字样**（我在注释里写
"原来显示的是…"），逐行核对确认**只存在于注释、不在 UI 文案** ⇒ 实际 41/41 ✓。
过程中检查器还**抓到一处真问题**：导出面板用了不存在的图标名 `list`（`Icon.tsx` 只有 51 个图标，
无 list），会渲染成空白 ⇒ 已改成合法的 `doc` ✓。
三项检查：tsc 0 · build 1,409.52 kB · self-check 0。

**改动**：`pages/SettingsPage.tsx`、`pages/HomePage.tsx`、`pages/export-accounts-sheet.tsx`（新）、
`pages/AccountsPage.tsx`、`pages/account-import-sheet.tsx`、`pages/add-account-dynamic-sheet.tsx`。

#### 记忆点 · 步骤 68（U15：修正 concurrency —— 手动构建不再被后续推送取消）

**问题**：run 336 / 337 / 339 全部 `cancelled`，其中 339 是我为"拿 Swift 编译证据"特意手动派发的。
根因是**我 A 档改动的缺陷**：并发组写成 `${{ github.workflow }}-${{ github.ref }}`，
**手动派发与推送共用同一个组** —— 后续推送的 run 进入同组，就会取消正在跑的那个。
`cancel-in-progress` 只决定「本 run 进来时是否取消别人」，**并不保护自己不被别人取消**。
所以我当时"手动发布绝不被取消"的说法是**错的**，已更正。

**修法**：组名加 `event_name` —— `${{ github.workflow }}-${{ github.ref }}-${{ github.event_name }}`
⇒ `Build-main-push` 与 `Build-main-workflow_dispatch` 是两个组：
推送只取消旧的推送；手动构建再不会被推送打断（两次手动之间仍会择新）。
注释也一并改准，把这条坑写在配置旁边，避免以后又被"看起来对"的写法骗一次。

**教训（值得记）**：`concurrency` 的语义要分清两件事 ——
**组**决定"谁和谁互斥"，`cancel-in-progress` 决定"进来时是否清场"；
想保护某一类运行，只能靠**分组**，不能靠 `cancel-in-progress`。

**改动**：`.github/workflows/build.yml`。

#### 记忆点 · 步骤 69（U16：顶部横条根治 + WorkBuddy 网页登录 + 胶囊显示原文的漏洞）

**① 顶部"老是一条横条"——本次按操作者建议做重构**
前几次只调 `UINavigationBarAppearance` 的透明项，**治不干净**：只要导航栏还占着位置，
系统在某些滚动态仍会画一条底色。这次改成结构性方案：
- `setNavigationBarHidden(true)` —— **导航栏彻底隐藏**（原来是 false，这是横条的根源）；
- 顶部那两件（版本胶囊 `v3.4.344` + 切换面板的圆按钮）**从导航栏项改为页面上的悬浮控件**：
  `view.addSubview` + 约束到 `safeAreaLayoutGuide`（胶囊水平居中、距顶 8；按钮靠右 14、
  与胶囊同高），并 `bringSubviewToFront` ⇒ 它们与状态胶囊同属"浮在页面上的 chrome"，
  页面向后滚到底下，不再有任何通栏底；
- `navigationItem.titleView` / `rightBarButtonItems` **全部移除**（复查残留 0 处）；
  `updatePanelButton()` 改为直接操作属性 `topPanelButton`（原来要从 `rightBarButtonItems`
  里挖 customView），无用的 `makePanelButton` 一并删除（避免死代码）。

**② WorkBuddy 网页登录（上次漏做）**
操作者对照桌面面板指出：桌面 WorkBuddy 有「网页登录」页签，手机端只有「导入凭证文件」✗。
查因：`workbuddyConfig()` 里**只给了 fileImport，没给 webLogin** —— 而面板的网页登录分段
只在 `config.webLogin` 存在时才渲染。补上 `webLogin`（文案照桌面端那条：完成后自动加入列表、
昵称取自上游；`button`/`hint`/`busyText` 齐全）⇒ 复用 U9 那条手机端流程
（`POST /api/session/login/oauth/start` → 打开/复制授权页 → 每 3 秒轮询 → 粘回调兜底）。

**③ 胶囊显示原始长文本的漏洞（本次实证）**
真机上胶囊显示「网关 OK · 127.0.0.1:3065」而不是我设的短标题。查到原生里**还有第三处**写状态：
`statusLabel.text = "网关 OK \u{00B7} 127.0.0.1:\(port)\n" + diag`。而我的 `presentStatus`
在**"状态键没变"时提前 return**，那时**不把文本归一成短标题** ⇒ 外部写进来的长原文就留在胶囊上 ✗。
修法：把「写短标题」**移到 `guard` 之前**——状态没变时不重新显示，但**每次都把显示文本归一**；
状态键变化时才显示/重排自动收起。

**验证**：Swift 花括号 226/226、圆括号 497/497 平衡；`setNavigationBarHidden(true)` 1 处、
`topPanelButton` 13 处、`navigationItem.titleView` 与 `rightBarButtonItems` 残留 **0**。
面板三项检查：tsc 0 · build 1,409.80 kB · self-check 0。**Swift 编译结论仍以 CI 为准**。

**改动**：`agent2api-ios/app/Agent2API/PanelViewController.swift`、
`desktop-tauri/mobile/src/lib/add-account-static.ts`。

#### 记忆点 · 步骤 70（上游适配：6 个补丁对齐 v3.5.0-beta.1）

**背景**：上游发布了 v3.5.0-beta.1（`main` 仍停在 v3.4.2 的树），CI 按 `ls-remote --tags 'v*'` 取到新 tag
后，补丁 0004 打不上 ⇒ 构建在「打补丁」这步失败、**不出 deb**（那次发布只产出了插件 zip）。

**适配做法（逐补丁自检，不靠猜）**：环境里**没有 git**，所以我写了一个补丁解析器做自检：
逐 hunk 取其「上下文 + 删除行」序列，在目标文件里做容错匹配（允许行号偏移）⇒ 精确区分
「只是挪了位置」与「代码已变必须重写」。过程中修掉我自己工具的两处缺陷：
① 把「补丁新建的文件」误判为「目标不存在⇒失败」；② 自检读的是镜像副本而非推送树（导致改完仍显失败）。

**逐个结论**：
- **0001**（iOS 执行闸门）：纯新增的两个 hunk，插入点前新版多了一行
  `if self.options.script { super::script::clear_transport(); }` ⇒ 只刷新上下文与行号，插入代码一字未改；
- **0002/0005/0006**：对 v3.5.0-beta.1 **可直接应用**，无需改动；
- **0003**：`update.rs` 那处只是新版 import 行末尾多了 `, UpdateError` ⇒ 刷新上下文；要改的两个常量
  （`INDEX_REPO` / `FALLBACK_REPO` → 我们自己的仓库）一字未动；
- **0004**（自建源免签名）**按新结构重写**：上游把签名判定改成**三态模型**
  （`install.rs` 的 `SignatureState`：`Unsigned` / `Invalid` / `Verified`），我们原来改的
  `compatibility.rs` 三个 hunk 的**目标函数已被删除**（该文件从 8996 B 缩到 2022 B，只剩公共接口校验）。
  新版真正的闸门是：`packages.rs` 的 `if require_signed && signature != Verified { 拒绝 }`，
  而 `require_signed` 由 `update.rs` 的 `let require_signed = !response.official;` 等三处算出
  —— 我们自建源在"上游眼里"正是非官方 ⇒ 会被强制要求官方签名 ✗。
  所以重写为：把那三处钉成 `false`、下载后的完整性校验改为**始终执行但末参传 false**（sha256 与结构照查、
  不强制验签），并**保留**仍适用的 `policy.rs` hunk（`InstallPolicy::signed()` 返回 false）。

**自检结果：6/6 全部通过**（0001 2/2、0002 3/3、0003 2/2、0004 5/5、0005 1/1、0006 1/1）。

**改动**：`agent2api-universal/patches/{0001,0003,0004}-*.diff`。

#### 记忆点 · 步骤 71（补丁自检的漏洞：hunk 行数没校验 ⇒ CI 判为畸形 hunk）

**现象**：6 个补丁的上下文自检全绿，但 CI（run 348）**仍在「打补丁」那步失败**。

**根因（我自己的生成器缺陷）**：生成 0004 时，hunk 头里的行数是用**公式推导**的
（`old_count = end - start + 1`、`new_count = old_count + added`），与**实际写入的行**不一致
（例：`@@ -343,7 +343,7 @@` 的实际体是 7 行旧 / 6 行新）⇒ `git apply` 判定为**畸形 hunk** 直接拒绝 ✗。
**我的自检器只比对上下文，不校验行数**，所以完全放过了它 —— 这是**自检器的漏洞**，不是适配判断错。

**修法**：
1. 生成器**按实际输出行计数**（先写体、再回填 hunk 头的 `-old,new` 计数）；
2. 自检器加**行数校验**（双重自检：声明行数 == 实际体行数 + 上下文能在目标树匹配）
   ⇒ 改完立刻验证：6 个补丁 **0 问题** ✓；
3. 过程记录：为省事先去"修补生成器"，结果把生成逻辑自己改坏（补丁只剩 hunk 头、体全丢）
   ⇒ 教训是**这类生成器一次写干净，别在它上面层层打补丁**；另修掉两处 Python 作用域坑
   （嵌套函数里给模块级变量赋值要 `global`，`nonlocal` 绑不上）。

**改动**：`agent2api-universal/patches/0004-plugin-store-own-repo-unsigned.diff`（3528 B，5 个 hunk）。

#### 记忆点 · 步骤 72（顶部悬浮重构漏改一处变量名 ⇒ Swift 编译失败）

**现象**：CI run 350 的 iOS 作业第 16 步「打 IPA + 打包 deb」失败；
日志原文 `PanelViewController.swift:673:9: error: cannot find 'button' in scope`。

**根因（我的疏漏）**：U16 顶部悬浮重构把切换按钮从 `navigationItem.rightBarButtonItems` 改为
自己持有的属性 `topPanelButton`，但 `updatePanelButton()` 里**漏改一处**：仍在写
`button.accessibilityLabel = …` ⇒ 变量不存在、Swift 编译中断 ✗（全文仅此一处悬空，已核实）。

**修法**：改为 `topPanelButton.accessibilityLabel = …`。

**另一个必须记住的坑（我自己的守候脚本判断错误）**：run 350 的**运行级结论是 success**，
因为 iOS 作业带 `continue-on-error` —— 我的守候只查「run 是否成功」就自动发发布，
结果产出 `ios-…-b351`：**只有 2 个插件 zip、没有 deb** ✗。
⇒ 判断"能不能发包"**必须看 iOS 作业的 conclusion，不能看 run 的 conclusion**。

**改动**：`agent2api-ios/app/Agent2API/PanelViewController.swift`（一行）。

#### 记忆点 · 步骤 73（上游审计：补丁签名遗漏 5 处 + mobile/ui-shared 落后 66 模块）

**A. 补丁遗漏（已修）** —— 审计 v3.5.0-beta.1 里所有决定 `require_signed` 的位置，发现在
我们把 `update.rs` 三处钉成 false 之后，**还有 5 处会重新要求官方签名**：
- `update/required.rs` L18、L47：`asset.require_signed = true;`（必备插件自动补齐路径）
- `operations.rs` L161：`require_signed: automatic || platform["requireSigned"] == true`（手动/自动安装）
- `catalog.rs` L195、L212–213：商店元数据把 `requireSigned` 透传给前端，前端又回传给安装接口
⇒ 后果：即使主路径放行，**必备插件补齐与商店安装仍会因缺官方签名而失败**。
已把 0004 从 5 个 hunk 扩到 **10 个 hunk / 5 个文件**（policy.rs、update.rs、required.rs、
operations.rs、catalog.rs），双重自检 10/10 通过。

**B. mobile 面板与 ui-shared 落后（未修，需排期）** —— 上游 tree 自带 `desktop-tauri/mobile`，
我们的 fork 是在它上面改的；对比后：
- `ui-shared`：我们 **65 个 = 上游 v3.4.2 的 65 个**，而上游新版有 **131 个**
  ⇒ 新增 66 个模块全缺（maintenance、branding、图片生成、插件设置、签到活动、
  页面自动刷新、验证码等），另有 **25 个同名文件被上游改过**（如 logs.ts 4939→11260 B、
  client-identification-panel.tsx 10791→18806 B、plugins.ts 3886→6606 B、updates.ts 7612→9534 B）；
- `mobile/src`：上游新增 7 个文件（ToolsImageGeneration、provider-settings-page、
  api/maintenance、api/vision-compat、components/PageAutoRefresh、lib/branding、
  lib/usePluginStartup）我们全缺 —— 它们都是薄封装，真正逻辑在 ui-shared。
⇒ **不阻塞构建**（我们编译的是自己的 mobile + 自己的 ui-shared，配套自洽，CI 已证明能过），
  但手机面板**拿不到上游新版这 66 个模块的功能**，且旧版共享解析器面对新版 gateway 响应
  存在运行时错配风险（如日志接口结构扩展）。

**C. 已核实无问题的项**：上游 v3.4.2→v3.5.0-beta.1 **未删除任何 API 路由**（旧 244 条全在，
新增 37 条）；手机面板引用的 161 个端点逐个字面验证均存在；`plugin_host` 无新增编译期 feature；
CI 的工作目录 `Agent2API/desktop-tauri/src-tauri` 与面板构建入口均仍存在。

**改动**：`agent2api-universal/patches/0004-plugin-store-own-repo-unsigned.diff`。

#### 记忆点 · 步骤 74（上游功能补齐计划：66 个 ui-shared 新模块 + 25 个改动模块）

**三方核实的硬事实**：我们 `ui-shared` 的文件集与上游 **v3.4.2 完全相同**（65 个，逐字节一致，
仅 `plugins.ts` 我们自己改过 3886 B vs 3287 B）⇒ **我们的 fork 精确停在 v3.4.2**。
上游 v3.5.0-beta.1 有 **131 个**，即 **v3.4.2 → v3.5.0-beta.1 新增 66 个**（约 300 KB），我们一个都没有。

**66 个新增的功能分组**（决定分批）：
- 维护 maintenance 10 个（约 65 KB，含 css）；脚本插件 plugins-script-* 12 个（约 63 KB）；
  视觉/图片 10 个（约 48 KB）；插件基础设施 8 个（约 35 KB）；签到活动 4 个（约 30 KB）；
  提供商设置 4 个（约 19 KB）；代理 4 个（约 19 KB）；品牌/验证码 4 个（约 11 KB）；杂项 10 个（约 30 KB）。
- **29 个无内部依赖，36 个的依赖按功能域成闭环**（maintenance / checkin / plugins-script / vision / proxy
  各自成套）⇒ 可按域分批引入，每批独立可编译、可验证、可出包。

**25 个被上游改动的既有模块里，24 个我们与 v3.4.2 逐字节相同** ⇒ 可直接用上游新版整文件替换、
**零冲突**；仅 `plugins.ts` 需三方合并（v3.4.2 3287 → 我们 3886 → 上游 6606，上游新增
`ScriptPluginsState`/`ScriptCatalogInfo`/`ScriptOperation` 等脚本插件类型）。

**移动端接入机制（写进计划，避免下次重新摸索）**：
页面清单在 `lib/routes.ts` 的 `SCREEN_IDS` 数组（当前 24 项），屏幕→组件映射在 `App.tsx` 的对象表，
导航入口在 `MorePage`/`NavBar`/对应功能页；路由跳转用 `store.go('<screen>')`。

**计划文档**：`docs/UPSTREAM-SYNC-PLAN.md`（六批：A 闸门+老模块同步 → B 维护 → C 脚本插件 →
D 提供商/代理/视觉 → E 品牌/验证码/签到 → F 收尾出包），每批验收含四项检查与 CI（判据是
**iOS 作业** conclusion，不是 run 级）。

**同时发现的 0001 闸门覆盖缺口**（计划批次 A1）：`start()` 里
`if self.options.wasm.is_some() { return self.start_wasm().await; }` 在闸门**之前**返回 ⇒ iOS 上
wasm 插件不被拦；`script/settings.rs` 的 `bun::ensure()`（下载 bun 运行时）也不受闸门约束。

**改动**：`docs/UPSTREAM-SYNC-PLAN.md`（新增）。

#### 记忆点 · 步骤 75（批次 A1：执行闸门扩展到 wasm 与 Bun 下载路径）

**问题**：上游 v3.5.0-beta.1 有**三种插件形态**，而我们的闸门只拦住两种。
`lifecycle.rs::start()` 里 `if self.options.wasm.is_some() { return self.start_wasm().await; }`
排在闸门插入点**之前** ⇒ wasm 插件在 iOS 上不被拦（iOS 禁 JIT，起了也必然失败，属「装得上但用不了」）；
另外 `script/bun.rs::ensure()` 会**下载 200 MB Bun 运行时**，它有 5 个调用点
（`operations.rs`×2、`runtime.rs`、`settings.rs`、`bun.rs` 自身），全部不受闸门约束。

**改法（补丁从 2 hunk 扩到 3 hunk）**：
1. 把 `exec_blocked()` 从 `impl Host` 的关联函数**提升为模块级 `pub(super) fn`**，
   这样 `plugin_host::script::bun` 也能复用（`pub(super)` 对父模块及其后代可见）；
2. 闸门调用**前移到 wasm 分支之前**（`if let Some(attempt) = &self.options.startup { … }` 之后），
   一次覆盖进程 / 脚本 / wasm 三条启动路径；
3. 在 `bun::ensure()` 开头插入同一道判定，**一处即覆盖 5 个调用点** —— 比逐个改调用点更稳，
   避免上游以后新增调用点又漏掉。文案：`当前运行形态不支持安装脚本插件（需要下载 Bun 运行时）：{reason}`。

**本地验证**：严格校验 20/20 hunk 上下文匹配；模拟应用后结构正确 —— `exec_blocked` 定义 L30 在
`impl Host` L47 **之前**、闸门调用 L128 在 wasm 分支 L136 **之前**、`bun.rs` 引用
`super::super::lifecycle::exec_blocked()` 存在。

**工具教训（重要，已修）**：我原来的补丁校验器在解析 hunk 体时，把**hunk 之后的空行**也当成
上下文行（因为 `raw == ""` 被归入上下文档），导致行数校验可能失真、模拟应用出现"8/9 行相同"的假失败。
正确做法是**按 hunk 头声明的 `old_n`/`new_n` 精确读取体行数**，读满即止
（新工具 `validate_strict.py`，已用它取代旧校验器）。这类"生成器与校验器共用同一套错误假设"
的情况最危险 —— 两边一起错就会自证通过。

**改动**：`agent2api-universal/patches/0001-plugin-host-ios-exec-gate.diff`（5222 B，3 hunk / 2 文件）。

#### 记忆点 · 步骤 76（批次 A2：同步 25 个既有 ui-shared 模块 + 触发的依赖链）

**做了什么**
1. 25 个被上游改动的既有 `ui-shared` 模块：**24 个直接整文件替换**（我们与 v3.4.2 逐字节相同，
   零冲突），`plugins.ts` 做**三方合并** —— 以上游新版为底，把我们的 `PackUiSummary` 类型与
   `PackUiSummary[]` 字段加回去（上游没有这两样，属于我们的「插件自定义页面」增量）。
2. 同步触发的**依赖链**（新模块 import 了更多新版模块，必须一起引入，否则类型检查直接报缺失）：
   `account-import-result.ts`、`searchable-select.tsx`、`checkin-campaign-types.ts`、
   `github-failure.tsx`、`plugin-startup.ts`、`plugins-filters.ts`、`usage-query-task.ts`。
3. **ui-kit 也要同步**：`searchable-select` 依赖 `@ui` 的 Combobox 组件，而上游 ui-kit 新增了
   `combobox.tsx` 与 `lib/select-boundary.ts`，并改了 `index.ts` / `segmented-control.tsx` / `select.tsx`
   —— 后两个我们与 v3.4.2 相同，直接替换。
4. **按上游变更改我们自己的页面**（3 处）：
   - `LogsPage.tsx`：`logContext(entry)` 新版要求第二个参数 `t`，3 个调用点全部补上；
   - `PluginCards.tsx`：新版 `StorePlugin` 已**没有** `official` 字段（上游移除了官方徽标概念），
     删掉「官方」Badge；
   - `PluginSettingsSheet.tsx`：新版 `PluginSettings` 已**没有** `autoInstallOfficial`
     （改为按最低版本自动补齐），从选项数组移除该项，避免把不存在的键写回网关。

**两个必须记住的技术坑**
- **base-ui 类型不匹配**：`@base-ui/react` 我们装的是 1.9.0，上游 `combobox.tsx`/`select.tsx` 把
  `Root.ChangeEventDetails` 传给期望 `OpenChangeEventDetails` 的位置；在 1.9.0 里后者是
  `ChangeEventDetails & { preventUnmountOnClose }`，**多一个字段**故不兼容。
  没有升级依赖（会牵连 43 个既有组件的用法），而是**最小适配**：把两处标注改为
  `OpenChangeEventDetails`，并给 `createChangeEventDetails(...)` 的返回值补一个
  `preventUnmountOnClose: () => {}` —— 这条路径是我们**主动关**，不需要延迟卸载，空实现即语义正确。
- **动态 import 的依赖也要补**：`plugins.ts` 用 `import('./plugins-filters').ScriptPublisher`
  这种**类型级动态导入**，只匹配 `from './x'` 的正则会漏掉它 —— 依赖补齐器必须同时匹配
  `from '\./x'` 与 `import\('\./x'\)` 两种写法。

**验证**：`tsc --noEmit` **0**；`pnpm run build` **0**（`ui/m/mobile.js` 1,409.80 → **1,425.74 kB**，
增量与同步进来的代码量相符）；`check-mobile-ui.py` **0**。

#### 记忆点 · 步骤 77（批次 B1：维护面板接入）

**上游的做法**：v3.5.0-beta.1 把「定时任务」页**整页换成了维护面板** —— 上游 `TasksPage.tsx`
只剩 9 行，内容就是 `<MaintenancePanel api={maintenanceApi} notify onChanged onAccount />`。

**我们的做法**（不照搬，避免丢掉自建能力）：我们自建的定时任务页有 10366 B（含任务开关、
间隔编辑、立即执行、下拉刷新），不能替换。于是把维护做成**独立二级页**
`pages/MaintenancePage.tsx`，从「更多 → 诊断」进入，既保留定时任务、又拿到维护功能，
也符合「新功能优先收二级页、不占底部主 Tab」的约定。

**引入内容**：`maintenance-{types,format,shared,details,records,settings,summary,panel}.tsx/ts`
+ `maintenance.css`（9 个文件，约 65 KB），以及 mobile 薄封装 `api/maintenance.ts`。
接入三件套：`lib/routes.ts` 的 `SCREEN_IDS` 加 `'maintenance'`、`App.tsx` 的 `SCREENS` 加
`maintenance: { title: t('维护'), component: MaintenancePage }`、`MorePage` 诊断组加入口
（`icon: 'trash'`，已核对 `Icon.tsx` 的 51 个白名单名，`trash` 在册）。

**MaintenancePanel 的契约**（以后接入别的页面会再用到）：
```ts
{ api: MaintenanceApi, active?: boolean, revision?: number,
  onAccount?(id: string): void, onChanged?(): void | Promise<unknown>,
  notify?(message: string, kind?: 'ok' | 'err'): void }
```
对应我们 store 上的 `toast`、`refresh`、`push` 三个方法（都已核实存在）。

**验证**：`tsc --noEmit` 0；`pnpm run build` 0（`ui/m/mobile.js` 1,425.74 → **1,454.00 kB**，
增量 28.26 kB ≈ 维护面板体量）；`check-mobile-ui.py` 0（图标 / i18n 参数 / 跳转 / 端点拼写全过）。

#### 记忆点 · 步骤 78（批次 B2 页面自动刷新 + B3 第三方许可）

**B2 页面自动刷新**：引入 `page-auto-refresh.ts` / `-timer.ts` / `-controls.tsx` / `.css` 与 mobile 薄封装
`components/PageAutoRefresh.tsx`，接到**三个页面**（报表 / 请求日志 / 运行日志）。
接入模式固定为三步：
1. `const auto = usePageAutoRefresh('<id>')`，id 取自 `PageRefreshTaskId`
   （`'requestsAutoRefresh' | 'logsAutoRefresh' | 'reportAutoRefresh'`，与网关的定时任务同名）；
2. **既有轮询改为受开关驱动**：报表/请求页把 `usePolling(load, 60_000/30_000)` 改成
   `usePolling(load, 0)` + `usePageRefreshTimer(load, auto.enabled, auto.ms)`；日志页保留它自己的
   「阅读模式不跳」轮询逻辑，只把硬编码的 `30_000` 换成 `auto.ms`，并在 `useEffect` 开头加
   `if (!auto.enabled) return`，依赖数组补 `auto.enabled, auto.ms`；
3. 渲染 `<PageAutoRefresh settings={auto} onRefresh={…} disabled={…} />`。

**B3 第三方许可**：`settings-third-party-licenses.tsx` 用 `mobile` 分支自带 `Sheet` + 触发按钮，
无需改写即可嵌入；接在「版本信息」抽屉的「许可与源码」区块之后。
`openExternal` 我们自己实现：先 `window.open(url, '_blank', 'noopener')`，被 WebView 拦截时
**退化为 `copyWithToast` 复制链接** —— 比点了没反应好。

**踩到的坑（以后必查）**：该模块 `import { licenseNotices, sources } from '../../licenses/ICONS_SOURCE.json'`，
路径是**仓库根**的 `licenses/`（不是 `desktop-tauri/` 下），我们的树里原本没有这两个文件
（`ICONS_SOURCE.json` 36.6 KB、`magpie-MIT` 1.1 KB）⇒ 类型检查直接报 `TS2307`。
**引入上游模块时，除了 ts/tsx 依赖，还要检查它 import 的 JSON/文本资源。**

**验证**：`tsc --noEmit` 0；`pnpm run build` 0（`ui/m/mobile.js` 1,454.00 → **1,481.70 kB**，
增量 27.70 kB ≈ 自动刷新控件 + 许可面板）；`check-mobile-ui.py` 0。

#### 记忆点 · 步骤 79（批次 C：脚本插件体系 + 插件运行态）

**这是上游 v3.5.0-beta.1 的主特性：第二种插件形态「脚本插件」**（Bun 运行时 + 脚本包 + 商店）。
引入 16 个模块（约 76 KB）：`plugins-scripts.tsx`(21 KB)、`plugins-script-{catalog,display,install-notice,
options,pagination,progress,settings}`、`plugins-store.tsx`、`plugins-permissions.tsx`，
以及运行态 6 个：`plugin-startup-view.tsx`、`plugin-tasks.tsx`、`plugin-helpers.tsx`、
`plugin-hidden.ts`、`plugin-login-interaction.tsx`、`plugin-provider-settings.tsx`。
递归补齐时**顺带拉进了 4 个 provider 设置模块**（`provider-settings*.tsx/ts`、`provider-icons.ts`）——
它们原属批次 D，但被 C 依赖，所以提前到位（D 批只需接入，不必再复制）。

**mobile 接入两处**：
1. `pages/PluginsPage.tsx` 在「已安装插件」之后加**脚本插件**分段：
   `{payload?.scripts ? <ScriptPluginsPanel state={payload.scripts} request={(path, body) => apiCall(path, {method:'POST', body})} refresh={load} t={t} disabled={Boolean(busy)} /> : null}`。
   数据来自 `PluginsPayload.scripts?: ScriptPluginsState`（A2 已把该类型同步进来）。
   端点：`/api/plugins/scripts/{catalog,install,check,change,settings,prompts}`。
2. `lib/usePluginStartup.ts` + `App.tsx` 调用 `usePluginStartup(!needsServer && !state.authLost, serverIdentity())`
   —— 网关拉起插件期间轮询 `/api/plugins/startup`，进度写回会话。

**类型适配的一个坑**：上游这个 hook 读 `store.get().session?.pluginStartup`，而**我们的会话类型还没有这个字段**
（旧网关也不会返回）⇒ 不能照抄。改为**窄类型读取**：
`(store.get().session as { pluginStartup?: PluginStartupSnapshot } | undefined)?.pluginStartup`，
没有这段数据时 polling 退化为「只读 + 不刷新」，不报错也不影响旧网关。

**iOS 上的预期行为**（已在代码注释写明，避免以后误判成 bug）：脚本插件需要 Bun 运行时，
A1 的宿主闸门会对 iOS 直接拒绝下载（`当前运行形态不支持安装脚本插件（需要下载 Bun 运行时）`），
所以脚本面板能看、能读，但**安装会被明确拒绝** —— 这是设计口径，不是故障。

**验证**：`tsc --noEmit` 0；`pnpm run build` 0（`ui/m/mobile.js` 1,481.70 → **1,526.99 kB**，
增量 45.29 kB ≈ 脚本面板 + 运行态）；`check-mobile-ui.py` 0。

#### 记忆点 · 步骤 80（批次 D：视觉 / 图片工具 + 提供商设置 + 视觉详情）

**引入 13 个模块**：视觉兼容 5 个（`settings-vision-{types,editors,rows,way,panel}`）、
图片工具 3 个（`tools-image-{types,config,history}`）、`request-vision-detail.tsx`、
`use-image-fallback.ts`，以及代理 3 个（`proxy-batch-editor` / `proxy-import` / `proxy-system`，
**保留共享模块但手机端不接入** —— 见下）。mobile 侧新增 3 个薄封装/页面：`api/vision-compat.ts`、
`pages/ToolsImageGeneration.tsx`、`pages/provider-settings-page.tsx`。

**四处接入**：
1. **图片生成** → `ToolsPage` 底部 `<ImageGenerationSection onChanged={() => void load()} />`
   （它内部用 `/api/tools/image-generation/{config,jobs,files}`）；
2. **视觉兼容** → `SettingsPage` 新增「视觉兼容」节，`<VisionCompatibilityPanel api={visionCompatApi} t={t} />`
   （端点 `/api/vision-compatibility`，`load`/`save` 两个方法）；
3. **提供商设置** → 新页 `provider-settings-page`（上游的薄封装，按 `route.params.id` 进入，
   不带 id 时面板自己列可选项）+ 路由 `'provider-settings'` + `App.tsx` 映射 +
   设置页「账号」节末尾入口；
4. **视觉详情** → `RequestsPage` 详情抽屉，在「请求/响应正文」面板之前按需渲染
   `visionDetail(visionRoute) ? <VisionRequestDetail route={visionRoute} t={t} /> : null`。
   注意：上游读 `row.route`，而**我们的 `RequestRow` 类型还没声明该字段**（旧网关也不返回）⇒
   与批次 C 同一手法，用**窄类型读取** `(row as { route?: unknown } | null)?.route`，无字段时不渲染。

**两个「不做」的判断（记下来免得以后重复排查）**：
- `proxy-batch-editor` / `proxy-import` / `proxy-system`：上游**手机端并不直接使用**它们 ——
  它们被上游自己的 `pages/proxy-editor-sheet.tsx`、`api/gateway.ts`、`add-account-dynamic-sheet.tsx`
  引用，而我们这三个文件是**自建版**（功能已覆盖代理编辑、导入、系统代理探测）。
  因此这三个模块**保留在 ui-shared（桌面端用）但不接进手机端**，避免把上游的整套代理编辑流程
  硬塞进我们自建的功能里造成双份入口。
- `use-image-fallback`：上游 `ProviderLogo` 用它；我们的 `ProviderLogo` 已有等价的
  `failedIcon` 失败回退（`onError` 换默认图）⇒ **功能等价，不引入**。

**验证**：`tsc --noEmit` 0；`pnpm run build` 0（`ui/m/mobile.js` 1,526.99 → **1,592.22 kB**，
增量 65.23 kB ≈ 视觉面板 + 图片工具 + 提供商设置页）；`check-mobile-ui.py` 0。

#### 记忆点 · 步骤 81（批次 E 第一批：品牌 + Turnstile + 杂项模块同步）

**引入 12 个模块**：品牌 2（`branding.ts` 4.3 KB、`brand-logo.tsx`）、验证码 2
（`panel-captcha.ts`、`turnstile-widget.tsx`）、签到活动 4（`checkin-benefit-details`、
`checkin-campaign-rewards` 13.6 KB、`checkin-officeace-{types,subscription}`）、
杂项 4（`assistant-read-models` 9 KB、`model-capability`、`usage-query-settings`、`antigravity-login`）。
另有 6 个在 A/C 批已引入（`checkin-campaign-types`、`provider-icons`、`searchable-select`、
`usage-query-task`、`github-failure`、`account-import-result`），本轮无需重复。

**三个文件整取上游版**（我们与 v3.4.2 逐字节相同 ⇒ 无本地增量，零冲突）：
`api/client.ts`(13145→13216 B)、`lib/assistantTools.ts`(24693→20491 B)、
`lib/assistant-custom-models.ts`(4965→5203 B)。整取后**暴露一个类型缺口**：
上游 `assistantTools` 读 `ManageView.providers`，而我们的 `mobile/src/api/gateway.ts` 里
`ManageView` 是**简化版**（只有 models/mappings）⇒ 补上 `providers?: Array<{provider?, providerLabel?, settingsAvailable?}>`。

**品牌接入**（App.tsx）：`mobileBranding.useValue()` + `useBrandingRefresh(mobileBranding, serverIdentity(), !needsServer)`，
并把 `document.title` 从硬编码 `Agent2API` 改为 `branding.displayName || 'Agent2API'` ——
网关可自定义名称/图标，手机端标题跟随。

**Turnstile 接入**（LoginPage）：网关的验证码形态可切 `altcha` / `turnstile`，我们原来只有 ALTCHA。
改法**不重构既有块**，而是把既有 `<Verification>` 包一层条件：
`{captchaConfig?.captchaProvider === 'turnstile' ? (<TurnstileWidget url={url('/api/panel/turnstile')} …/>) : (<Verification>…</Verification>)}`。
`runCaptcha` 加一个 `providerOverride` 参数 —— **因为首帧探测刚拿到面板状态时 React 的 state 还没生效**，
不能从 `captchaConfig` 读 provider，必须由调用方把 `status.captchaProvider` 传下来；
另外该作用域里组件内已有同名字符串变量 `status`，会遮蔽 ⇒ 用局部 `provider` 变量传递（踩过一次）。

**批次 E 仍未完成的两项（明确记下，避免静默漏掉）**：
1. **签到活动接入** `pages/checkin/CheckinBenefits.tsx`：上游用 `CampaignRewards` 组件 +
   `getCampaignRewards/claimCampaignReward/redeemCampaignBenefit`（我们 A2 同步的 `api/checkin.ts` 已含这些函数），
   在上游是「活动福利」节里按 `center.extras.campaigns` 渲染；我们的 CheckinBenefits 有自建的
   「新手福利 / 活动福利 / 成长任务 / 积分与活动」四节，需要把这套奖励 UI 并进「活动福利」节；
2. **Antigravity 登录方式** `pages/add-account-dynamic-sheet.tsx`：上游新增 `AntigravityMethods` 组件 +
   `groupAntigravityCards/antigravityLoginProviders/isAntigravityAccountProvider` 三个助手，
   在选中 Antigravity 系提供商时替换登录方式列表；我们的加号面板是自建版，需手工合并。

**验证**：`tsc --noEmit` 0；`pnpm run build` 0（`ui/m/mobile.js` 1,592.22 → **1,599.79 kB**）；
`check-mobile-ui.py` 0。

#### 记忆点 · 步骤 82（批次 E-2：签到活动 + OfficeACE 订阅接入）

**缺口定位**：活动与订阅的**接口层在我们改过的文件里**（`mobile/src/api/checkin.ts` 7068 B，
只有 23 个导出函数，没有活动/订阅那 5 个），而 A2 同步的是 `ui-shared/checkin.ts`
（**同名不同层**）⇒ 只同步 ui-shared 不够，**手机端 API 层要单独补**。

**补进 `api/checkin.ts` 的 5 个接口**（路径都打在 `${accountPath(id)}` 下）：
- `getCampaignRewards(id)` → `GET  /campaigns`
- `claimCampaignReward(id, campaignId)` → `POST /campaigns/claim`
- `redeemCampaignBenefit(id, code)` → `POST /campaigns/redeem`
- `getOfficeaceSubscription(id)` → `GET  /officeace-subscription`
- `activateOfficeaceSubscription(id, confirmAgreements)` → `POST /officeace-subscription/activate`

**踩到的坑**：我判断"文件里没有 accountPath"用的匹配模式是 `function accountPath`，
而实际写法是 `const accountPath = (id: string) => \`…\`` ⇒ **误判为缺失**，于是追加了一份重复定义 ⇒
`tsc` 报 `TS2300 Duplicate identifier`。删掉我加的那份即可（两份实现逐字等价）。
**教训：判断"有没有某个符号"不能用单一写法模式，TS 自己会在 tsc 里告诉你（这也说明先跑 tsc 是对的）。**

**CheckinBenefits 接入两处**：
1. 「活动福利」节：显示条件从 `plans?.length` 放宽为 `(plans ?? 0) + (campaigns ?? 0) > 0`，
   并在套餐列表**之前**渲染 `center.extras.campaigns`，每行用共享组件
   `<CampaignRewards entry={row} api={campaignApi} t={t} locale={locale()} formatTime={formatStamp} onChange={onChange} />`；
2. 账号行（`OnboardingRow`）末尾：`row.provider === 'officeace'` 时加 `<OfficeaceSubscription accountId={row.id} api={subscriptionApi} t={t} active />`。
   两个共享组件都**不认识我们的 apiCall**，所以按上游做法收成两个小适配器
   （`campaignApi = {query, claim, redeem}`、`subscriptionApi = {query, activate}`）传进去。

**批次 E 仍剩最后一项（明确记下）**：`pages/add-account-dynamic-sheet.tsx`（我们自建的加号面板，28 KB）
需要并入上游的 **Antigravity 登录方式**：`AntigravityMethods` 组件 +
`antigravity-login.ts` 的三个助手（`isAntigravityAccountProvider` / `groupAntigravityCards` / `antigravityLoginProviders`），
在选中 Antigravity 系提供商时替换登录方式列表。模块已于 E-1 引入，只差接入。

**验证**：`tsc --noEmit` 0；`pnpm run build` 0（`ui/m/mobile.js` 1,599.79 → **1,616.98 kB**）；
`check-mobile-ui.py` 0。

#### 记忆点 · 步骤 83（底栏悬浮：找到类名冲突根因 + 加固）

**操作者反馈**：顶部（版本胶囊 + 切换面板按钮）已处理好成悬浮，**底栏仍不悬浮**。

**根因（这次找到了，不是"样式没写"）**：底栏在 `Shell.tsx::TabBar` 里渲染为
`<BottomNavigation className='m-tabbar'>` —— **`m-tabbar` 这个类名同时被 ui-kit 的
`BottomNavigation` 组件使用**，而那个组件自带 Tailwind 工具类：
`border-t border-border bg-surface …` ⇒ **一条通栏上边框 + 一个实心底**，正是真机上看到的"横条"。
`ui/m/mobile.css` 里同时存在两套 `.m-tabbar` 规则（ui-kit 的：`border-top:1px solid var(--m-line)`、
`background: var(--m-surface)`、`flex:none`；我们的 `.m-app .m-tabbar`：`position:fixed`、`border:0`、胶囊）。
我们的权重更高（0,2,0 > 0,1,0），但"哪个样式表后加载 / 有没有被包进 @layer"都会翻盘 ⇒
**底栏形态不该由加载顺序决定**。

**改法（加固）**：`.m-app .m-tabbar` 的关键属性全部用 `!important` 钉住 ——
`position:fixed`、`left/right:16px`、`bottom:calc(safe+10px)`、`height`、`padding:5px`、
`border:0` + `border-top:0`（专门杀 ui-kit 的通栏上边框）、`border-radius:999px`、半透明底
（`color-mix 72%`）、`background-clip:padding-box`、毛玻璃与投影。
顺带把左右边距 12→16px、离底 8→10px，让"悬浮"更明显；`.m-tabbar-gap` 占位高度同步改成 +10px
（否则内容底部会被盖住一截）。

**两项已排除的可能（都做了实测）**：
1. **不是"样式没生效"**：构建产物 `ui/m/mobile.css` 里规则完整存在且带 `!important`
   （含 `position:fixed!important`）。产物里两段 `.m-app .m-tabbar` 是 **`color-mix` 的降级回退**
   （先给不支持的浏览器一个实色 `background`，再用 `color-mix` 覆盖），不是竞争规则 ✓。
2. **不是旧缓存**：`public/sw.js` 虽然存在（`CACHE = 'agent2api-mobile-__BUILD__'`），但
   **构建产物里没有 sw.js**（`ui/m/` 只有 mobile.js / mobile.css / manifest.webmanifest）⇒
   面板不注册 Service Worker ⇒ **真机不会吃缓存的旧 CSS** ✓。
3. **原生层没有底栏**：`PanelViewController.swift` 里 `addSubview` 的只有 webView、statusBar（状态胶囊）、
   version capsule、topPanelButton 四个，没有底部原生视图 ✓。

**结论与下一步**：代码与产物层面底栏已是悬浮胶囊；真机仍显示通栏 ⇒ 需要**一张真机截图**才能定位
（是"上边框还在"、"实心底还在"，还是"胶囊在但没有内容从其下经过"）。已请操作者提供截图与所用包版本。

**验证**：`tsc --noEmit` 0；`pnpm run build` 0（`ui/m/mobile.js` 1,616.98 kB 不变，仅 CSS 变化）；
`check-mobile-ui.py` 0。

#### 记忆点 · 步骤 84（批次 E-3：Antigravity 登录方式 —— 批次 E 完结）

**上游的设计**：Antigravity 有**两家插件** —— `antigravity`（网页登录 / 填凭证）与
`agy-cli`（ACP）。上游把两者**并成一张卡**（`groupAntigravityCards`：只保留主那家、账号数相加、
标签统一叫 `Antigravity`），选中之后再给一个「添加方式」下拉在两者间切换；
切到 `agy-cli` 时表单里**隐藏插件自带的「登录方式」下拉**（`hideMethodPicker`），
否则会出现两个上下叠着的下拉。

**我们的接入（6 处改动，全部锚点命中）**：
1. `import` 三个助手与 `ANTIGRAVITY_ACP_PROVIDER`；
2. `const cards = groupAntigravityCards(providers)` —— **列表与分类计数都改用 `cards`**
   （计数若还按 `providers` 算，会出现"卡片一张、计数两个"的不一致）；
3. 派生：`agyMembers`（当前选中是 Antigravity 系时的全部可登录插件）、
   `effectiveProvider`（选了添加方式就用它，否则用卡片默认）、`effectiveMember`、`formLabel`；
4. 渲染：`agyMembers.length > 1` 时加「添加方式」`Select`，`DynamicForm` 改用 `effectiveProvider`，
   并传 `hideMethodPicker={effectiveProvider === ANTIGRAVITY_ACP_PROVIDER}`；
5. 卡片列表与空列表提示都改用 `cards`；
6. `DynamicForm` 加 `hideMethodPicker?: boolean`，把插件自带的登录方式下拉整块包成
   `{hideMethodPicker ? null : <Select …>…</Select>}`（只隐藏那个下拉，`method.reason`
   与登录指引仍然显示 —— 隐藏过头会让人不知道下一步做什么）。

**注意**：我们的 `selectedProvider` 仍从 `providers`（未合并）里查 —— 那是**故意**的：
用户切到 `agy-cli` 时 `selected` 仍是卡片主那家的 id，`effectiveMember` 负责取到真实成员
（含它的 `label` 与 `source`），两者不要混用。

**本批验收**：`tsc --noEmit` 0；`pnpm run build` 0（`ui/m/mobile.js` 1,616.98 → **1,617.90 kB**）；
`check-mobile-ui.py` 0。

**批次 E 完结状态**：E-1（品牌 / Turnstile / 杂项）`5dca392`、E-2（签到活动 / OfficeACE 订阅）`dd4dc52`、
E-3（Antigravity 登录方式）本次提交。**A–E 五批全部完成**，只剩**批次 F**：
全量对照（上游 25 个 mobile 页面 vs 我们 53 个）、i18n / 图标 / 入口一致性检查、
出包（`only=store` + `publish=true`）、以及**包内标记核对**（U1–U16 与新功能同时在包里）。

#### 记忆点 · 步骤 85（批次 F-1a：遗漏审计 + 插件包设置接线）

**审计结论（用可达性闭包算，比"引用计数"可信）**：
- `ui-shared` 我们 **131 / 上游 131**，`ui-kit` **45 / 45** —— **零缺失** ✓
- 从手机端入口做 import 闭包后，**真·未接线 16 个**，其中上游手机端在用的 12 个是缺口
- 我第一版分类把"未接线模块自身"也算作引用来源 ⇒ 链条看着通其实不通，**已改用闭包重算**
- 另纠正我自己的两处误报：① `maintenance` 的 App 映射其实**在**（我查的是带引号的 key，
  而实际是不带引号的 `maintenance:`）；② `/api/plugin-support` 是我**临时编的端点名**，不是真缺陷

**本次接线（F-1a）**：
1. 补齐两个上游有而我们缺的 mobile 文件：`hooks/useAccountUsage.ts`（4.7 KB）、
   `pages/plugins/PluginPackSettingsSheet.tsx`（3.8 KB）；
2. **插件包设置抽屉接进插件页**：`PluginCard` 加 `onSettings` 参数 + 用共享的
   `PluginSettingsButton`（来自 `plugins-store.tsx` —— 这一步同时把该模块接上了），
   插件页加 `packSettings` 状态、挂载抽屉、把 `onEnabled/onProvider` 接到既有的 mutation 上。
   抽屉带 `server` 标识：切换服务器后 `settingsPack` 只在服务器一致时才找得到 ⇒ 不会误用上一台的包。
3. 类型补全：我们的 `UsageSnapshot` 缺 `queries`（上游 hook 要读）⇒ 补
   `queries?: import('../../../ui-shared/usage-query-task').UsageQueryTask[]`（与上游逐字一致）。

**关于账号用量（重要，先查证再决定）**：上游把余额查询改成了**任务式**（`/api/accounts/usage/start`
`/cancel`、`/snapshot`），并配 `useAccountUsage` 钩子（启动 / 取消 / 状态）。
我先查了**同步端点还在不在** —— 结论：**仍在** ✓
（`server/api/accounts_usage.rs:31` 的 `GET /api/accounts/usage` + `web_shim.rs:1782` 都在）
⇒ **我们自建的「查询余额」按钮没有坏**，上游那套是**增强**（非阻塞 + 进度 + 取消），不是替换。
因此这一步**没有**贸然替换我们已验证可用的查询路径；`useAccountUsage.ts` 已就位并随本批入库，
下一步（F-1b）再决定是否切到任务式（切了要动 614 行的账号抽屉，需单独验证）。

**验证**：`tsc --noEmit` 0；`pnpm run build` 0（`ui/m/mobile.js` 1,617.90 → **1,624.58 kB**）；
`check-mobile-ui.py` 0。

#### 记忆点 · 步骤 86（批次 F-1b：插件运行态接线）

**接入三件（上游做法照搬，参数不猜）**：
1. **卡片上的加载阶段徽标**：`PluginCards` 里 `const startup = usePluginLoadStatus(pack.id, pack.startup)`
   —— 有实时状态用实时值、拿不到退回 payload 快照（**断线时卡片不该整块空白**）；
   徽标用 `pluginFailed(startup) ? 'warn' : startup?.phase === 'ready' ? 'ok' : 'mute'`
   + `pluginPhaseLabel(startup, t)`。
2. **诊断入口**：卡片加「诊断」按钮，点击只调 `requestPluginDiagnostics(pack.id)`
   —— **不各自持有对话框状态**；由插件页订阅该通道后弹 `PluginStartupDialog`
   （`takePluginDiagnostics()` 取 id + `subscribePluginDiagnostics`）。
   对话框的 `retry` 按 id 前缀分流：`script-` 前缀走 `/api/plugins/scripts/change`，
   其余走 `/api/plugins/reload`，之后 `refreshPluginStartup()` + 重新 `load()`。
3. **插件任务**：`<PluginTasks t={t} request={(path, body) => apiCall(path, { method: 'POST', body })} />`
   —— 与脚本插件面板同一套请求约定。

**这一步同时把 4 个此前不可达的模块接通**：`plugin-startup-view`、`plugin-startup`（`pluginFailed`
/`pluginPhaseLabel`）、`plugin-tasks`、以及（F-1a 已接的）`plugins-store`。

**踩到的小坑**：挂载用的锚点我第一次写窄了（只截了半行）⇒ 未命中；同时 `PluginsPage` 里
**没有导入 `useEffect`**（我新增的订阅需要它）⇒ 两者一起修掉。**教训：新增 hook 时先确认该文件
是否已导入对应 React API**。

**验证**：`tsc --noEmit` 0；`pnpm run build` 0（`ui/m/mobile.js` 1,624.58 → **1,629.44 kB**）；
`check-mobile-ui.py` 0。

**F-1 剩余**：`brand-logo`（首页/登录页图标）、`plugin-hidden`（隐藏账号过滤器）、
`proxy-system`/`proxy-import`（系统代理探测与批量导入）、`github-failure`、
`assistant-message-actions`、`clash-proxy`；账号用量是否切任务式（需单独一轮验证）。

#### 记忆点 · 步骤 87（批次 F-1c：品牌图标接登录页 + 首页标题用品牌名）

**背景**：App 标题在批次 E-1 已跟随网关品牌，但**图标没接** —— `brand-logo.tsx`
一直不可达（审计里列为缺口）。

**接入**：
1. **登录页**：顶部原来是个盾牌 `Icon name='shield'`，换成
   `<BrandLogo branding={branding} size={26} />`（网关配置了图标就显示它，没配就显示内置图）；
   标题从写死的「登录 Agent2API」改为 `t('登录 {name}', { name: branding.displayName })`。
2. **首页**：标题改为 `branding.displayName`，原来的「网关运行中」并入副标题
   （`网关运行中 · {n} 个账号启用 · {m} 个限流中`）。

**类型限制（值得记住）**：`components/ui.tsx` 的 `PageHead.title` 是 **`string`**，
不接受 ReactNode ⇒ **首页没法把图标塞进标题**。所以首页只换名称、图标留在登录页
（那里是普通元素，可自由放组件）。若以后要在首页标题里放图标，得先放宽 `PageHead` 的
`title` 类型 —— 那会牵动所有调用方，故本轮不做。

**验证**：`tsc --noEmit` 0；`pnpm run build` 0（`ui/m/mobile.js` 1,629.44 → **1,630.27 kB**）；
`check-mobile-ui.py` 0。

**F-1 剩余**：`plugin-hidden`（隐藏账号过滤器）、`proxy-system`/`proxy-import`、
`github-failure`、`assistant-message-actions`、`clash-proxy`；账号用量是否切任务式。

#### 记忆点 · 步骤 88（批次 F-1d：隐藏账号的筛选与详情）

**判定依据**：我们的 `HiddenAccountsNotice.tsx` 与 **v3.4.2 逐字节相同**（1749 B）⇒
无本地增量 ⇒ **整取上游新版**（4991 B），零冲突。这也是本轮最快的一项：
上游把它从「一张静态提示卡」升级成了**入口按钮 + 抽屉**：
- 入口只显示「未显示账号 N」，加载异常时带一个 `加载异常` 徽标；
- 抽屉里可按原因筛选（全部 / 待就绪 / 未安装 / 已停用 / 加载异常，各带计数）、
  每行给 `hiddenLabel`（徽标）+ `hiddenDetail`（保留 N 个账号 + 原因细节）+ `hiddenAction`（按钮文案），
  以及「去插件页」——并且**知道 packId 时才带 id 深链**去插件页看诊断；
- 状态用 `useSyncExternalStore(subscribePluginStartup, getPluginStartup)` 订阅，
  抽屉打开时 `refreshPluginStartup()`；拿不到状态时显示上次结果并给「刷新状态」，
  文案明确写「**这不代表插件启动失败**」（避免用户误判）。

**这一步把 `plugin-hidden.ts` 接通**（6 个助手全部被用上）✓，也让「账号为什么不见」
从一句笼统提示变成了可逐项查看、可一键跳去修。

**验证**：`tsc --noEmit` 0；`pnpm run build` 0（`ui/m/mobile.js` 1,630.27 → **1,633.82 kB**）；
`check-mobile-ui.py` 0。

**F-1 剩余**：`proxy-system`/`proxy-import`（系统代理探测与批量导入）、
`github-failure`、`assistant-message-actions`、`clash-proxy`；账号用量是否切任务式。

#### 记忆点 · 步骤 89（批次 F-1e：代理页与更新面板整取 + 代理导入接口）

**判定依据（延续"与 v3.4.2 逐字节相同就整取"这条规则）**：
`pages/ProxiesPage.tsx`、`components/AppUpdatePanel.tsx`、`pages/proxy-editor-sheet.tsx`
三个文件我们与 v3.4.2 **逐字节相同** ⇒ 无本地增量 ⇒ **全部整取上游新版**，零冲突。
其中 `proxy-editor-sheet.tsx`（8177 → 11405 B）一步把 **`proxy-import.ts` 与
`proxy-batch-editor.tsx` 两个模块接通**（批量导入与批量编辑）。

**api 层随之要补三处**（我们的 `api/gateway.ts` 是自建版，缺上游新增的字段/函数）：
1. `PoolItem` 补 `nonDirect?: boolean`（把「直连」与真实代理区分开）；
2. `ProxyDraft` 的 `Pick<…>` 列表补 `'nonDirect'`（它是从 `PoolItem` 里挑字段的联合，
   不补就会报 `'nonDirect' does not exist in type 'ProxyDraft'`）；
3. 补 `importProxyItems(items)` → `POST /api/proxies/pool`，并给 `PoolPayload` 补
   `imported?: ProxyImportReport`（导入结果报告）。
   **解析订阅文本/链接的活由共享的 `proxy-import` 做，api 层只负责把成形草稿交给网关。**

**可达性进展**：真·未接线由 **16 → 10**（github-failure、brand-logo 已通；本批再通
proxy-import 与 proxy-batch-editor）。

**验证**：`tsc --noEmit` 0；`pnpm run build` 0（`ui/m/mobile.js` 1,633.82 → **1,647.40 kB**）；
`check-mobile-ui.py` 0。

**F-1 剩余 5 项**（下一步收尾）：`clash-proxy`（上游被 `api/gateway.ts` 使用）、
`proxy-system`（系统代理探测，上游在加号面板用）、`plugin-login-interaction`（同上）、
`assistant-message-actions`（助手页）、`use-image-fallback`（**已决定不接**：
我们的 `ProviderLogo` 已有等价失败回退）。

#### 记忆点 · 步骤 90（批次 F-1f：收尾两个缺口 + 审计口径修正）

**先修正审计口径（重要）**：可达性闭包此前只跟 `from '…'`，**漏掉类型位置的 `import('…')`**
⇒ 只在类型里被引用的模块会被误报"不可达"。修正后重算：**真·未接线 10 → 7**。
其中 `clash-proxy.ts`（265 B，纯类型）我们的 `api/gateway.ts` **早就在用**
（`PoolPayload.clash?: import('…clash-proxy').ClashProxySnapshot`）⇒ **根本不用接**。

**又一处假阳性**：审计说 `assistant-message-actions.tsx` 被 `components/MobileMessageActions.tsx`
引用 —— 实际是**注释里提到了模块名**被字面命中。真实情况：我们的助手页
（`AssistantPage.tsx` 的 L29/595/623）**确实在用我们自己那份 `MobileMessageActions`**，
而那份**故意不引用**共享的 `assistant-message-actions` —— 它自己的注释写明了原因：
共享组件是桌面取向（三个 15px 纯图标小按钮，只有 `title` 提示），手机没有 hover、
`title` 不显示、点击区偏小 ⇒ 我们改成「一个 ⋯ 入口 + 底部动作面板」。
**这不是缺口，是有意的设计决定** ✓

**本批真正补上的两个缺口**：
1. **填入系统代理**：`readSystemProxy(await apiCall('/api/proxies/system'), t)` 读回后
   `setProxyMode('custom')` 并填入 protocol/host/port/username/password；
   读取期间 `locked` 纳入 `readingSystemProxy`（**避免读到一半用户又去改表单**）。
   关键语义写在代码注释里：读的是**网关机器**的系统代理，不是手机的 ——
   出网请求由网关发出，手机上的代理设置跟这条链路无关。
2. **插件登录交互**：`{flow?.state ? <PluginLoginInteraction key={flow.state} flow={flow.state} t={t}
   request={(method, path, body) => apiCall(path, { method, body })} /> : null}`，
   放在「等待账号登录完成」提示之前。

**F-1 完成**：`assistant-message-actions` 与 `use-image-fallback` 两项**明确不接**并记录理由
（前者我们有更适配触屏的同语义实现，后者我们的 `ProviderLogo` 已有等价失败回退）；
其余 3 个（`file-read`、`plugin-provider-settings`、`usage-query-settings`）确认仅桌面端使用。

**验证**：`tsc --noEmit` 0；`pnpm run build` 0（`ui/m/mobile.js` 1,647.40 → **1,652.74 kB**）；
`check-mobile-ui.py` 0。

**下一步**：批次 F-2 —— 全量功能对照（上游 25 个 mobile 页 vs 我们 53 个）、
i18n/图标/入口一致性检查、出包（`only=store`）、包内标记核对（U1–U16 与新功能同在包内）。

#### 记忆点 · 步骤 91（F-3①：日志阅读模式 + 详情双视图）

**缺口来源**：F-2 全量对照里 65 条缺失文案中，`LogsPage` 一家占 **15 条**（最大一项）。

**这是双向合并，不是换文件**：我们与上游都改了 `LogsPage.tsx`，而且**各有对方没有的东西**：
- **我们有**（上游没有）：分类筛选（`CATEGORY_OPTIONS`：插件/账号/模型/网关/请求）、
  库内日志总量（`fetchLogStats` → 副标题「库内共 N 条」）、下载日志文件（`downloadLogsFile`）、导出 JSON（`downloadJson`/`saveBlob`）；
- **上游有**（我们没有）：阅读模式、详情双视图、处理建议、启动结果、各阶段耗时、详细信息、视图说明。
所以**保留我们的增补，把上游的新功能移植进来**（不是整取，否则会丢掉我们那几项）。

**移植的 10 处**：
1. 导入补 5 个共享助手（`logAdvice`/`logDetailText`/`logPlugins`/`logSteps`/`logViewNote`）——
   它们本来就在我们已同步的 `ui-shared/logs.ts` 里（10205 B），**只差被用**；
2. 新状态 `reading` + `detailTab`；
3. `held = paused || reading || page > 1 || detail !== null`（"列表要停住"的四种情形）；
4. 状态文案三态：`阅读模式，列表保持不动` / `自动刷新` / `自动刷新已关闭`；
5. 搜索框补「插件」（上游文案：搜索插件、消息、提供商或账号）；
6. 级别筛选改中文词（`警告及以上` / `仅错误`，原来是 `warn 及以上` / `仅 error`）；
7. **滚动即进阅读模式**（`onScroll` → `setReading(scrollTop > 20)`）；
8. 视图说明 `logViewNote(view, t)`；
9. 阅读模式下也显示「查看最新」按钮（`pending || held`）；
10. **详情双视图**：`SegmentedControl`（事件详情 / 原始记录）+ 事件详情里新增
    `来源`、`处理建议`（`logAdvice`）、`启动结果`（`logPlugins`）、`各阶段耗时`（`logSteps`）、
    `详细信息`（`logDetailText`）；原始记录保留我们自己的 `JSON.stringify(entry, null, 2)` 展示。

**踩到的坑（值得记）**：脚本是**原子**的 —— 最后一处锚点失败时**整份都没落盘**，
前 9 处"成功"的消息具有误导性。原因是锚点里我补写了一条**被截断显示的行**
（原文 `lineHeight: 1.6, padding: 10, margin: 0, …`，我按截断版本补成了别的）。
**教训：锚点一律以"不截断的原文"为准，不要凭截断输出重写。**

**验证**：`tsc --noEmit` 0；`pnpm run build` 0（`ui/m/mobile.js` 1,652.74 → **1,657.03 kB**）；
`check-mobile-ui.py` 0；15 条目标文案**全部补齐**（开关措辞也统一为「阅读模式 / 结束阅读」）。

**F-3 剩余 5 项**：加号面板「已保存的代理」选择 + 多次继续授权回调（12 条）、
`PluginCards` 社区插件/接口不兼容/由其他插件接管/加载诊断（6 条）、
`ToolsPage` 搜索框（6 条）、`AccountSheet` 任务式余额查询（4 条）、`AssistantPage` JSON 附件 + 清空（2 条）。

#### 记忆点 · 步骤 92（F-3②：加号面板可选择「已保存的代理」）

**上游新增的能力**：除了「无代理（直连）」与「自定义」，中间多一档 **「已保存的代理」** ——
直接挑网关代理池里已配置好的那条，不用手抄主机/端口/账号密码。

**接入（7 处）**：
1. 从 `../api/gateway` 引 `fetchProxyPool` 与 `PoolItem`；
2. 状态 `proxyId` / `proxyPool`（`null` = 还没读到）/ `proxyPoolError` / `poolReload`；
3. **按需拉取**：只有 `proxyMode === 'pool'` 才去读代理池 —— 默认直连的用户不该为此多打一次请求；
   `AbortController` 取消 + `serverIdentity()` 校验，切服务器/卸载时不写回旧数据；
4. `proxyPayload()` 增加 pool 分支：未选就抛「请先选择已保存的代理」；
   选中项若 `enabled === false` 或 `resolveError` 就抛「当前代理不可用，请重新选择」——
   **不可用的当场拦下**，否则会把一个已知坏的代理存进账号，之后每次请求都失败还查不出原因；
   通过则返回 `{ source: 'pool', proxyId }`；
5. 模式下拉加一档「已保存的代理」（含触发区文案三态）；
6. 代理池选择器：下拉列出候选（不可用的条目 `disabled`）+ 空态「还没有保存的代理」+
   「重新读取」按钮（`poolReload` 加一即重拉）；触发区文案
   **选中项名 → 当前代理不可用，请重新选择 → 正在读取… → 请选择代理** 四级回退；
7. 「填入系统代理」下方补说明：读取的是**网关电脑当前的 HTTPS 系统代理**，
   且**后续系统设置变化不会自动同步**（避免用户以为它会跟着变）；
   底部补「所选代理会保存到账号设置，后续请求继续使用。」

**验证**：`tsc --noEmit` 0；`pnpm run build` 0（`ui/m/mobile.js` 1,657.03 → **1,658.81 kB**）；
`check-mobile-ui.py` 0；10 条目标文案**全部补齐** ✓

**F-3 剩余 4 项**：`add-account` 的**多次继续授权回调**（2 条，涉及移动端续接多步 OAuth，需单独评估）、
`PluginCards` 社区插件/接口不兼容/由其他插件接管/加载诊断（6 条）、`ToolsPage` 搜索框（6 条）、
`AccountSheet` 任务式余额查询（4 条）、`AssistantPage` JSON 附件 + 清空（2 条）。

#### 记忆点 · 步骤 93（F-3③：插件卡片对齐上游）

**五处改动**：
1. 加 **「社区插件」** 徽标（商店里的包都来自社区，一眼区分官方与社区）；
2. 徽标措辞 **「需要补齐插件」→「接口不兼容」** —— 上游把这件事的口径从"版本低于要求"
   改成了"公共接口不兼容"（**不要求两边版本号一致**）；
3. 诊断按钮 **「诊断」→「加载诊断」**；
4. 不兼容说明改上游措辞，且**优先显示网关给的原因**：
   `pack.compatibilityError || t('插件与当前网关的公共接口不兼容，暂未加载。')`
   + `请根据不兼容原因更新插件或网关；不会要求两者版本号一致。`
   （替代我们原来按 `pack.signed` 分支的两句"自动补齐/不会覆盖"说明）；
5. 提供商行支持 **「由其他插件接管」**：`provider.overriddenBy` 时开关置灰
   （`checked={provider.enabled && !provider.overriddenBy}`、`disabled={… || Boolean(provider.overriddenBy)}`）
   并显示接管徽标；未接管且未加载时显示加载阶段徽标。
   **注释写明理由**：这里改了也不会生效，不说明的话用户会以为是自己没打开。

**验证**：`tsc --noEmit` 0（也确认我们的类型里已有 `overriddenBy` 与 `compatibilityError`）；
`pnpm run build` 0（`ui/m/mobile.js` 1,658.81 → **1,658.86 kB**）；`check-mobile-ui.py` 0；
目标文案全部补齐 ✓

**F-3 剩余 3 项（14 条）**：`ToolsPage` 搜索框（6 条，需换用带搜索的选择器）、
`AccountSheet` 任务式余额查询（4 条，要动 614 行账号抽屉）、
`AssistantPage` JSON 附件说明 + 清空（2 条）、`add-account` 多次继续授权回调（2 条，涉及移动端续接多步 OAuth）。

#### 记忆点 · 步骤 94（全面复查：遗漏 + 回归；**更正一条此前的错误结论**）

**这次复查覆盖 6 项，结论如下**

| 检查项 | 结论 |
|---|---|
| ① 端点在不在 | 本侧引用 **216 个** API 路径（前缀归一后）**全部有上游路由** ✓ **0 缺失** |
| ② 孤儿文件 | 仅 **1 个**：`hooks/useAccountUsage.ts`（有意 staged —— 任务式余额查询待做） |
| ③ 未用导入 | 交给 `tsc --noUnusedLocals`（权威）：**43 条**，其中**只有 1 条是本次引入**（`App.tsx` 的 `applyDocumentBranding`），其余 42 条是**既有遗留**（routing-*、TasksPage、SanitizePage、ServersPage、ui-kit 的 `React`、ui-shared `maintenance-*` 等） |
| ④ 重复定义 | 我第一版的"180 处"是**假阳性**（正则把函数内局部变量当成了顶层重复）⇒ 该项无实际意义，改由 tsc 兜底 |
| ⑤ 本地 vs 远端 | 逐文件 blob 比对：**一致**；差异仅 3 类 —— 刚修的 `App.tsx`（待本次推送）、本地 `docs/DEVELOPMENT-MEMO.md` 是**陈旧副本**（真正的备忘是 `repo-memo.md`，按该路径推送）、46 个远端有而本地无的文件（本工作树是**部分树**，不碍事：推送走 blob→tree→commit，逐文件覆盖，其余文件原样保留 ✓） |
| ⑥ 未推送的本地文件 | **3 个**：`desktop-tauri/ui/sw.js`（构建产物，不入库 ✓）、`docs/mobile-ui/DEPTH-GAP.md`、`docs/mobile-ui/ROUTING-GAP.md`（**两份缺口记录一直没入库 ⇒ 本次补推** ✓） |

**⚠️ 更正我此前的一条错误结论（重要）**：我说过"`public/sw.js` 未进入构建产物 ⇒ 面板不注册 SW ⇒ 真机不会吃旧缓存"。
**这是错的** —— 我当时只查了 `ui/m/` **子目录**。实际产物在 **`ui/` 根**：`ui/sw.js`（5808 B，`__BUILD__` 占位符**已替换**为真实哈希 `agent2api-mobile-968eb9df7712`），
且 `lib/pwa.ts` 以 `register('sw.js', { scope: '/', updateViaCache: 'none' })` 注册 ✓。**SW 确实会打包并接管 `/m` 与 `/m/*`。**

**这直接关系到"底栏改了没效果"**（SW 的实际策略，读自 `ui/sw.js`）：
- 入口页 `/m`、`/m.html`：**network-first**（离线回退缓存）；
- **外壳 `mobile.js` / `mobile.css` / manifest：stale-while-revalidate** ⇒
  **先返回缓存的旧 CSS，新版本留给"下一次加载"**；
- 新 SW 装好后**不立刻 `skipWaiting()`**，要等页面发消息才切换。
⇒ **顶部是原生的（Swift，不经 SW）所以立刻生效；底部是网页的、经 SW 缓存 ⇒ 换包后第一次打开很可能仍是旧 CSS。**
这正是"顶部好了、底栏没变"的合理机制。**验法：装上包含加固的包后，把面板**连开两次**（或先杀掉 App 再开一次）再看底栏 —— 第二次才会用到新 CSS。**（若两次都还是通栏，那就不是缓存问题，需要截图继续查。）

**我这次犯的错（已修，写进备忘）**：清理未用导入时，我用"整行以 import 开头且以引号结尾就整行删"的启发式，
结果把 `import { applyDocumentBranding, useBrandingRefresh } from '../../ui-shared/branding'` **整行删掉**，
连带删掉了仍在使用的 `useBrandingRefresh` ⇒ `tsc` 立刻报 `TS2304: Cannot find name 'useBrandingRefresh'`。
**教训：绝不要用子串匹配整行删除 import —— 要改的是括号里的名字列表。**（同样是"推送前必跑三项检查"拦下来的。）

**验证**：`tsc --noEmit` 0；`pnpm run build` 0（`ui/m/mobile.js` 1,658.86 kB）；`check-mobile-ui.py` 0。

**仍待办**：F-3 剩余 4 项（`ToolsPage` 搜索 6 条 / `AccountSheet` 任务式余额查询 4 条 / `AssistantPage` 2 条 / 多次继续授权回调 2 条）。

#### 记忆点 · 步骤 95（F-3⑤：账号余额改任务式查询 + **消除孤儿文件**）

**为什么换**（先查证过才动手）：同步接口 `GET /api/accounts/usage?id=` 在新网关上**仍然存在**
（`server/api/accounts_usage.rs:31`），所以我们的旧路径**不是坏掉**；问题是它**要等上游把整批查完才返回** ——
上游慢的时候按钮一直转，用户既看不到进度也没法取消。任务式是 `/usage/start` 立刻拿任务号、
`/usage/snapshot` 轮询进度 ⇒ 于是「启动中…／重新查询／取消查询」和进度文案都有落脚点。

**接入（7 处）**：
1. 导入并调用 `useAccountUsage(accountId, Boolean(account && supportsUsage(account)))`
   —— **这一步把审计里唯一的孤儿文件 `hooks/useAccountUsage.ts` 接上了** ✓；
2. **去掉我们自己那份快照拉取**（原本与钩子会各轮询一遍同一账号 ⇒ 重复请求）；
3. 钩子的 `row` 直接用于展示；`refresh_token_expired` 结论**回灌给列表**（`onChanged()`，
   只在结论真变时触发，避免轮询把它变成反复刷新）；
4. 余额按钮三态：`启动中… / 重新查询 / 查询余额`；
5. 进度文案 `usage.status`（空则不占位）；
6. `usage.row?.stale` 时提示 **「历史余额，尚未按新配置验证」**（否则旧结论会被当成当前结论）；
7. 查询中显示 **「取消查询」**（`usage.cancel()`）。

**⚠️ 我这一项里犯了一个严重错误（已修复，教训值得记）**：
我删旧 `queryUsage` 函数时用「从它的注释行到下一个 `const usageView =` 行」做区间，
**但这中间夹着 `saveName` / `credentialRows` / `expiresAt` / `limits` / `promote` /
`limiterSummary` / `suspendedReason` 等一大批声明** ⇒ **一次误删约 60 行**，`tsc` 立刻报
7 个 `Cannot find name`。
**修复方式**：本地没有 git，但**远端 main 上有完好版本** ⇒ 用 GitHub contents API 取回
（27613 B，校验含 `saveName`/`credentialRows`/`queryUsage` 三个标识）恢复，
再用**花括号配平**定位函数真正的结尾（这次删了 24 行，精确）重做。
**教训：删除代码块绝不能用"下一个我认识的符号"当区间终点 —— 那中间可能有大量声明。
要么按花括号配平，要么按行精确匹配。**

**验证**：`tsc --noEmit` 0；`pnpm run build` 0（`ui/m/mobile.js` 1,658.86 → **1,660.84 kB**）；
`check-mobile-ui.py` 0；4 条目标文案 + 钩子**全部就位** ✓；**孤儿文件已消除** ✓。

**F-3 剩余 3 项**：`ToolsPage` 搜索框（6 条）、`AssistantPage` JSON 附件 + 清空（2 条）、
`add-account` 多次继续授权回调（2 条）。
