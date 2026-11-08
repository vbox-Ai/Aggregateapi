# Agent2API v3.4.2 网关 HTTP 契约提取 ——「数据 / 系统 / 更新」批次

仓库：`aimod-cc/Agent2API`，tag `v3.4.2`。
代码根：`desktop-tauri/src-tauri/server/src/server/`。

本文件只记录**从源码读到的事实**。凡源码未直接给出的，标 `(未确认)`。

## 0. 全局事实（路由挂载与鉴权）

- 路由表在 `http.rs`（非 `api/mod.rs`）。`api/mod.rs` 只是模块清单 + 一行注释形式的路径提示。
- 分两组：`public`（无鉴权）与 `protected`（`middleware::from_fn(require_api_key)`，`http.rs:901`）。
  本批所有端点都挂 **protected**（`http.rs:207` 起的 `protected` 组）。
- 管理面响应信封：`ok_json(...)`；错误用 `management_error(status, msg)`（`{success:false,error:...}`）或 `GatewayError`（OpenAI 形状 `{error:{message}}`）。**`api/update.rs` 的错误信封是 OpenAI 形状**（`update.rs:34-37`、`update.rs:50-51`）。
- `/api/update` 只注册了通配形态 `/api/update/{*rest}`（`http.rs:889`）；`/api/update`（无尾斜杠）落到全局 404。
- 未知子路径的 404 文案无 `success` 字段（`update.rs:373`：`crate::server::errors::not_found_response`）。

---

## storage_api.rs — 数据存储

- 路由：`GET /api/storage`
- 请求：无（查询参数无）
- 响应（`storage_api.rs:78-95`）：

```json
{
  "configDir": "/path/to/config_dir",
  "database": {
    "file": ".../agent2api.db",
    "bytes": 0,
    "available": true,
    "accounts": 0,
    "logs": 0,
    "requests": 0,
    "dailyDays": 0,
    "debug": 0,
    "downstreamRaw": 0,
    "upstreamRaw": 0
  }
}
```

  - `database.available`：库是否打开；false 时各计数都回落 0，界面据此显示「不可用」。
  - `bytes` = `request_stats.db_bytes()`；库不可用时给 0。
  - `debug` 是 `upstreamRaw` 的兼容字段（`storage_api.rs:91-93`），两者同值。
  - 库路径事实来源 `Db::file()`，兜底 `{configDir}/db::FILE_NAME`（`storage_api.rs:49-52`）。
- 配置键：无（只读）。库位置由环境变量 `AGENT2API_PROXY_HOME` 决定（旧名 `WORKBUDDY_PROXY_HOME` 仍可读）。
- 前置：需鉴权。**无写路由**：旧的 `POST /api/storage/relocate`、`GET /api/storage/progress` 已删除（`storage_api.rs:8-13`）。
- 位置：`storage_api.rs:44`（handler），`http.rs:338`（挂载）

---

## system_info.rs — 系统 / 版本信息

- 路由：`GET /api/system-info`
- 请求：查询参数 `hideUsername`（`Params`，`system_info.rs:44-48`）。命中值为 `1` / `true` / `yes` / `on`（trim 后，`system_info.rs:55-58`）时主目录前缀替换成 `~`（`core::system_info::mask_path`）。不落库、不持久化。
- 响应（`system_info.rs:118-205`，键名逐层照抄）：

```json
{
  "app": {
    "version": "...", "license": "AGPL-3.0-only",
    "sourceUrl": "...", "licenseUrl": "...", "copyright": "...",
    "channel": "stable",            // updateChannels().key(): "stable" | "beta" | "both"
    "schemaVersion": 0,             // db::schema::SCHEMA_VERSION
    "dbSchemaVersion": 0            // 库里实际版本；库不可用时 null
  },
  "runtime": {
    "deployment": "...", "container": false,
    "os": "...", "osVersion": "...", "arch": "...",
    "startedAt": 0, "uptimeSeconds": 0, "pid": 0,
    "debugBuild": false, "verbose": false
  },
  "deployment": {
    "host": "...", "port": 0, "panelPort": 0,
    "uiHosted": false, "localPanel": false,
    "configDir": "...", "dbFile": "...", "dbBytes": 0, "dbAvailable": true,
    "logFile": "...", "exePath": "...",
    "installerKind": "nsis", "selfUpdate": false,
    "updateCapability": {
      "deployment": "...", "mode": "...", "packageKind": "...",
      "installSupported": false, "reason": null
    }
  },
  "security": {
    "adminRegistered": false, "panelAuth": false, "apiKeyCount": 0,
    "allowNoKey": false, "v1FailClosed": false, "panelGate": false,
    "githubTokenFilled": false, "githubTokenOrigin": null,
    "updateProxy": false
  },
  "features": {
    "debugMode": false, "sanitizeFingerprints": true, "cors": false,
    "developerRoleCompat": true, "keepaliveStrip": false,
    "autoContinue": false, "autoContinueMaxRounds": 0,
    "modelsDev": false, "captchaEnabled": false, "updateBeta": false
  },
  "stats": {
    "accounts": 0, "enabledAccounts": 0, "limitedAccounts": 0,
    "models": 0, "inFlight": 0, "requests": 0, "logs": 0, "upgradePending": false
  }
}
```

  - `security.updateProxy` 只报「有没有指定出口」布尔（不回代理地址，`system_info.rs:172-173`）。
  - `security.githubTokenOrigin` 取值见 `core/update/token.rs:156-175`：`"stored"` / `"env"` / `null`。
  - `deployment.updateCapability` 结构见 `core/update/capabilities.rs:7-15`（camelCase）：
    `deployment`（`system_info::deployment()`）、`mode`（`desktop` / `docker` / `systemd` / `windows-service` / `manual`）、
    `packageKind`（`server` / `desktop`）、`installSupported`、`reason`（`disabled` / `helper_missing` / `custom_installation` / `helper_unavailable` / `unsupported_arch` / `unmanaged` / null）。
  - `app.version` = 编译期 `CURRENT_VERSION`（`core/update/mod.rs:59`）。
  - 失败分项降级为 `null`；「上游客户端版本 / CLI 版本」字段已整体移除（`system_info.rs:130-133`）。
- 前置：需鉴权（数据目录、可执行文件路径、Key 数量属管理面信息）。
- 副作用：无（纯读；不打网络）。
- 位置：`system_info.rs:51`，`http.rs:345`

---

## stats_api.rs — 数据保留（保留天数 / 数量）

> 任务提到的 `logRetentionDays` / `requestLogRetentionDays` / `dailyAggregateRetentionDays` **不在 `config_api.rs`**。代码检索（GitHub code search）命中：`server/api/stats_api.rs`（读写）、`server/config/types.rs`（键名与边界常量）、`server/db/schema.rs`（裁剪实现）、`ui-islands/src/islands/settings-retention-model.ts`（前端模型）。

- 路由：`GET /api/retention`、`PUT /api/retention`（`http.rs:281-284`）
- 请求（PUT，允许部分字段，`null` 视为「该项不动」，`stats_api.rs:494-502`）：JSON 对象，键：

| 键（config.json 字段名） | 类型 | 范围 | 默认 | 含义 |
|---|---|---|---|---|
| `logRetentionDays` | int | 1–99999 | 30 | 事件日志（`logs` 表）保留天数 |
| `logRetentionCount` | int | 1–100000000 | 10000 | 事件日志条数上限 |
| `requestLogRetentionDays` | int | 1–99999 | 99999 | 请求日志（`requests` 表）保留天数 |
| `requestLogRetentionCount` | int | 1–100000000 | 1000000 | 请求日志条数上限 |
| `dailyAggregateRetentionDays` | int | 1–99999 | 99999 | 按天聚合（`request_daily` 表）保留天数 |

  - 常量出处：`config/types.rs:38-50`（键名）、`config/types.rs:405-411`（默认值）、`config/types.rs:429-430`（天数范围）、`RETENTION_MIN_COUNT`/`RETENTION_MAX_COUNT` = 1 / 100000000（`types.rs:410-411`）。
  - 校验：`config::parse::int_in_range`，只认 JSON 数字；非法值 400，错误文案形如 `logRetentionDays 必须是 1-99999 天范围内的整数（收到: ...）`（`stats_api.rs:563-572`）。
  - 非法 JSON / 非对象 → 400（`stats_api.rs:447-453`）。空对象 `{}` → 不写盘、不清理、直接返回当前值（`stats_api.rs:504-509`）。
- 响应（GET、PUT 共用 `retention_json`，键名由常量标识符生成，`stats_api.rs:553-561`）：

```json
{
  "logRetentionDays": 30,
  "logRetentionCount": 10000,
  "requestLogRetentionDays": 99999,
  "requestLogRetentionCount": 1000000,
  "dailyAggregateRetentionDays": 99999
}
```

- 配置键：即上表五个键，落在 config JSON 顶层。
- 前置：需鉴权（能读全部请求日志、能删数据）。
- 副作用（`PUT`）：写配置 → 立即裁剪：`state.request_stats().prune()` + `LogStore::prune()`（`stats_api.rs:516-527`）；写盘失败时内存仍生效并记 `[Config]` 警告。
- 位置：`stats_api.rs:434`（GET）、`stats_api.rs:446`（PUT）、`http.rs:281-284`

> `config_api.rs`（`GET`/`POST`/`PUT /api/config`）**不含**保留期字段，只有 `apiKey` / `locale` / `defaultModel` / `sanitizeBlacklistFingerprints`（`config_api.rs:48-55`、`config_api.rs:112-116`）。

---

## cloud_sync.rs — 云同步

路由（`http.rs:389-400`）：

| 方法 | 路径 |
|---|---|
| GET | `/api/cloud-sync` |
| PUT | `/api/cloud-sync` |
| POST | `/api/cloud-sync/test` |
| GET | `/api/cloud-sync/remote` |
| POST | `/api/cloud-sync/upload` |
| POST | `/api/cloud-sync/download` |
| POST | `/api/cloud-sync/import-key` |

### GET /api/cloud-sync
- 请求：无。
- 响应 = `settings::public_json()`（`core/cloud_sync/settings.rs:242-268`）：

```json
{
  "provider": "webdav",                       // "webdav" | "s3"
  "webdav": { "baseUrl": "", "username": "", "hasPassword": false, "userAgent": "" },
  "s3": { "region": "", "bucket": "", "accessKeyId": "", "endpoint": "", "hasSecretKey": false, "userAgent": "" },
  "hasSyncPassword": false,
  "enabled": false,
  "autoSync": false,
  "remoteRoot": "",
  "profile": "",
  "status": {
    "lastSyncAt": 0, "lastAction": "upload", "lastSnapshotId": "",
    "lastLocalHash": "", "lastKeyFingerprint": "",
    "lastError": "", "lastErrorSource": "manual"
  },
  "remotePath": "",
  "keyFingerprint": null
}
```
  - `status` 各字段为 `Option`，缺省时该键**不出现**（`core/cloud_sync/settings.rs:89-112`，`skip_serializing_if = "Option::is_none"`）。`lastAction` ∈ `upload` / `download`；`lastErrorSource` ∈ `manual` / `auto`。
  - 密码 / Secret **只回 `hasXxx` 布尔**，不回显。

### PUT /api/cloud-sync
- 请求（整份表单；缺字段按空串，`cloud_sync.rs:167-209`）：

```json
{
  "provider": "webdav",              // 空串 → 默认 "webdav"
  "webdavBaseUrl": "", "webdavUsername": "", "webdavPassword": "", "webdavUserAgent": "",
  "s3Region": "", "s3Bucket": "", "s3AccessKeyId": "", "s3SecretAccessKey": "",
  "s3Endpoint": "", "s3UserAgent": "",
  "syncPassword": "",
  "enabled": false, "autoSync": false,
  "remoteRoot": "", "profile": ""
}
```
  - 密码类字段：**空串 = 沿用库里那份**；非空 = 换新（`cloud_sync.rs:40-41`）。
  - 非 JSON 对象 → 400「请求体必须是 JSON 对象」。
- 响应：与 GET 同形（`settings::public_json()`，`core_cs_mod.rs:101`）。
- 校验（`core/cloud_sync/settings.rs:198-239`）：`syncPassword` 必填；按 `provider` 校验 `webdav.baseUrl`+`username` 或 `s3.bucket`+`region`+`accessKeyId`+`secretAccessKey`。保存失败 → 400。
- 配置键：云同步设置整表（`settings::load()`/`apply_save` 落库；键名未在本次下载的文件中逐一列出 → **(未确认)**）。

### POST /api/cloud-sync/test
- 请求体：与 PUT **同一份 `parse_save_input` 表单**（`cloud_sync.rs:58-71`）。
- 行为：**出网**。用「已存密文 + 本次输入明文」拼临时设置测连接，并建远端目录（`core_cs_mod.rs:123-166`）。
- 响应：`{ "success": true, "remotePath": "..." }`。
- 失败：502（`cloud_sync.rs:69`）。不看 `enabled` 总开关。

### GET /api/cloud-sync/remote
- 请求：无。行为：**出网**读远端 manifest。
- 响应（`core_cs_mod.rs:185-206`）：

```json
{
  "empty": false,
  "remotePath": "...",
  "manifestBytes": 0,
  "format": "...", "version": "...", "appVersion": "...", "schemaVersion": 0,
  "deviceName": "...", "createdAt": "...", "snapshotId": "...",
  "artifacts": ["..."],
  "compatible": true,
  "incompatibleReason": null,
  "keyFingerprint": null,
  "localKeyFingerprint": null,
  "keyRequired": false,
  "hasKeyArtifact": false
}
```
  远端为空时：`{ "empty": true, "remotePath": "..." }`（`core_cs_mod.rs:177-180`）。
- 错误码：配置不全（地址 / 用户名没填等）→ 400；网络 / 远端错误 → 502（`cloud_sync.rs:77-85`，判据 `is_config_error`，`cloud_sync.rs:151-164`）。

### POST /api/cloud-sync/upload
- 请求体：无。
- 行为：**出网**；把全部账号密文 + 网关 Key 上传远端。库不可用 → 500「数据库不可用，无法上传同步数据」。
- 前置：`enabled` 必须为 true，否则 `require_enabled` 报「云同步未启用，请先在设置里打开开关」（`core_cs_mod.rs:110-117`）；远端凭据齐全；上传还需 `syncPassword`。
- 响应（`core_cs_mod.rs:292-298`）：`{ "status": "uploaded", "remotePath": "...", "bytes": 0, "snapshotId": "...", "rows": {...} }`
- 副作用：失败时写「上次失败」状态（`record_failure(msg, "manual")`，`cloud_sync.rs:97`）。
- 壳超时：该命令在桌面壳单独放宽到 300 秒（`cloud_sync.rs:18-21`）。

### POST /api/cloud-sync/download
- 请求体：无。
- 行为：**出网**；整体替换本机业务数据；替换前把当前数据备份到 `backups/`。
- 响应（`core_cs_mod.rs:382-390`）：`{ "status": "downloaded", "remotePath": "...", "deviceName": "...", "createdAt": "...", "snapshotId": "...", "applied": {...}, "safetyBackup": "..." }`
- 错误码：需要先导入密钥 → **409**（文案 = `KEY_REQUIRED`，`core_cs_mod.rs:398`）；配置问题 → 400；远端问题 → 502。

### POST /api/cloud-sync/import-key
- 请求：`{ "password": string }`（缺 `password` → 400「缺少 password」，`cloud_sync.rs:137-139`）。
- 行为：**出网**读远端密钥封装，解密后装到本机（原密钥备份）。
- 响应（`core_cs_mod.rs:437-441`）：`{ "status": "imported", "keyFingerprint": "...", "backup": null }`
- 失败：400。

- 位置：`cloud_sync.rs:34/42/58/74/90/108/132`，`http.rs:389-400`

---

## zcode_version.rs — ZCode 客户端版本号

- 路由：`GET /api/zcode/version`、`PUT /api/zcode/version`（`http.rs:796-799`）
- 请求（PUT）：`{ "version": string }`（缺字段 → 400「缺少 version」；非字符串 → 400「version 必须是字符串」，`zcode_version.rs:87-92`）
  - 校验（`zcode_version.rs:124-143`）：长度 ≤ 32（`MAX_LEN`，`zcode_version.rs:55`）；空串合法（= 清空覆盖）；字符合集 `[0-9A-Za-z._-]`；**首字符必须为数字**。
  - 空串 → 写 `null`（回落插件内置默认值）。
- 响应（GET、PUT 同形，`zcode_version.rs:66-71` / `114-117`）：

```json
{ "version": "3.16.2", "envOverride": null }
```
  - `envOverride` = 环境变量 `ZCODE_APP_VERSION` 的值（非空才有），非空表示「界面上的值此刻不生效」。
  - PUT 响应里的 `version` 是**本次提交并 trim 后**的值（写盘失败也照样返回）。
- 配置键：`plugin.zcode.appVersion`（`zcode_version.rs:52`）。写失败只记日志、内存仍生效（`zcode_version.rs:102-104`）。
- 优先级：环境变量 `ZCODE_APP_VERSION` > 本设置 > 插件内置默认值（`zcode_version.rs:31-32`）。
- 前置：需鉴权（改变出站请求形态）。
- 副作用：无网络请求；只写配置。此值会被拼进上游 URL 查询串 `?app_version=…`。
- 位置：`zcode_version.rs:66`（GET）、`zcode_version.rs:79`（PUT）

---

## zcode_captcha_pool.rs — 验证码令牌池补货节奏

- 路由：`GET /api/zcode/captcha-pool`、`PUT /api/zcode/captcha-pool`（`http.rs:787-790`）
- 请求（PUT，允许部分字段；缺项 / `null` = 该项不改，`zcode_captcha_pool.rs:84-99`）：

| 键 | 类型 | 范围 | 默认 | 含义 |
|---|---|---|---|---|
| `zcodeCaptchaPoolTarget` | int | 1–10 | 3 | 库存目标（低于它才补铸） |
| `zcodeCaptchaPoolPollMs` | int | 1000–30000 | 2500 | 铸造器轮询间隔（毫秒） |
| `zcodeCaptchaPoolMaxPerRound` | int | 1–5 | 1 | 单轮铸造上限 |

  - 只认 JSON 数字（容忍 `2.0` 这类整值浮点）；字符串 `"2"` 视为非法 → 400，文案形如 `库存目标（zcodeCaptchaPoolTarget）必须在 1~10 之间`（`zcode_captcha_pool.rs:133-156`）。
  - 三项里任一非法则**整体不落盘**（`zcode_captcha_pool.rs:54-55`）。
  - 常量：`config/types.rs:921-947`；默认值 `types.rs:929-934`。
- 响应（GET、PUT 共用 `captcha_pool_json`，`zcode_captcha_pool.rs:122-128`）：

```json
{
  "zcodeCaptchaPoolTarget": 3,
  "zcodeCaptchaPoolPollMs": 2500,
  "zcodeCaptchaPoolMaxPerRound": 1
}
```
  - PUT 返回的是**生效后**的值。GET 的 stats 响应会把这三项一并带给铸造器。
- 配置键：上表三个键（config JSON 顶层）。
- 前置：需鉴权。
- 副作用：写配置；写盘失败只记日志、内存仍生效（`zcode_captcha_pool.rs:101-105`）。无重启、不出网。
- 位置：`zcode_captcha_pool.rs:37`（GET）、`zcode_captcha_pool.rs:45`（PUT）

---

## cline_headers.rs — Cline 伪装头逐键覆盖

- 路由：`GET /api/cline/headers`、`PUT /api/cline/headers`（`http.rs:717-720`）
- 请求（PUT）：`{ "overrides": { "<头名>": "<头值>", ... } }` —— **整体替换**（非 merge）
  - 缺 `overrides` → 400「缺少 overrides」；非对象 → 400「overrides 必须是对象（头名 → 头值）」（`cline_headers.rs:73-78`）。
  - 校验（`cline_headers.rs:100-130`）：条目数 ≤ 64（`MAX_ENTRIES`）；头名 trim 后非空且 ≤ 128（`MAX_KEY_LEN`）；头名须能过 `HeaderName::try_from`；头值必须是字符串、≤ 4096（`MAX_VALUE_LEN`）且能过 `HeaderValue::try_from`；下列**固定头**一律 400（`FIXED_HEADERS`，`cline_headers.rs:53`）：`Authorization`、`Content-Type`、`Accept`、`X-Task-ID`（大小写不敏感）。
  - 语义：非空值 = 覆盖 / 新增；**空串 = 这个头不发**；从表里删掉某键 = 回落默认值。
- 响应（GET、PUT 同形，`cline_headers.rs:140-149`）：

```json
{ "overrides": { "User-Agent": "Cline/3.0.62" }, "defaults": {}, "effective": {} }
```
  - `overrides`：网关本地配置（不依赖插件）。`defaults` / `effective`：问提供商插件（`admin.action` 的 `headers.preview`）；插件不在时两份是**空表**（`cline_headers.rs:155-186`）。
- 配置键：`clineUpstreamHeaders`（`config/types.rs:128`），形状 `{string: string}`。
- 前置：需鉴权（决定出站请求形态）。
- 副作用：写配置；写盘失败只记日志、内存仍生效（`cline_headers.rs:83-85`）。GET/PUT 都可能调用插件（插件不在则空表）。
- 位置：`cline_headers.rs:56`（GET）、`cline_headers.rs:65`（PUT）

---

## import_sources.rs — 从其他工具导入

- 路由：`GET /api/import/cc-switch`（`http.rs:656-659`）
- 请求：无。行为：**读本机** `~/.cc-switch/cc-switch.db`（只读打开，零写入，`core/import_ccswitch.rs:356-360`）。
- 响应（`core/import_ccswitch.rs:340-445`）。不可用时（**200，不是 4xx/5xx**）：

```json
{ "available": false, "path": "~/.cc-switch/cc-switch.db", "reason": "..." }
```
  只有一个 `reason`、无 `path` 的形态也存在（定位不到主目录时，`core_import_ccswitch.rs:342-345`）。

  可用时：

```json
{
  "available": true,
  "path": "...",
  "total": 0,
  "providers": [
    {
      "id": "...", "appType": "claude", "name": "...", "notes": "",
      "baseUrl": "https://...", "apiKey": "sk-...",
      "protocol": "...",
      "models": [],
      "modelMappings": [],
      "importable": true,
      "reason": ""
    }
  ]
}
```
  - **`apiKey` 是明文**（导入动作需要）；不可导入的行 `baseUrl` / `apiKey` 给空串，`models` / `modelMappings` 给空数组（`core/import_ccswitch.rs:325-333`）。
  - 排序：可导入在前，其次按 `appType`、`name`（`core/import_ccswitch.rs:430-438`）。
- 配置键：无（只读扫描）。
- 前置：需鉴权（响应携带另一个本机应用的 API Key 明文）。
- 位置：`import_sources.rs:17`，`http.rs:656-659`

---

## update.rs — 软件更新（重点）

路由入口：`any(api::update::entry)` 挂在 `/api/update/{*rest}`（`http.rs:889`），方法 / 路径判定在 `update.rs:74-374` 的 `dispatch`。

### 更新设置读写接口（出网线路 / 关注通道 / beta / 令牌 / 加速源）

- `GET /api/update/proxy` —— 读「软件更新」的出网线路（`update.rs:185-193`）

```json
{ "proxy": { "label": "...", "config": {...}, "error": null } }
```
  - `proxy` 是账号代理的同一描述形态（`describe_account_proxy`）；`null` 表示直连。
- `POST /api/update/proxy` —— 换线路（`update.rs:195-239`）
  - 请求：`{ "proxy": null }` = 直连；`{ "proxy": { "source": "clash", "listenerUid": "..." } }` = 指定 Clash 出口（`custom` 形状也支持）。
  - 非法值 → 400；**「轮询」档被显式拒绝** → 400「更新出网线路不支持「轮询」档（轮询用于 OpenCode Zen 账号的出网）」（`update.rs:210-215`）。
  - 响应：`{ "proxy": { label, config, error }, "saved": bool }`；`saved=false` 表示落库失败（内存已生效）。
  - 副作用：值真的变化时清「检查更新」失败冷却 `clear_check_cooldown()`、重置更新源偏好 `reset_source_preference()`、清插件更新冷却（`update.rs:219-225`）。
  - 配置键：`updateProxy`（`config/types.rs:70`），值 = 归一后的代理对象，`null`/缺省 = 直连。
- `GET /api/update/channels` —— 读关注通道（`update.rs:285-287`）

```json
{ "stable": true, "beta": false }
```
  （`UpdateChannels`，`config/update_policy.rs:9-23`；键 `updateStable` / `updateBeta`）
- `POST /api/update/channels` —— 部分更新关注通道（`update.rs:289-299`）
  - 请求：`{ stable?: bool, beta?: bool }`（`UpdateChannelsPatch`，`deny_unknown_fields`，`config/update_policy.rs:60-65`）；两个都不给 → 400「请提供正式版或 beta 版关注设置」；两者都为 false → 400「至少需要关注正式版或 beta 版中的一个通道」（`config/update_policy.rs:124-134`）。
  - 响应：`{ "stable": bool, "beta": bool, "saved": bool }`（`update.rs:388-390`）。
  - 副作用：`changed` 时让通道缓存失效并通知插件重读（`update.rs:384-387`）。
- `GET /api/update/beta` —— 「加入 beta 版」开关（`update.rs:301-303`）：`{ "enabled": bool }`
- `POST /api/update/beta` —— 写 beta 开关（`update.rs:305-320`）
  - 请求：`{ "enabled": bool }`（缺 / 非布尔 → 400「请求体缺少 enabled 字段（须为 true / false）」）。
  - 内部转换：patch = `{ beta: enabled, stable: enabled ? None : Some(true) }` —— 即**旧的「关闭 beta」等于切回正式版**，不会留下两个通道都关。
  - 响应：`{ "enabled": <channels.beta>, "saved": bool }`（legacy 分支，`update.rs:388`）。
- `GET /api/update/token` —— GitHub 令牌状态（**不回显本体**，`update.rs:241-246`）

```json
{ "filled": true, "origin": "stored", "error": null }
```
  - `origin`：`"stored"`（界面保存的）/ `"env"`（环境变量）/ `null`；`error` 为解密失败原因（`core/update/token.rs:156-175`）。
- `POST /api/update/token` —— 保存 / 清除令牌（`update.rs:248-283`）
  - 请求：`{ "token": "ghp_…" }` 保存；`{ "token": null }` 清除。**缺 `token` 字段 → 400「请求体缺少 token 字段（清除请传 null）」**；非字符串非 null → 400「token 必须是字符串或 null」（`update.rs:257-262`）。
  - 校验（`core/update/token.rs:122-149`）：非空、长度 ≤ 255、字符集仅 `[A-Za-z0-9_-]`，否则 400。
  - 响应：`status_json()` + `saved`，即 `{ filled, origin, error, saved }`。
  - 副作用：`changed` 时清检查更新冷却 + 重置源偏好 + 清插件更新冷却（`update.rs:268-272`）。落库是 AES-256-GCM `enc1:` 密文，密钥文件 `{config_dir}/update-token.key`（`core/update/token.rs:11-20`）。
  - 配置键：`githubToken`（`config/types.rs:84`）；环境变量 `GITHUB_TOKEN` / 旧名 `WORKBUDDY_GITHUB_TOKEN` 作兜底（优先级：配置 > 环境变量）。
- `GET /api/update/github` —— GitHub 访问方式 + 加速源 + 观测（`update.rs:141-145`）

```json
{
  "mode": "auto",                  // "auto" | "official" | "accelerated"
  "mirrorUrl": "https://gh-proxy.com/",
  "mirrors": [ { "url": "https://gh-proxy.com/", "enabled": true, "supportsApi": true } ],
  "observations": [ { "source": "...", "label": "...", "resource": "api|download|index", "state": "...", "elapsedMs": 0, "checkedAt": 0, "selected": false } ]
}
```
  （设置：`GithubAccessSettings` / `GithubMirror`，`config/github_access.rs:19-60`；观测：`source_state::Observation`，`core/update/source_state.rs:16-30`）
- `POST /api/update/github` —— 部分更新加速源设置（`update.rs:147-169`）
  - 请求：`{ mode?, mirrorUrl?, mirrors? }`（`GithubAccessPatch`，`deny_unknown_fields`，`config/github_access.rs:62-68`）；三项都不给 → 400「请提供 GitHub 访问方式或加速源」。
  - `mirrors` 规则（`config/github_access.rs:102-122`）：最多 **6** 个（`MAX_MIRRORS`）；地址必须 HTTPS、不能带凭证 / 查询串 / 片段、不能是 GitHub 官方域名；不能重复；`ghproxy.net` / `ghfast.top` 强制 `supportsApi=false`。
  - 默认加速源（`config/github_access.rs:33-42`）：`https://gh-proxy.com/`、`https://cdn.gh-proxy.org/`、`https://ghproxy.net/`（最后一个 `supportsApi=false`）。
  - 响应：`settings` 全量 + `{ "saved": bool, "observations": [...] }`。
  - **错误信封是 OpenAI 形状**（`GatewayError::bad_request`）。
  - 副作用：`changed` 时 `reset_source_preference()` + `plugin_host::catalog::schedule_now()`（`update.rs:158-161`）。
  - 配置键：`githubAccess` = `{mode, mirrorUrl, mirrors:[...]}`。

### `/api/update/status`、`/api/update/policy`、`/api/update/beta` 的作用与请求体

| 端点 | 作用 | 请求体 |
|---|---|---|
| `GET /api/update/status`（`update.rs:134-139`） | 读**最近一次**「检查更新」结果（定时任务与壳命令写入；前端 60 秒轮询读它亮侧栏徽标，自己不再打 GitHub）。**本端点不触发任何网络请求**；本进程还没查过时是 `{ "checked": false }`（另加 `lastError`） | 无 |
| `GET /api/update/policy?current=<ver>`（`update.rs:81-86`） | 读更新**策略**：当前版本、是否强制更新、安装包仓库 | 无（query `current`；缺省用服务端编译期版本 `CURRENT_VERSION`） |
| `GET /api/update/beta` / `POST /api/update/beta`（`update.rs:301-320`） | 读写「加入 beta 版」开关 | GET 无；POST `{ "enabled": bool }` |

- `/api/update/status` 响应 = `checked_result`（`core/update/check.rs:120-136` 在 `build_check_result` 基础上补排期字段）：

```json
{
  "checked": true, "channelChanged": false,
  "channels": { "stable": true, "beta": false },
  "checkedAt": 0, "lastAttemptAt": 0, "lastError": null,
  "retryAt": 0, "nextCheckAt": 0, "checking": false,
  "currentVersion": "3.4.2", "latestVersion": null, "hasUpdate": null,
  "comparison": "newer", "releaseName": null, "notes": null,
  "publishedAt": null, "pageUrl": null, "prerelease": false,
  "asset": null, "androidAsset": null,
  "selfUpdate": false, "serverAsset": null, "serverChecksumUrl": null,
  "assetProbe": { "assetsTotal": 0, "suffixes": [], "filteredBySource": false,
                  "expectedSuffixes": [], "expectedName": null },
  "pendingRestart": false, "repository": "...", "sourceRepository": "...",
  "downloadSupported": false, "installerKind": "nsis",
  "downloadDir": "...", "task": null,
  "updateCapability": { "deployment": "...", "mode": "...", "packageKind": "...", "installSupported": false, "reason": null },
  "serviceTask": null, "systemdTask": null, "forceUpdate": null
}
```
  （`core/update/mod.rs:246-383`；`hasUpdate` / `comparison` 无法比较版本时为 `null`；`asset` 只认带非空 `url` 的资产；`androidAsset` 是**手机端 APK** 资产，缺则 `null`）
- `/api/update/policy` 响应（`core/update/mod.rs:235-238`）：

```json
{ "currentVersion": "3.4.2", "forceUpdate": null, "repository": "..." }
```
  - `forceUpdate` 来自索引里的 `required(current)`；为 `null` 表示不强制（仓库被环境变量显式覆盖时恒为 `null`，`core/update/mod.rs:229-233`）。非 null 时的内部字段 **(未确认)**。

### 其余 update 端点

| 方法 | 路径 | 请求体 | 响应 | 位置 |
|---|---|---|---|---|
| GET | `/api/update/check?current=<ver>` | 无（`current` 空/缺省 → 服务端 `CURRENT_VERSION`；百分号解码，`+`→空格） | 同 status 的 check 结果 | `update.rs:87-106` |
| POST | `/api/update/download` | `{ "url": string, "name": string }`（非字符串按 JS `String(value)` 转文本；`null` 视作空串，`update.rs:329-335`） | 下载任务 JSON（见下） | `update.rs:322-340` |
| GET | `/api/update/progress` | 无 | 下载任务 JSON 或 `null` | `update.rs:342-344` |
| POST | `/api/update/cancel` | 无 | `{ "canceled": bool }` | `update.rs:346-348` |
| POST | `/api/update/download-plan` | `{ "url": string }`（缺 → 400「下载方案缺少 url」） | `{ urls: [], sha256: null, size: 0, mode: "auto", probeOnDevice: true, mirrorAllowed: false }` | `update.rs:171-183`，`core/update/integrity.rs:102-113` |
| POST | `/api/update/systemd` | `{ "version": string }`（缺 → 空串） | `ServiceUpdateTask`：`{ id, version, phase, startedAt, updatedAt, error }` | `update.rs:108-118`，`core/update/systemd/mod.rs:113-152` |
| POST | `/api/update/windows-service` | `{ "version": string }` | `ServiceUpdateTask` 同形 | `update.rs:120-132`，`core/update/windows_service/mod.rs:114-144` |
| POST | `/api/update/install` | 无（路径不由请求给，按固定包名从下载目录取） | `{ "applied": true, "version": "...", "needRestart": true, "uiUpdated": false, "archive": "..." }` | `update.rs:356-362`，`core/update/mod.rs:491-497` |
| POST | `/api/update/restart` | 无 | `{ "restarting": true }` | `update.rs:364-369`，`core/update/mod.rs:514` |

- 下载任务 JSON（`core/update/mod.rs:80-108`，`download.rs:21-27`）：

```json
{ "active": true, "done": false, "canceled": false, "error": null,
  "filename": "...", "path": null, "received": 0, "total": 0,
  "selecting": true, "source": null, "percent": 0 }
```
- 前置与副作用：
  - `/api/update/check` **出网打 GitHub**；手动检查仍受失败冷却约束（二次请求会复用结果或报冷却原因，`core/update/check.rs:173-228`）。匿名限额 60 次/小时（按出口 IP 计）。
  - `/api/update/download` 出网下载到 `{config_dir}/updates`，边下边校验 sha256；下载进行中重复调用返回当前任务快照（`download.rs:52-54`）；服务端一键更新进行中 → 409。
  - `/api/update/install` 与 `/api/update/restart` 要求 `AGENT2API_SELF_UPDATE=1` 且运行在容器内，否则 400（`core/update/mod.rs:398-403`、`501-513`）；`install` 会原子替换二进制与 ui 目录。
  - `/api/update/systemd`、`/api/update/windows-service` 要求 `deployment` 分别为 `systemd` / `windows-service`，否则 400；已有任务在跑 → 409；版本号与最新 release 不一致 → 409。
- 配置键汇总：`updateProxy`、`updateStable`、`updateBeta`、`githubToken`、`githubAccess`（+ 内部 `installedUpdateVersion`，`config/update_policy.rs:7`）。
- 位置：`update.rs:60`（入口）、`update.rs:74`（dispatch）

---

## tools.rs — 工具服务（管理面）

挂载点 `http.rs:429-459`，全部 protected。运行时端点（`/skill/web-search*`、`/mcp/*`、`/api/web-search*`）在 `api/tool_runtime`，**不在本批**。

| 方法 | 路径 | 请求 | 响应 | 位置 |
|---|---|---|---|---|
| GET | `/api/tools/servers` | query `protocol?` = `skill` \| `mcp`（未知 → 400） | 数组，每项 `service_info`：`{id, protocol, key, enabled, capability_count, endpoint, package_name, version, timeout_seconds}`；`web-search`+`skill` 另加 `recommended_variant` / `variants` | `tools.rs:71`，`core_ts_mod.rs:322-351` |
| PATCH | `/api/tools/servers/{id}` | `{ protocol: "skill"\|"mcp", enabled?: bool, timeout_seconds?: int }`；`{id}` 必须是已知服务（否则 400「未知的工具服务」）；`enabled` 与 `timeout_seconds` 都缺 → 400；`timeout_seconds` 范围 **5–600** | `service_info` 同形 | `tools.rs:82`，常量 `core_ts_mod.rs:99-101` |
| GET | `/api/tools/providers` | 无 | 数组：API Key 类 `{provider, display_name, auth_type:"api_key", supports_search, supports_fetch, available, configured, key_hint, enabled, updated_at}`；账号类同形（`core/ts/providers` 组装） | `tools.rs:132`，`core_ts_mod.rs:389-412` |
| GET | `/api/tools/provider-selection` | 无 | `{ "search_providers": [...], "fetch_provider": "..." }` | `tools.rs:136`，`core_ts_mod.rs:414-420` |
| PUT | `/api/tools/provider-selection` | `{ search_providers?: string[], fetch_provider?: string }` | 与 GET 同形 | `tools.rs:141` |
| PUT | `/api/tools/providers/{provider}` | `{ api_key?: string, account_id?: string\|null, enabled?: bool }`；账号类来源不接受 `api_key`（400），API Key 类不接受 `account_id`（400） | 账号类：`{success:true, provider, account_id}`；API Key 类：`{success:true, provider, configured, key_hint, enabled, updated_at}`（`core_ts_mod.rs:447`、`:473`） | `tools.rs:163` |
| DELETE | `/api/tools/providers/{provider}/key` | 无 | `{ "success": true }`（清除失败 → 404） | `tools.rs:196` |
| POST | `/api/tools/providers/{provider}/test` | 无（**出网**真打一次搜索） | `{ success, provider, result_count, duration_ms }` 或 `{ success:false, provider, code, error, duration_ms }` | `tools.rs:206`，`core_ts_providers.rs:554-582` |
| GET | `/api/tools/api-keys` | 无 | `{ "keys": [ { id, name, masked } ] }`（仅可用 Key） | `tools.rs:223` |
| GET | `/api/tools/vision/config` | 无 | `{ config: {provider, providerLabel, upstreamModel, downstreamModel, reasoning, apiKeyId, apiKeyName, configured, key_available} \| null, keys: [{id, name, key_prefix}] }` | `tools.rs:215`，`core_ts_vision.rs:32-85` |
| PUT | `/api/tools/vision/config` | `{ provider, upstream_model, reasoning_effort?, api_key_id }`（空 provider/model → 400；思考等级非法 → 400；空 api_key_id → 400；模型必须是「该 provider 下已启用且非 image」的模型，否则 400） | 保存后的配置 | `tools.rs:239` |
| DELETE | `/api/tools/vision/config` | 无 | `{ "success": true }` | `tools.rs:308` |
| POST | `/api/tools/vision/config/test` | 无（**出网**经网关跑一次 1×1 PNG 最小视觉请求） | `{ success:true, duration_ms, reply }` 或 `{ success:false, duration_ms, error }` | `tools.rs:313`，`core_ts_vision.rs:279-300` |
| GET | `/api/tools/install-targets` | query `service`（必填）+ `protocol`（必填，须被该服务支持） | `{ "targets": [ { key, label, path, detected, installed, supported } ] }` | `tools.rs:320`，`core_ts_install.rs:64-84`（skill）、`:187-213`（mcp） |
| GET | `/api/tools/install-info` | query `service`（必填） | `{ base_url, service, name, version, timeout_seconds, mcp:{server_name,url,tools,bridge_url} }`；`web-search` 另加 `skill:{name,version,recommended_variant,variants}` | `tools.rs:338` |
| POST | `/api/tools/install-skill` | `{ variant: "node"\|"python", api_key_id, clients: string[] }`（**服务固定为 web-search**；variant 非法 → 400；clients 空 → 400） | `{ "results": [ { clientId, label, ok, path, error } ] }` | `tools.rs:394`，`core_ts_install.rs:21-46` |
| POST | `/api/tools/install-mcp` | `{ service_id, mode?: "http"\|"bridge", api_key_id, clients }`（mode 缺省 `http`；`bridge` 仅视觉支持） | 同上 | `tools.rs:425` |
| POST | `/api/tools/uninstall-skill` | `{ clients: string[] }`（代码不读 `service_id`，服务固定 web-search） | 同上 | `tools.rs:464` |
| POST | `/api/tools/uninstall-mcp` | `{ service_id, clients }` | 同上 | `tools.rs:480` |
| GET | `/api/tools/mcp-bridge/vision.js` | 无 | `text/javascript; charset=utf-8` 脚本文本 | `tools.rs:500` |

- 侧重点：`install-skill` / `install-mcp` **写本机文件**（各 AI 客户端的 Skill 目录 / MCP 配置），`install-info`、`test_*` **出网**。
- `variant` 合法值 `node` / `python`，推荐 `node`（`core_ts_skill.rs:51-77`；Skill 包名 `web-search`，版本 `1.2.0`，`core_ts_skill.rs:10-11`）。
- 位置：`tools.rs`（各 handler 行号见上表），`http.rs:429-459`

---

## growth.rs — WorkBuddy 成长任务

路由（**不在 `http.rs` 直接登记**，由 `/api/accounts/{*rest}` → `api::accounts::dispatch` 后缀分派，`accounts.rs:464-504`）：

| 方法 | 路径 | 请求体 | 位置 |
|---|---|---|---|
| GET | `/api/accounts/{id}/growth` | 无 | `growth.rs:103` / `accounts.rs:499-504` |
| POST | `/api/accounts/{id}/growth/task` | `{ code, mode: "full"\|"claim" }`（`mode=full` 缺省） | `growth.rs:117` / `accounts.rs:464-469` |
| POST | `/api/accounts/{id}/growth/school` | `{ only?, lottery?: bool }`（`lottery=true` 时抽奖余额抽空，上限 20 次护栏） | `growth.rs:128` / `accounts.rs:470-475` |
| POST | `/api/accounts/{id}/growth/travel` | 无 | `growth.rs:139` / `accounts.rs:476-481` |

- 请求体解析：缺省 / 非 JSON 一律给空对象（`growth.rs:46-48`），不做字段白名单校验 —— 字段语义由**提供商插件**定义（`admin.action` 透传，`growth.rs:70-96`）。
- 响应：插件返回的 JSON 原样透传（`ok_json(data)`）。`GET` 返回四块：成长任务清单（含展示与支持标记）、能量/连登读数、猫猫旅行状态、开学季概况（含抽奖余额）；某块失败只在该块给 `error` 字段（`growth.rs:98-102`）。
- `POST .../growth/task` 单条结果行字段：`code` / `outcome` / `message` / `credit` / `energy`（`growth.rs:115` 注释）。
- 前置：账号必须存在（否则 404「账号不存在」）；提供商必须装了插件（否则 400「该账号的提供商没有安装插件，无法执行成长任务」）；未注册插件 → 400「该账号的提供商未注册」；仅 WorkBuddy **国内版**（`supports_growth`：`provider == "workbuddy"` 且 `enterpriseId` 为空，`growth.rs:148-154`）。
- 副作用：`GET` 只读；三个 `POST` **出网打上游**并改远端状态。界面「一键完成」在本地循环逐条调 `task`（单请求 60 秒转发超时的原因，`growth.rs:18-24`）。
- 配置键：无。
- 位置：`growth.rs:103/117/128/139`，`accounts.rs:464-504`

---

## 汇总表

| # | 方法 | 路径 | 模块 | 请求体关键字段 | 配置键 |
|---|---|---|---|---|---|
| 1 | GET | `/api/storage` | storage_api.rs | — | — |
| 2 | GET | `/api/system-info` | system_info.rs | query `hideUsername?` | — |
| 3 | GET | `/api/retention` | stats_api.rs | — | 5 个 retention 键（读） |
| 4 | PUT | `/api/retention` | stats_api.rs | `logRetentionDays?, logRetentionCount?, requestLogRetentionDays?, requestLogRetentionCount?, dailyAggregateRetentionDays?` | 同上（写，立即清理） |
| 5 | GET | `/api/cloud-sync` | cloud_sync.rs | — | 云同步设置（读） |
| 6 | PUT | `/api/cloud-sync` | cloud_sync.rs | `provider, webdav*, s3*, syncPassword, enabled, autoSync, remoteRoot, profile` | 云同步设置（写） |
| 7 | POST | `/api/cloud-sync/test` | cloud_sync.rs | 同 PUT 表单 | — （出网） |
| 8 | GET | `/api/cloud-sync/remote` | cloud_sync.rs | — | — （出网） |
| 9 | POST | `/api/cloud-sync/upload` | cloud_sync.rs | — | — （出网，需 enabled） |
| 10 | POST | `/api/cloud-sync/download` | cloud_sync.rs | — | — （出网，替换本机数据） |
| 11 | POST | `/api/cloud-sync/import-key` | cloud_sync.rs | `password` | — （出网） |
| 12 | GET | `/api/zcode/version` | zcode_version.rs | — | `plugin.zcode.appVersion`（读） |
| 13 | PUT | `/api/zcode/version` | zcode_version.rs | `version` | `plugin.zcode.appVersion`（写） |
| 14 | GET | `/api/zcode/captcha-pool` | zcode_captcha_pool.rs | — | 3 个 `zcodeCaptchaPool*`（读） |
| 15 | PUT | `/api/zcode/captcha-pool` | zcode_captcha_pool.rs | `zcodeCaptchaPoolTarget?, zcodeCaptchaPoolPollMs?, zcodeCaptchaPoolMaxPerRound?` | 同上（写） |
| 16 | GET | `/api/cline/headers` | cline_headers.rs | — | `clineUpstreamHeaders`（读） |
| 17 | PUT | `/api/cline/headers` | cline_headers.rs | `overrides` | `clineUpstreamHeaders`（整体替换） |
| 18 | GET | `/api/import/cc-switch` | import_sources.rs | — | — （读本机 cc-switch 库） |
| 19 | GET | `/api/update/check` | update.rs | query `current?` | — （出网 GitHub） |
| 20 | GET | `/api/update/policy` | update.rs | query `current?` | — |
| 21 | GET | `/api/update/status` | update.rs | — | — （不出网） |
| 22 | GET | `/api/update/github` | update.rs | — | `githubAccess`（读） |
| 23 | POST | `/api/update/github` | update.rs | `mode?, mirrorUrl?, mirrors?` | `githubAccess`（写） |
| 24 | GET | `/api/update/proxy` | update.rs | — | `updateProxy`（读） |
| 25 | POST | `/api/update/proxy` | update.rs | `proxy` | `updateProxy`（写） |
| 26 | GET | `/api/update/channels` | update.rs | — | `updateStable`/`updateBeta`（读） |
| 27 | POST | `/api/update/channels` | update.rs | `stable?, beta?` | 同上（写） |
| 28 | GET | `/api/update/beta` | update.rs | — | `updateBeta`（读） |
| 29 | POST | `/api/update/beta` | update.rs | `enabled` | `updateBeta` + `updateStable`（写） |
| 30 | GET | `/api/update/token` | update.rs | — | `githubToken`（读状态） |
| 31 | POST | `/api/update/token` | update.rs | `token`（string\|null） | `githubToken`（写） |
| 32 | POST | `/api/update/download` | update.rs | `url, name` | — （出网下载） |
| 33 | GET | `/api/update/progress` | update.rs | — | — |
| 34 | POST | `/api/update/cancel` | update.rs | — | — |
| 35 | POST | `/api/update/download-plan` | update.rs | `url` | — |
| 36 | POST | `/api/update/systemd` | update.rs | `version` | — （需 systemd 部署） |
| 37 | POST | `/api/update/windows-service` | update.rs | `version` | — （需 windows-service 部署） |
| 38 | POST | `/api/update/install` | update.rs | — | — （需 `AGENT2API_SELF_UPDATE=1`） |
| 39 | POST | `/api/update/restart` | update.rs | — | — （需 `AGENT2API_SELF_UPDATE=1`） |
| 40 | GET | `/api/tools/servers` | tools.rs | query `protocol?` | — |
| 41 | PATCH | `/api/tools/servers/{id}` | tools.rs | `protocol, enabled?, timeout_seconds?` | `toolServices`（`core_ts_mod.rs:68`） |
| 42 | GET | `/api/tools/providers` | tools.rs | — | `toolServices`（读） |
| 43 | GET | `/api/tools/provider-selection` | tools.rs | — | `toolServices`（读） |
| 44 | PUT | `/api/tools/provider-selection` | tools.rs | `search_providers?, fetch_provider?` | `toolServices`（写） |
| 45 | PUT | `/api/tools/providers/{provider}` | tools.rs | `api_key?, account_id?, enabled?` | `toolServices`（写，Key 加密落库） |
| 46 | DELETE | `/api/tools/providers/{provider}/key` | tools.rs | — | `toolServices`（写） |
| 47 | POST | `/api/tools/providers/{provider}/test` | tools.rs | — | — （出网） |
| 48 | GET | `/api/tools/api-keys` | tools.rs | — | — |
| 49 | GET | `/api/tools/vision/config` | tools.rs | — | `toolServices.vision`（读） |
| 50 | PUT | `/api/tools/vision/config` | tools.rs | `provider, upstream_model, reasoning_effort?, api_key_id` | `toolServices.vision`（写） |
| 51 | DELETE | `/api/tools/vision/config` | tools.rs | — | `toolServices.vision`（写） |
| 52 | POST | `/api/tools/vision/config/test` | tools.rs | — | — （出网，经网关） |
| 53 | GET | `/api/tools/install-targets` | tools.rs | query `service, protocol` | — |
| 54 | GET | `/api/tools/install-info` | tools.rs | query `service` | — |
| 55 | POST | `/api/tools/install-skill` | tools.rs | `variant, api_key_id, clients` | — （写本机文件） |
| 56 | POST | `/api/tools/install-mcp` | tools.rs | `service_id, mode?, api_key_id, clients` | — （写本机文件） |
| 57 | POST | `/api/tools/uninstall-skill` | tools.rs | `clients` | — （删本机文件） |
| 58 | POST | `/api/tools/uninstall-mcp` | tools.rs | `service_id, clients` | — （改本机配置） |
| 59 | GET | `/api/tools/mcp-bridge/vision.js` | tools.rs | — | — |
| 60 | GET | `/api/accounts/{id}/growth` | growth.rs | — | — （出网） |
| 61 | POST | `/api/accounts/{id}/growth/task` | growth.rs | `code, mode?` | — （出网，写远端） |
| 62 | POST | `/api/accounts/{id}/growth/school` | growth.rs | `only?, lottery?` | — （出网，写远端） |
| 63 | POST | `/api/accounts/{id}/growth/travel` | growth.rs | — | — （出网，写远端） |

---

## 附注（与手机端方案直接相关的事实）

- 更新检查响应里存在**手机端专用字段** `androidAsset`（APK 资产的 GitHub 下载地址；该版本没挂 apk 时为 `null`，手机端据此隐藏「立即更新」）。出处：`core/update/check.rs:405`、`core/update/mod.rs:352-357`。
- 仓库里已存在移动端目录：`desktop-tauri/mobile/`（例如 `mobile/src/components/GithubAccessSettings.tsx`），且 `GithubAccessPatch` / `GithubAccessSettings` 在 `ui-shared/` 与 `ui-islands/` 各有一份实现。
- `check` 请求的 `current` 语义：桌面壳**一定显式传**（后端不知道自己被哪个壳打包）；网页端不传时用服务端编译期版本（`update.rs:20-22`、`95-101`）。

## 提取范围与不确定项

- 已逐文件读取并核对行号：`storage_api.rs`、`system_info.rs`、`cloud_sync.rs`、`zcode_version.rs`、`zcode_captcha_pool.rs`、`cline_headers.rs`、`import_sources.rs`、`update.rs`、`tools.rs`、`growth.rs`、`api/mod.rs`、`config_api.rs`、`stats_api.rs`、`accounts.rs`、`http.rs`，以及上述依赖的 `core/*`、`config/*` 文件。
- 标 `(未确认)` 的项：
  1. `/api/update/policy` 中 `forceUpdate` 非 null 时的内部字段（来自更新索引 `index::AppIndex::required`，本批未下载 `core/update/index.rs`）。
  2. 云同步设置落库时的 config 键名（未下载 `core/cloud_sync/settings.rs` 的 `load`/`apply_save` 实现体）。
  3. `system_info::deployment()` 的完整取值集合（`core/update/capabilities.rs:21-33` 中出现 `desktop` / `docker` / `systemd` / `windows-service` 与兜底 `manual`，其余取值未逐一确认）。
  4. `/api/import/cc-switch` 中 `protocol` / `models` / `modelMappings` 的取值域（由 `scan_entry` 内部按 settings 解析，未逐字段回溯）。
- 未包含：`api/mod.rs` 中列出的其它模块（本批之外），以及 `tool_runtime` 的运行时端点。
- 本文件不含任何凭据 / PAT。
