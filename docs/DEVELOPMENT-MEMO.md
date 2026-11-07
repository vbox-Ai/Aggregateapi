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

### 待继续
- Phase 2.1：插件设置完整化（镜像/签名/更新策略已在上游，手机端已有入口；可补 GitHub Token 之外的字段）
- Phase 2.2：插件自定义 UI 页面（动态路由 + iframe 容器）
- 然后进入 Phase 3：路由、MCP/Skill、自定义提供商、日志高级能力、批量操作
- Phase 4：移除桌面面板按钮和 `/` 入口

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
