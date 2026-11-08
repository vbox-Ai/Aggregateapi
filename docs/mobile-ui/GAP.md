# 手机端 vs 桌面面板 · 设置项差集分析

> 分析日期：2026-11-08
> 桌面端源码：`desktop-tauri/ui-islands/src/`（229 个 island 文件，设置相关 29 个）
> 手机端源码：`desktop-tauri/mobile/src/`（21 个 screen）
> 网关契约：上游 `aimod-cc/Agent2API` tag `v3.4.2` 的 `server/src/server/api/*.rs`
>
> 方法：① 从桌面 `settings-model.ts` 的 `CATEGORIES` 取分区权威清单；
> ② 从桌面源码提取每个字段的中文标签；
> ③ 用**网关端点**逐条验证手机端有没有对应实现（避免关键词误判）；
> ④ 区分「手机端能做」「需要改 Rust」「桌面专属」三类。

---

## 0. 结论摘要

| 指标 | 数值 |
|---|---|
| 桌面设置页分区 | 11 个（账户 / 通用 / 显示 / 网关 / 重试 / 超时 / 安全 / 数据 / 反馈与需求 / 版本信息 / 更新） |
| 桌面设置项（含开关、输入框、按钮、弹窗字段） | 约 267 条 |
| 手机端设置页分组 | 10 个（服务器 / 网关状态 / 外观 / 接入 / 账号 / 服务 / 数据 / 安装到桌面 / 应用状态 / 软件更新）+ 底部卡 |
| **确认缺失（端点验证）** | **19 组**，其中 12 组是纯 HTTP 设置，手机端可以直接补 |
| 需要改 Rust 才能做 | 2 组（局域网访问、面板端口/托管相关） |
| 桌面专属（不该搬） | 4 类 |

手机端**不是**桌面设置的子集：签到中心、插件页面、路由预演、账号批量、服务控制（supervisor）
这些是手机端先做的。

---

## 1. 分区对照

| 桌面分区 | 条目数 | 手机端覆盖 | 缺口要点 |
|---|---|---|---|
| 账户 `account` | 11 | 部分 | 有「修改密码」「清空整库」；缺**管理员状态/用户名展示**、**机器人校验两个开关** |
| 通用 `general` | 13 | 很少 | 缺**局域网访问**、**计量单位**；托盘/开机自启是桌面专属 |
| 显示 `display` | 19 | 部分 | 有主题、语言；缺**界面缩放**（桌面端自己网页版也禁用）、**账号列表两项偏好**、**侧边栏菜单定制** |
| 网关 `gateway` | 83 | 很少 | 只有「客户端识别」；缺**排队等待 / 图片压缩 / models.dev / 指纹脱敏 / 开发者角色兼容 / 系统提示词 / 调试模式 / ZCode 版本 / 验证码令牌池 / Cline 伪装头** |
| 重试 `retry` | 3+ | **无** | 同一账号重试次数、换号重试次数、重试间隔、指定错误码直接换号 |
| 超时 `timeout` | 4 | **无** | 连接中 / 等待响应 / 流式空闲 / 非流式 |
| 安全 `security` | 2 | 部分 | 有退出登录；缺 **CORS 开关** |
| 数据 `data` | 52 | 部分 | 有整库备份/恢复、账号导入导出；缺**云同步**、**数据保留**、**数据存储用量** |
| 反馈与需求 `feedback` | 3 | **无** | 问题反馈 / 功能建议 / 请求提供商支持 |
| 版本信息 `system` | 50 | 部分 | SystemInfoSheet 有一小部分；缺**安全读数**、**开关读数**、**计数**、许可/源码/schema、PID/内核/程序路径/安装包形态 |
| 更新 `about` | 27 | 大部分 | 有版本状态机、自动检查、通道、GitHub 令牌与加速源；缺**出网代理**、**加入 beta 开关**、官方源状态明细 |

---

## 2. 确认缺失清单（按建议优先级）

验证方式：在手机端源码里搜对应网关端点，**完全没有**才列入本节。

### P1 · 影响转发行为，建议优先补（纯 HTTP，手机端直接可做）

| 功能 | 网关端点 / 配置键 | 为什么重要 |
|---|---|---|
| **排队等待** | `/api/queue`、`queueMaxWaits`、`queueWaitSeconds` | 上游忙时是否排队、等多久 —— 直接决定请求成功还是直接失败 |
| **重试** | `/api/retry`、`retryCount`、`retryCrossProviderCount`、`retryIntervalSeconds`、`noRetryStatusCodes` | 失败重试策略与「指定错误码直接换号」；手机端目前完全调不了 |
| **超时** | `/api/timeouts`、`connectTimeoutSeconds`、`headersTimeoutSeconds`、`streamIdleTimeoutSeconds`、`bodyTimeoutSeconds` | 上游慢/挂死时的行为 |
| **系统提示词** | `/api/prompt`、`promptMode`、`promptFile`、`promptText`、`promptProviders`、`promptGateway`、`promptGatewayText` | 影响模型实际行为；桌面端支持全局 + 分提供商 + 网关自带三段编辑 |
| **指纹脱敏** | `/api/sanitize`、`sanitizeBlacklistFingerprints`、`sanitizeFingerprintRules`、`sanitizeFingerprintProviders` | 影响上游审核通过率；含词表 CRUD（新增/编辑/恢复默认） |
| **调试模式** | `/api/debug` | 保存上游原始报文（请求头/体、响应头/体），排障唯一手段；手机是唯一面板时尤其缺 |
| **图片压缩** | `/api/image-compress`、`imageCompressEnabled/MaxEdge/Quality/ThresholdKb` | 省流量、绕上游图片尺寸限制 |

### P2 · 安全与数据

| 功能 | 端点 / 键 | 说明 |
|---|---|---|
| **CORS 开关** | `/api/cors`、`corsEnabled` | 允许浏览器页面跨源调 `/v1/*` |
| **机器人校验开关** | `/api/captcha`、`captchaDesktop`、`captchaWeb` | 登录/注册是否要 ALTCHA；手机端目前只能被动解验证码 |
| **数据保留** | `logRetentionDays`、`logRetentionCount`、`requestLogRetentionDays`、`requestLogRetentionCount`、`dailyAggregateRetentionDays` | 控制库大小；调小立即清理且不可恢复，属于「该给用户」的开关 |
| **数据存储用量** | `/api/storage` | 数据库文件/占用大小 + 六格计数（账号/事件日志/请求记录/报表天数/上游调试报文/下游正文） |
| **models.dev 元数据** | `/api/model-meta`、`modelsDevEnabled` | 补齐上游没声明的模型能力与思考档位 |
| **开发者角色兼容** | `/api/role-compat` | `developer` 角色转 `system`，兼容部分 OpenAI 兼容上游 |
| **更新出网代理** | 更新设置内的「出网代理」 | 弱网/被墙时的更新线路 |
| **加入 beta 开关** | `/api/update/beta` | 手机端更新面板有「关注 beta」但缺这个总开关（需复核是否等价） |

### P3 · 低频 / 依赖插件

| 功能 | 说明 |
|---|---|
| 验证码令牌池 | `/api/zcode/captcha-pool`，仅在插件申报 `captcha_pool` 管理面板时出现 |
| Cline 伪装头 | `/api/cline-headers`，仅在插件申报 `upstream_headers` 时出现 |
| ZCode 客户端版本号 | `/api/zcode/version` |
| 侧边栏菜单定制 | `/api/sidebar-layout`；手机上对应「更多」宫格的显隐与排序 |
| 账号列表两项偏好 | 积分合计只统计筛选结果、隐藏账号名（`workbuddy-desktop-accounts-*`） |
| 计量单位 | 中文单位（亿/万） |
| 反馈与需求 | 问题反馈 / 功能建议 / 请求提供商支持（桌面端三个入口） |
| 版本信息补全 | 安全读数（管理员已注册/面板登录/Key 数量/未注册闸门/允许裸跑/GitHub 令牌/更新线路）、开关读数、计数（限流中账号/在途请求/累计请求/待迁移旧数据）、许可/源码/版权/schema、PID/内核/程序路径/安装包形态 |
| 云同步 | `/api/cloud-sync`：WebDAV 或 S3，远程根目录/档案/同步密码/自动同步/测试连接/上传/恢复。**功能大，建议单独排期** |
| cc-switch 导入 | `/api/import/cc-switch`：从 CC Switch 配置导入账号 |

### 需复核（手机端可能用别的端点实现了，不能算缺失）

- `/api/tools/api-keys`、`/api/tools/install-mcp`、`/api/tools/uninstall-mcp`、`/api/tools/install-skill`、`/api/tools/uninstall-skill`
  —— 手机端 AgentPage 有 Skill/MCP 的增删改，可能走 `agent_resources` 一族端点，需逐条核对。
- `/api/accounts/{id}/growth`、成长任务 —— 手机端签到中心已有「成长任务」入口，同样需核对端点。
- `/api/web-search/search`、`/api/web-search/fetch` —— 手机端 ToolsPage 有「网络搜索」启停，搜索本身可能由工具运行时直接调用，不需面板端点。

---

## 3. 需要改 Rust 才能做

| 功能 | 现状 | 要改什么 |
|---|---|---|
| **局域网访问**（桌面「通用」分区的开关 + 「同时开放网页管理面板」） | supervisor 拉起网关时**硬编码** `.env("AGENT2API_HOST", "127.0.0.1")`，网关只监听回环 | supervisor 读一个配置（`state.home` 下的文件）把 host 传成 `0.0.0.0`；面板再加开关。**这会扩大暴露面，需要配套的访问控制** |
| 面板端口 / 托管网页界面 / 面板自动安装 | 手机端的端口是固定的（网关 3065、supervisor 3066） | 端口可配置要动 supervisor 与 App 两侧；「面板自动安装」是 deb 概念，手机端无意义 |

---

## 4. 桌面专属（不该搬到手机端）

| 功能 | 为什么 |
|---|---|
| 启动与托盘（关闭窗口最小化到托盘、轻量模式、开机自动启动） | Tauri 桌面壳能力，手机上不存在 |
| 界面缩放 | 桌面浏览器窗口概念；桌面端自己网页版也禁用 |
| 表格列设置（各页表头） | 桌面表格才有的列显隐/排序 |
| 写客户端配置 / 本地 stdio MCP / 桌面安装器 | 需要访问桌面文件系统与进程，手机端已明确标注「桌面专属」 |

---

## 5. 建议实施顺序

1. **第一批（转发行为）**：排队等待 → 重试 → 超时 → 调试模式。四个都是「一个面板 + 几个数字」，能一次做完，且都是手机端当唯一面板时缺了会难受的。
2. **第二批（内容与安全）**：系统提示词 → 指纹脱敏 → 图片压缩 → CORS → 机器人校验 → models.dev → 开发者角色兼容。
3. **第三批（数据）**：数据保留 → 数据存储用量 → 更新出网代理 → 加入 beta。
4. **第四批（低频）**：ZCode 版本、侧边栏（宫格）定制、账号列表偏好、计量单位、反馈入口、版本信息补全。
5. **第五批（大件/需改 Rust）**：云同步、cc-switch 导入、局域网访问。

---

## 6. 附：本次分析产出的两份清单

- `DESKTOP-SETTINGS-INVENTORY.md` —— 桌面设置页逐项清单（11 分区 / 约 267 条，含中文标签、后端键、桥方法、端点）
- `MOBILE-INVENTORY.md` —— 手机端逐页能力清单（21 个 screen + 设置页逐行）
