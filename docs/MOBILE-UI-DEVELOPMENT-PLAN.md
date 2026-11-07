# Agent2API 手机面板 UI 结构与开发方案

> 目标：逐步移除桌面面板 `/`，只保留手机面板 `/m`。
> 本文先分析当前手机 UI 结构，再结合前一轮功能差距，给出可落地的开发方案。

---

## 1. 结论摘要

当前手机面板不是“简单壳”，它已经是完整的 React SPA：

- 5 个主 Tab：首页、报表、账号、AI 助手、更多；
- 17 个二级页面：模型、Key、代理、任务、请求、日志、设置、文档、Agent、工具、服务器、签到、插件等；
- 有路由栈、底部导航、下拉刷新、分页、Toast、Sheet、登录态、离线态、多服务器切换；
- 已复用大量网关 API。

但它仍然**不能直接替代桌面面板**，主要差距是：

1. 手机 UI 源码已从上游 `aimod-cc/Agent2API` 同步到 `vbox-Ai/Aggregateapi`（commit `cedab6c`）；
2. Key 页可复制/启停/删除，但缺少新建和范围编辑；
3. 账号只能动态登录，不能手工编辑/导入凭证；
4. 插件页有 GitHub 访问方式/镜像/更新策略，但没有 GitHub Token 字段；
5. 安全、备份/恢复缺失；系统信息已有 `SystemInfoSheet`，缺的是服务控制；
6. iOS 原生没有文件下载/分享/选择器桥接；
7. 面板登录态不持久（WKWebView 非持久存储）；
8. 插件自定义 UI 页面没有迁移；
9. 路由、MCP/Skill、自定义提供商等高级管理不完整。

建议按 **Phase 0 → Phase 4** 推进，预计 40～60 个开发日（单人，含真机联调）。

---

## 2. 当前手机面板 UI 结构

### 2.1 入口与壳

```text
m.html
  ├─ locale / theme 引导
  ├─ i18n.js
  ├─ m/mobile.css
  └─ m/mobile.js（React SPA）
```

`m.html` 负责：

- 设置语言（zh-Hans / zh-Hant / en / ja / ko / pt-BR）；
- 设置主题（system / light / dark）；
- PWA manifest；
- 安全区 viewport；
- 挂载 `#root`。

### 2.2 根组件

手机 bundle 的根组件 `AB` 逻辑：

```text
if (packaged && !server) -> 服务器选择页
else -> m-app
          ├─ 顶部/底部导航
          ├─ 当前 route 页面
          ├─ Sheet / Dialog / Toast
          └─ 登录失效弹层
```

关键状态：

- `route.screen`：当前页面；
- `route.stack`：返回栈；
- `server`：当前网关；
- `servers`：多网关列表；
- `session`：面板登录态/账号数据；
- `authLost`：`login` 或 `key`；
- `offline`：离线状态；
- `serverRevision`：切换服务器后强制刷新页面。

### 2.3 主 Tab

底部 5 个主 Tab：

```text
home       首页
report     报表
accounts   账号
assistant  AI 助手
more       更多
```

### 2.4 “更多”页结构

“更多”页是分组宫格：

```text
转发链路
  ├─ 签到中心
  ├─ 模型管理
  ├─ Agent 配置
  ├─ 工具服务
  ├─ 网络代理
  ├─ 网关 Key
  └─ 接口文档

监控
  ├─ 请求日志
  ├─ 运行日志
  └─ 定时任务

系统
  ├─ 网关插件
  ├─ 设置
  └─ 报表
```

### 2.5 路由表

```text
home
report
accounts
assistant
models
keys
proxies
tasks
requests
logs
settings
docs
agent
tools
servers
checkin
plugins
more
```

### 2.6 页面壳与组件

手机 UI 的基础类名/组件：

```text
m-app          根容器
m-scroll       页面滚动容器
m-page         页面内容
m-section      分组
m-card         卡片
m-row          行
m-t1 / m-t2    主/次文本
m-logo         图标容器
m-chev         右侧箭头
m-sheet        底部弹层
m-dialog       对话框
m-toast        提示
```

页面模式：

- 列表 + 卡片；
- 底部 Sheet 编辑；
- 顶部返回 + 标题；
- 下拉刷新；
- 分页加载；
- 空状态；
- 底部固定操作栏。

### 2.7 数据层

手机 bundle 通过统一 API client 调用网关：

```text
Ce("/api/...")        请求
zs({onRefresh})       下拉刷新
Qs(...)               轮询/分页
serverRevision        服务器切换后刷新
```

认证：

- 面板登录；
- API Key 回退；
- `authLost` 弹层；
- 会话失效后跳 `/login`。

### 2.8 原生壳

iOS App：

```text
PanelViewController
  ├─ WKWebView 加载 http://127.0.0.1:3065/m
  ├─ 隔离登录容器
  ├─ A2A_LOGIN_OPEN 注入
  ├─ supervisor 前后台控制
  └─ 桌面面板按钮（/）
```

当前关键限制：

```swift
config.websiteDataStore = .nonPersistent()
```

所以 App 重启后面板登录态不保留。

---

## 3. 当前 UI 的优势

- 已有完整路由和底部导航，不是单页 Demo；
- 账号、签到、模型、代理、日志、任务、文档、Agent 等页面已存在；
- API 层大量复用桌面；
- 有 PWA、离线态、服务器切换；
- 有安全的登录隔离容器；
- supervisor 已能按前后台启停网关。

这意味着不需要从零写手机端，而是在现有 SPA 上补“管理型页面”。

---

## 4. 第三轮补充审计：新增遗漏

### 4.1 手机 UI 源码：已同步到本仓库

原来 `vbox-Ai/Aggregateapi` 只有：

```text
ui/m/mobile.js
ui/m/mobile.css
ui/m.html
```

`mobile.js` 是压缩后的 React bundle，不是源码。

现在已从上游 `aimod-cc/Agent2API` 的 `v3.4.2` 拉取并推送：

```text
commit: cedab6c78233010161ed1d19bfe28779e3fc2870
```

仓库中已有：

```text
desktop-tauri/mobile/        React + Vite + Capacitor 手机工程
desktop-tauri/ui-kit/        @ui 组件源码
desktop-tauri/ui-shared/     共享业务组件
desktop-tauri/ui-islands/    共享 islands（含 add-account-dynamic-fields）
desktop-tauri/ui/aliyun-captcha.js
```

`agent2api-universal/docs/MOBILE-CALLSITES.md` 里也明确写了源路径来自：

```text
desktop-tauri/mobile/src/
```

当前开发入口：

```bash
cd desktop-tauri/mobile
pnpm install
pnpm run typecheck
pnpm run build
```

构建产物落到 `desktop-tauri/ui/m`，再同步到发布包。

附件 `agent2api-providers-3.4.2-...zip` 不是手机 UI 源码，而是 provider 插件包（含 `pack.json`、`bin/agent2api-providers.exe`、`ui/checkin`），不能替代 mobile 源码。

### 4.1.1 三种开发方式

| 方式 | 可行性 | 适用 | 风险 |
|---|---|---|---|
| A. 同步上游 mobile 源码到 fork | **推荐** | 所有 P0/P1 功能 | 需要处理上游同步和版本对齐 |
| B. 独立 mobile 源码仓构建，产物复制到 Aggregateapi | 可行 | 不想污染 fork | 产物/版本管理更复杂 |
| C. 直接改压缩 `mobile.js` | 临时可行 | 改文案/CSS/小按钮 | 不能可靠加页面/表单/路由；不可维护 |

**结论：**

- 做完整手机-only：必须用 A 或 B；
- 只做一两个文字/样式热修：可以 C，但不建议作为长期方案；
- 当前源码已找到，不需要“从零重建”，也不需要继续找。

构建依赖：

```text
desktop-tauri/mobile/
desktop-tauri/ui-kit/       # @ui 源码
desktop-tauri/ui-shared/    # github-access-editor 等共享组件
```

`vite.config.ts` 的 alias：

```text
@ui -> ../ui-kit/src
outDir -> ../ui/m
```

所以只复制 `mobile/` 不够，必须同时有 `ui-kit`、`ui-shared` 和 `ui-islands`。

### 4.1.2 源码拉取与构建验证（已完成）

已从上游 `aimod-cc/Agent2API` 的 `v3.4.2` 拉取并推送到本仓库：

```text
commit: cedab6c78233010161ed1d19bfe28779e3fc2870
```

新增：

```text
desktop-tauri/mobile/        180 files
desktop-tauri/ui-kit/         57 files
desktop-tauri/ui-shared/      65 files
desktop-tauri/ui-islands/    258 files
desktop-tauri/ui/aliyun-captcha.js
```

验证：

- `pnpm install` 成功；
- `pnpm exec tsc --noEmit` 通过；
- `pnpm run build` 成功；
- 构建出的 `mobile.js`:

```text
1,062,948 bytes
SHA256 67663cf046b8800eddffd18f8a0ed938a9846ef89adca75cd993feb1f057662da
```

与当前 `3.4.182` 的 `ui/m/mobile.js` 完全一致。

结论：**源码基线已确认，Phase 0 不再阻塞，项目可以进入功能开发。**

仍需补的工程项：

- 把 mobile 构建接入 CI；
- 锁定 `pnpm-lock.yaml`；
- 把 `desktop-tauri/ui/aliyun-captcha.js` 等共享静态资源纳入构建；
- 让 `ui/m` 产物由源码构建，而不是手改。

### 4.2 请求重放/请求详情

桌面请求页支持请求重放、完整快照、失败链路。  
手机 bundle 中“重放”计数为 0，手机请求页主要是列表/筛选/详情摘要。

手机-only 后，排障会缺一块。

### 4.3 日志/报表导出

手机有日志页、报表页，但：

- 没有桌面级列设置；
- 没有完整导出；
- 没有请求重放；
- 没有多维度报表组合。

需要补导出/分享，且依赖 iOS 文件桥接。

### 4.4 账号批量/分组/列设置

手机 bundle 中：

```text
列设置：0
批量：0
```

桌面有账号表列设置、分组、批量启用/停用/删除、拖拽排序。  
手机卡片页可以日常使用，但批量管理会明显不足。

### 4.5 客户端配置导入/导出

桌面可以：

- 从桌面客户端导入账号；
- 逐账号导出；
- 写客户端配置；
- 批量复制 JSON。

手机不能访问桌面文件系统。  
手机-only 需要至少支持：

- 复制/分享账号 JSON；
- 从文件导入；
- 生成配置文本。

### 4.6 多服务器配置隔离

手机有 `servers` 多网关切换，桌面没有。  
需要确认：

- GitHub Token 是全局还是每个服务器独立；
- 插件设置是否随服务器切换；
- Key/账号/日志是否按服务器隔离；
- 切换服务器是否清理旧登录态。

否则会出现“切了服务器但设置串台”。

### 4.7 原生登录持久化

前面已提到 `nonPersistent`。  
手机-only 必须补 Keychain 登录态，否则每次启动都要重新登录。

### 4.8 WKWebView 下载/分享/文件选择

手机没有：

- `WKDownloadDelegate`；
- `UIActivityViewController`；
- `UIDocumentPickerViewController`。

备份、日志导出、账号 JSON、插件 zip 都需要这些。

### 4.9 插件自定义 UI 页面

桌面有 `adoptPluginPages`，手机没有。  
需要动态路由、插件菜单、iframe 容器、权限隔离。

### 4.10 高级设置未迁移

- 出站指纹脱敏；
- 连通性测试；
- 开发者角色兼容；
- 会话图片压缩；
- models.dev 元数据刷新；
- 提示词文件/模式；
- 安装信息/系统信息。

### 4.11 硬限制

不能硬搬到手机：

- 本地 stdio MCP / Skill 进程；
- 写桌面客户端配置；
- Windows/macOS/Linux 安装器；
- 后台常驻 API（supervisor 模式会停网关）。

这些应标注“桌面专属”或提供手机替代（复制配置、远程 MCP）。

### 4.12 源码复核后的真实差异（摘要）

| 领域 | 手机源码实际能力 | 桌面能力 | 优先级 |
|---|---|---|---|
| Key | 复制、启停、删除 | 新建、可用范围/提供商/模型白名单 | P0 |
| 账号 | 动态登录、凭证状态/刷新、备注、余额、限流、排序 | 手工凭证编辑、导入/导出、客户端导入、批量 | P0 |
| 模型 | 目录、启停、删除失效映射 | 映射、思考等级、上下文窗口、工具能力编辑 | P1 |
| 路由 | 无独立 routing 页 | 路由组、顺序、回退、预演 | P1 |
| 工具 | ToolsPage 管网络搜索/视觉；AgentPage 管网关侧 Skill/MCP | 本机 MCP/Skill 安装、写客户端目录 | P1 + 硬限制 |
| 自定义提供商 | 无完整 CRUD | 新建/编辑/拉模型/删除 | P1 |
| 插件 | 安装/更新/启停/卸载、通道、自动更新、GitHub 镜像 | GitHub Token、插件自定义 UI 通用挂载 | P0 token / P1 UI |
| 安全 | 登录/退出 | 改密码、重置管理员、会话失效、安全设置 | P0 |
| 备份 | 无 | 整库加密备份/恢复、云同步 | P0 |
| 日志/请求 | 列表、筛选、详情 | 重放、导出、列设置、完整快照 | P2 |
| 账号表格 | 卡片/筛选/排序 | 列设置、批量、拖拽分组 | P2 |
| 系统信息 | `SystemInfoSheet` 已有 | 服务控制、安装信息更完整 | P2 |
| 多服务器 | 有 `servers` | 无 | 手机独有 |
| 后台 API | supervisor 前台启停 | 桌面可常驻 | 产品差异 |

其中“手机没有系统信息”是错误结论；手机已有 `SystemInfoSheet`，缺的是 supervisor/服务控制。  
“手机没有 MCP/Skill”也不准确；AgentPage 可以管理网关侧资源，缺的是本机安装和本地 stdio。

---

## 5. 开发原则

1. **先拿源码，再改 UI**：不要在压缩 bundle 上做大功能。
2. **API 先复用桌面**：手机端只补 UI 和少量 BFF 适配，不重复实现业务。
3. **移动优先的表单/弹层**：所有编辑用 Sheet/全屏页，不用桌面表格。
4. **所有破坏性操作二次确认**：删除 Key、重置管理员、恢复备份。
5. **文件能力走原生桥**：下载、分享、选择文件统一封装。
6. **登录态走 Keychain**：不把 refresh token 放 localStorage/明文文件。
7. **功能开关**：桌面移除前用 `mobileParity` 开关逐项放量。
8. **保留桌面兜底**：P0 未完成前不删桌面入口。

---

## 6. 分阶段开发方案

### Phase 0：源码与工程基础（5～7 天）

**状态：源码拉取、推送、typecheck/build 已完成（2026-11-07）。**  
剩余：CI 接入、锁文件、静态资源整理。

**目标：能可持续开发手机 UI。**

任务：

1. 引入 upstream mobile 源码：
   - 从 `aimod-cc/Agent2API/desktop-tauri/mobile/` 同步；
   - 同时同步它依赖的 `desktop-tauri/ui-kit/` 和 `desktop-tauri/ui-shared/`；
   - 保持 React + Vite + 现有 `@ui` 组件；
   - 对齐上游 `v3.4.2` 与当前 `ui/m/mobile.js` 的构建版本；
   - 在 fork 中保留上游 patch 能力，避免下次同步冲突。
2. 建立构建链：
   - `pnpm install`
   - `pnpm build`
   - 输出到 `desktop-tauri/ui/m/`
3. 抽出 API client / 类型：
   - `src/lib/api.ts`
   - 统一错误、认证、服务器切换。
4. 建立路由注册表：
   - 当前 `RB` 改为可扩展的 `routes.ts`；
   - 支持动态插件路由 `plugin:<pack>:<page>`。
5. 建立 UI 基础组件：
   - `SettingsGroup`、`FormField`、`SecretInput`、`Sheet`、`ConfirmDialog`、`EmptyState`、`StatusBadge`、`FilePicker`。
6. CI：
   - 新增 `mobile-ui` 构建 job；
   - 校验 bundle 产物；
   - 禁止直接提交压缩 bundle。
7. 真机测试基线：
   - iPhone RootHide/TrollStore；
   - 无桌面面板；
   - supervisor 模式。

验收：

- 修改一个手机页面能从源码构建并在 App 中看到；
- 有路由/组件/API 的最小测试；
- CI 能产出 `ui/m`。

---

### Phase 1：P0 手机-only 闭环（12～18 天）

目标：没有桌面面板也能完成“安装 → 登录 → 建 Key → 加账号 → 装插件 → 备份”。

#### 1.1 网关 Key 管理（3 天）

功能：

- Key 列表；
- 新建 Key；
- 编辑名称/备注；
- 启用/停用；
- 删除；
- 复制明文；
- 可用范围：
  - 全部模型；
  - 指定提供商；
  - 指定模型；
  - 过期时间；
  - 限额（如后端支持）。

页面：

```text
keys
  ├─ KeyList
  ├─ KeyCreateSheet
  ├─ KeyEditSheet
  └─ ScopePicker
```

验收：

- 手机端能创建第一把 Key；
- 能限制到指定模型/提供商；
- 能撤销/删除；
- 桌面端能看到同一把 Key。

#### 1.2 账号凭证编辑与导入（5 天）

功能：

- 动态登录（保留现有）；
- 无动态登录时，展示 provider 声明的手工凭证表单；
- 编辑已有账号的凭证；
- 导入 JSON/CSV；
- 导出账号 JSON；
- 复制凭证；
- 客户端配置文本复制。

组件：

```text
ProviderLoginMethods
CredentialForm
CredentialImportSheet
CredentialExportSheet
```

关键：

- 桌面 provider schema 要暴露给手机；
- 对没有 schema 的 provider，显示“桌面专属”而不是空白；
- 小浣熊等 provider 需要单独的移动登录/凭证入口。

验收：

- 手机端可添加小浣熊账号（手工凭证或动态登录）；
- 可修复过期凭证；
- 可导入/导出账号。

#### 1.3 GitHub Token（1 天）

现状：手机已有 GitHub 访问方式/镜像/加速源设置（`GithubAccessSettingsPanel`），但没有 token 字段。

功能：

- 在手机「插件设置 → GitHub 访问」增加 GitHub Token；
- 保存/清除；
- 显示是否已配置；
- 说明所需权限；
- 测试请求。

验收：

- 手机端填 token 后，插件“在网关下载并安装”不再限流；
- 桌面/手机共用同一服务端设置。

#### 1.4 安全设置（2 天）

功能：

- 修改面板密码；
- 退出所有会话；
- 重置管理员；
- 二次确认；
- 重置后清空数据提示。

验收：

- 手机端可改密码；
- 改密码后其他会话失效；
- 重置管理员有明确警告。

#### 1.5 备份/恢复 + 原生文件桥（4 天）

功能：

- 整库加密备份；
- 恢复备份；
- 备份密码；
- 导出到“文件”；
- 从“文件”导入；
- 进度/错误提示。

原生：

- `WKDownloadDelegate`；
- `UIActivityViewController`；
- `UIDocumentPickerViewController`。

验收：

- 手机端能备份到“文件”；
- 能恢复到空数据库；
- 恢复前二次确认；
- 失败有可读错误。

#### 1.6 登录持久化（2 天）

功能：

- Keychain 保存 refresh token；
- 启动自动登录；
- 退出登录清除 Keychain；
- token 过期回登录页。

原生：

```text
PanelSessionStore.swift
  save/load/clear
```

验收：

- 杀掉 App 再打开，不需要重新登录；
- 退出登录后不再自动登录；
- token 失效能正确回到登录页。

---

### Phase 2：插件生态与页面（7～10 天）

#### 2.1 插件设置完整化（2 天）

- GitHub Token；
- 更新通道/beta；
- 自动更新；
- 镜像/下载源；
- 签名/未签名策略；
- 安装日志；
- 重新加载/健康检查。

#### 2.2 插件自定义 UI 页面（3 天）

- 读取 `packs[].ui[]`；
- 动态路由 `plugin:<pack>:<page>`；
- 手机“更多”页注入插件菜单；
- iframe 容器加载 `/plugins/<pack>/ui/...`；
- 限制 origin/权限；
- 插件页面返回/标题/加载态。

#### 2.3 Provider 文档与日志（2 天）

- provider 文档入口；
- 登录方式说明；
- 支持模型/能力；
- 最近失败原因；
- 插件日志。

---

### Phase 3：高级管理（12～18 天）

#### 3.1 路由配置（4 天）

- 路由组；
- 提供商/账号顺序；
- 失败后备选；
- 模型别名；
- 路由预演；
- 迁移旧配置。

#### 3.2 工具 / MCP / Skill（3 天）

现状：AgentPage 已能管理网关侧 Skill/MCP；ToolsPage 管网络搜索/视觉分析。

- 扩展 AgentPage 的资源管理；
- 增加远程 HTTP MCP 的安装/卸载；
- 工具 API Key 的网关侧管理；
- 本机 stdio MCP / 写客户端目录明确标注“桌面专属”；
- 不在手机上硬搬本地进程安装。

#### 3.3 自定义提供商（3 天）

- 新建/编辑；
- Base URL/协议；
- 拉取模型；
- 删除；
- 与 Key 范围联动。

#### 3.4 日志/请求/报表（3 天）

- 请求详情；
- 请求重放；
- 时间范围/状态/提供商/账号筛选；
- 导出/分享；
- 报表维度。

#### 3.5 账号批量/分组（2 天）

- 批量启用/停用/删除；
- 分组；
- 排序；
- 备注；
- 列表密度/列设置（移动版）。

#### 3.6 系统/服务控制（1～2 天）

现状：`SystemInfoSheet` 已有版本、运行形态、系统、监听地址、运行时长、数据/日志目录、端口、账号/模型/Key 统计。

只补缺的部分：

- supervisor 状态；
- 重启 supervisor；
- 停止/启动网关；
- 复制诊断信息；
- 不重复实现已有系统信息。

---

### Phase 4：移除桌面面板（3～5 天）

1. 增加 `mobileParity` 开关；
2. 所有 P0 项验收通过后默认关闭桌面入口；
3. 移除 `PanelViewController` 的“桌面面板”按钮；
4. `/` 路由重定向到 `/m`，或仅保留调试开关；
5. 清理 `showingDesktop` / `toggleDesktopPanel`；
6. 回归：
   - 新装；
   - 升级；
   - 备份/恢复；
   - 插件安装；
   - 多服务器；
   - 后台/前台；
   - RootHide。

---

## 7. 详细模块设计

### 7.1 Key 管理

页面：

```text
KeysPage
  ├─ KeyCard
  ├─ KeyCreateSheet
  ├─ KeyEditSheet
  └─ KeyScopeSheet
```

字段：

- 名称；
- Key 明文（创建后只显示一次）；
- 启用；
- 过期时间；
- 提供商范围；
- 模型范围；
- 限额（如果后端支持）；
- 备注。

### 7.2 账号凭证

页面：

```text
AccountDetail
  ├─ 基本
  ├─ 凭证
  ├─ 代理
  ├─ 限额
  └─ 客户端配置
```

凭证类型：

- API Key；
- Cookie；
- JWT；
- Refresh Token；
- OAuth；
- 手机号/验证码；
- 二维码/浏览器登录。

### 7.3 备份/恢复

页面：

```text
Settings > 数据
  ├─ 备份
  ├─ 恢复
  ├─ 导出日志
  └─ 重置
```

流程：

```text
备份：选择密码 → 生成加密文件 → 分享到“文件”
恢复：选择文件 → 输入密码 → 预览 → 确认 → 重启网关
```

### 7.4 插件自定义页面

```text
PluginPageFrame
  ├─ iframe src=/plugins/<pack>/ui/<page>
  ├─ postMessage 权限
  ├─ 加载/错误态
  └─ 返回
```

安全：

- 只允许本机 gateway origin；
- 禁止 external navigation；
- 不允许访问 Keychain；
- 文件下载走原生桥。

### 7.5 原生文件桥

```text
FileBridge.swift
  ├─ WKDownloadDelegate
  ├─ UIActivityViewController
  ├─ UIDocumentPickerViewController
  └─ temporary file cleanup
```

JS 侧：

```text
window.webkit.messageHandlers.a2aFile.postMessage(...)
```

### 7.6 登录持久化

```text
PanelSessionStore.swift
  ├─ Keychain save/load/clear
  ├─ token refresh
  └─ logout
```

注入：

- document-start 注入 refresh token；
- 或设置 HttpOnly cookie；
- 不写 localStorage 明文。

---

## 8. API/契约建议

优先复用桌面 API。手机端需要新增的 API 调用：

```text
GET/POST/PATCH/DELETE /api/keys...
GET/PATCH /api/accounts/<id>/credentials...
POST /api/accounts/import
GET /api/accounts/export
GET/POST /api/settings/backup...
GET/POST /api/settings/security...
GET/POST /api/plugins/settings...
GET /api/plugins/<id>/logs
GET /api/system/info
GET /api/system/diagnostics
```

要求：

- 所有写操作有明确错误码；
- 敏感字段脱敏；
- 文件上传/下载使用 multipart/二进制；
- API 版本与手机 bundle 兼容；
- 桌面/手机共享同一套服务端逻辑。

---

## 9. 测试计划

### 9.1 功能

- 新装 → 注册管理员 → 建 Key → 加账号 → 装插件 → 重启 App → 自动登录；
- 备份 → 清库 → 恢复；
- 改密码 → 其他会话失效；
- 插件安装/卸载/更新；
- 插件自定义页面；
- 多服务器切换；
- 前台/后台 supervisor。

### 9.2 设备

- iPhone RootHide/Relaxin；
- TrollStore；
- 无桌面面板；
- 不同屏幕尺寸/动态岛；
- 文件 App 导出/导入。

### 9.3 回归

- 桌面面板仍可用（Phase 4 前）；
- 旧数据升级；
- 旧 Key/账号不丢；
- 插件版本兼容。

---

## 10. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 本 fork 缺手机源码 | 无法持续开发 | 从上游 `aimod-cc/Agent2API/desktop-tauri/mobile` 同步 |
| API 与桌面漂移 | 手机功能失效 | 共用 API client + 契约测试 |
| iOS 文件限制 | 备份/导出不可用 | 原生 FileBridge |
| WKWebView 登录丢失 | 每次重登 | Keychain 持久化 |
| 插件自定义页面安全 | XSS/越权 | iframe sandbox + origin 限制 |
| 本地 MCP/Skill 不可运行 | 功能缺失 | 标注桌面专属/远程 MCP |
| supervisor 后台停网关 | 后台 API 中断 | 产品明确提示；需要常驻则回 A1 |
| 多服务器设置串台 | 配置错误 | per-server settings namespace |
| 移除桌面过早 | 用户无法管理 | mobileParity 开关，P0 验收后移除 |

---

## 11. 里程碑与估算

| 阶段 | 内容 | 估算 |
|---|---|---|
| Phase 0 | 源码/构建/路由/组件/CI | 5～7 天 |
| Phase 1 | P0 手机-only 闭环 | 12～18 天 |
| Phase 2 | 插件生态/自定义页面 | 7～10 天 |
| Phase 3 | 路由/MCP/自定义提供商/日志 | 12～18 天 |
| Phase 4 | 移除桌面/回归 | 3～5 天 |
| 合计 | 单人 | 39～58 天 |

如果只做“手机日常可用”的最小版本，可先做 Phase 0 + Phase 1（约 17～25 天），桌面面板继续保留作为兜底。

---

## 12. 最终建议

1. 先解决 **手机 UI 源码/构建链**，否则后续开发不可维护。
2. 按 P0 顺序：Key → 账号凭证 → GitHub Token → 安全 → 备份 → 登录持久化。
3. 再做插件自定义页面和文件桥接。
4. 最后做路由、MCP/Skill、自定义提供商、批量/表格。
5. 在 P0 全部验收前，不删除桌面面板按钮；用 `mobileParity` 开关灰度。
6. 明确“桌面专属”能力：本地 MCP/Skill、写桌面客户端配置、桌面安装包、后台常驻 API。

手机-only 是可行的，但需要把“管理型桌面功能”真正搬成移动表单/弹层，而不是只保留只读页面。
