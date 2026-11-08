# 转发行为设置 HTTP 契约提取（Agent2API v3.4.2）

来源：仓库 `aimod-cc/Agent2API`，tag `v3.4.2`，前缀 `desktop-tauri/src-tauri/server/src/server/`。
本文件只记录从源码逐字读出的事实，不做推断、不给方案。未能在源码中确认的项标 `(未确认)`。

## 0. 全局约定（先读这一节，后面每个模块都适用）

### 0.1 成功信封

所有 `/api/*` 路由的成功响应都经 `http::ok_json` 包一层信封：

```rust
// server/http.rs:1295
pub fn ok_json(data: Value) -> Response {
    Json(json!({ "success": true, "data": data })).into_response()
}
```

即：下文「响应体」列出的字段全部位于 `data` 之下，实际形状是
`{"success": true, "data": { ... }}`。

### 0.2 错误信封

```rust
// server/errors.rs:365
pub fn management_error(status: i32, message: impl Into<String>) -> Response {
    let status = StatusCode::from_u16(status as u16).unwrap_or(StatusCode::BAD_REQUEST);
    (status, Json(json!({ "success": false, "error": message.into() }))).into_response()
}
```

即错误形状是 `{"success": false, "error": "<文案>"}`，与网关面（`/v1/*`）的 OpenAI 风格 payload 不同。

### 0.3 请求体解析

```rust
// server/http.rs:1306
pub fn parse_body(bytes: &[u8]) -> Result<Value, errors::GatewayError> {
    let text = String::from_utf8_lossy(bytes).trim().to_string();
    if text.is_empty() {
        return Ok(Value::Object(serde_json::Map::new()));
    }
    serde_json::from_str(&text)
        .map_err(|error| errors::GatewayError::bad_request(format!("请求体不是合法 JSON: {error}")))
}
```

空 body 视为 `{}`；非法 JSON → 400。非对象（数组 / 字符串 / 数字）→ 400 `请求体必须是 JSON 对象`（各 handler 自己 `as_object()` 判的，见各模块）。

### 0.4 权限模型（本文这一批全部挂 `protected`）

路由表 `server/http.rs` 用 `Router::new()` 分两组，**只有 `protected` 组挂鉴权中间件**：

```rust
// server/http.rs:901
        .layer(middleware::from_fn(require_api_key));
...
// server/http.rs:906
    Router::new()
        .merge(public)
        .merge(protected)
```

准入判定在 `require_api_key`（server/http.rs:1174 起）：

- **不受限的网关 API Key** 可以操作管理接口 —— `// server/http.rs:1206` 注释原文：`Key 也能操作管理接口（桌面壳 / 脚本自动化的通道）`；
- **管理员面板会话**（cookie 或 `x-panel-token` / `x-panel-refresh` 头）可以准入；
- **受限 Key**（scope 限制模型或提供商）访问管理接口 → 403：

```rust
// server/http.rs:1192
            let restricted = access.scope.as_ref().is_some_and(|scope| scope.restricts_models() || scope.restricts_providers());
            if restricted && !api::model_access::is_model_endpoint(&path) {
                return errors::GatewayError::with_status(403, "受限 API Key 不能访问管理接口，请使用管理员会话登录")
                    .with_code("management_access_denied").payload_response();
```

- 都拿不出来 → `panel_login_required`（401）。
- 额外闸门（headless、未注册管理员、未开 `panel_auth` 时）：`/api/*` 只放行 `/api/panel/` 前缀，其余 401（server/http.rs:1230-1237）。

**本文七个模块没有任何一个端点校验「网关（转发进程）正在运行」**。它们读写的都是内存配置快照 + 配置库，改完对下一个请求生效，不重启进程（各模块头注释均如此声明）。`(未确认)`：未发现任何 handler 里存在「网关运行中」这一类前置判定。

### 0.5 关键校验口径：越界回落 vs 写侧 400

写侧（PUT）与读侧的越界处置**不同**，这是契约的一部分：

- **写侧**：handler 自己校验，非法 → 400 报错，整单不落盘；
- **读侧**：`config::parse::bounded_int_field`，文件里越界 → **回落默认值，不夹紧**（server/config/parse.rs:685 注释原文：`文件里越界 → **回落默认，不夹紧**（bounded_int_field 全线口径）`）。

### 0.6 整数校验口径（PUT 侧统一）

只认 JSON 数字，容忍整值浮点（`3.0` 视作 `3`），字符串 `"3"` **非法**：

```rust
// server/api/queue_api.rs:132
    let number = match value {
        Value::Number(number) => number.as_i64().or_else(|| {
            number
                .as_f64()
                .filter(|raw| raw.is_finite() && raw.fract() == 0.0)
                .map(|raw| raw as i64)
        }),
        _ => None,
    };
```

---

## queue_api.rs — 排队等待

- **路由**：`GET /api/queue`、`PUT /api/queue`
- **请求（PUT）**：`{ "queueMaxWaits"?: number, "queueWaitSeconds"?: number }`
  - `queueMaxWaits`：整数，范围 **0–10**，**默认 2**。`0` = 不等待，排队即返回（把排队态作为错误上报）。
  - `queueWaitSeconds`：整数，范围 **0–120**，**默认 0**。`0` = 跟随上游建议；上游没给建议时适配器退到 15 秒。
  - 部分字段更新：缺省项保持原值，`null` 同义（视为「这一项不改」）。
- **响应**：`{ "queueMaxWaits": number, "queueWaitSeconds": number }`（GET 与 PUT 共用，返回**生效后**的值）
- **配置键**：`queueMaxWaits` / `queueWaitSeconds`（config.json，模块头写「存在配置库」，`set_queue` 写入 `config.raw`）
- **前置**：挂 `protected`，需 API Key 或管理员会话（见 §0.4）。无其它前置。
- **位置**：
  - 路由登记 `server/http.rs:303`（`/api/queue`，`get(...).put(...)`）
  - `GET` handler `server/api/queue_api.rs:35`
  - `PUT` handler `server/api/queue_api.rs:40`（校验循环 75–90，落盘 92）
  - 响应组装 `server/api/queue_api.rs:115`
  - 校验函数 `server/api/queue_api.rs:125`
  - 常量 `server/config/types.rs:846` / `:848` / `:855` / `:857` / `:862` / `:863` / `:865` / `:866`

源码片段：

```rust
// server/api/queue_api.rs:115
fn queue_json(settings: QueueSettings) -> Value {
    json!({
        KEY_QUEUE_MAX_WAITS: settings.max_waits,
        KEY_QUEUE_WAIT_SECONDS: settings.wait_seconds,
    })
}
```

```rust
// server/config/types.rs:845
/// 排队时最多等待几次（0 = 不等待，直接把排队态作为错误返回）
pub const KEY_QUEUE_MAX_WAITS: &str = "queueMaxWaits";
/// 单次排队等待的秒数（0 = 跟随上游建议值）
pub const KEY_QUEUE_WAIT_SECONDS: &str = "queueWaitSeconds";

/// 默认等待次数：2 次。
pub const DEFAULT_QUEUE_MAX_WAITS: i64 = 2;
/// 默认单次等待秒数：0 = 跟随上游建议（上游没给建议时适配器退到 15 秒）
pub const DEFAULT_QUEUE_WAIT_SECONDS: i64 = 0;

/// 等待次数的合法范围 0~10：0 = 关闭等待（排队即报错）。
pub const QUEUE_MIN_MAX_WAITS: i64 = 0;
pub const QUEUE_MAX_MAX_WAITS: i64 = 10;
/// 单次等待秒数的合法范围 0~120（0 = 跟随上游建议）
pub const QUEUE_MIN_WAIT_SECONDS: i64 = 0;
pub const QUEUE_MAX_WAIT_SECONDS: i64 = 120;
```

**订正**：任务描述里举例写作 `queueMaxWaits: number(1-10, 默认3)` —— 与源码不符。源码是 **0–10，默认 2**。

补充事实（模块头 `server/api/queue_api.rs:1-19`）：只有**走排队制的适配器**读这份设置，目前是 Qoder 免费模型（上游 403 + 业务码 10605）。排队等待发生在首字节之前，吃的是「等待响应超时」那份预算，适配器不会为排队突破等待响应超时。

---

## retry_api.rs — 请求重试

- **路由**：`GET /api/retry`、`PUT /api/retry`
- **请求（PUT）**：`{ "retryCount"?: number, "retryCrossProviderCount"?: number, "retryIntervalSeconds"?: number, "noRetryStatusCodes"?: number[] }`
  - `retryCount`：整数，范围 **0–10**，**默认 3**。**同一账号内**原地重发次数（`0` = 失败立即换号）。连同首发共 4 次发送。
  - `retryCrossProviderCount`：整数，范围 **0–10**，**默认 5**。**换账号**的次数上限（`0` = 不换号）。**按账号计，不分家** —— 换到同家的下一个账号与换到另一家都扣一次。键名是旧措辞（历史包袱），语义以账号数为准。
  - `retryIntervalSeconds`：整数，范围 **0–300**，**默认 5**。两次重试之间的等待秒数（`0` = 立即重发）。
  - `noRetryStatusCodes`：整数数组，每项 **100–599**，最多 **50** 项，**默认 `[402]`**。命中即**不在同一账号重发、直接按队列换下一个账号**。写侧排序去重后落库。**空数组是合法值 = 清空名单**（任何错误都照常重试）。
  - 部分字段更新：缺省项保持原值，`null` 同义。有一项非法 → 整单 400，整体不落盘。
- **响应**：`{ "retryCount": number, "retryCrossProviderCount": number, "retryIntervalSeconds": number, "noRetryStatusCodes": number[] }`
- **配置键**：`retryCount` / `retryCrossProviderCount` / `retryIntervalSeconds` / `noRetryStatusCodes`（config.json）
- **前置**：挂 `protected`，需 API Key 或管理员会话。无其它前置（模块头明确：这条**没有副作用**，不清理数据、不重启进程）。
- **位置**：
  - 路由登记 `server/http.rs:289`
  - `GET` handler `server/api/retry_api.rs:37`
  - `PUT` handler `server/api/retry_api.rs:42`（数字项校验 58–97，错误码数组校验 102–112）
  - 响应组装 `server/api/retry_api.rs:141`
  - 错误码数组校验 `server/api/retry_api.rs:154`
  - 整数校验 `server/api/retry_api.rs:192`
  - 常量 `server/config/types.rs:624` / `:632` / `:634` / `:637` / `:642` / `:644` / `:653` / `:656` / `:658` / `:659` / `:662` / `:669`–`:672`

源码片段：

```rust
// server/api/retry_api.rs:141
fn retry_json(settings: RetrySettings) -> Value {
    json!({
        KEY_RETRY_COUNT: settings.count,
        KEY_RETRY_ACCOUNT_SWITCH_COUNT: settings.account_switch_count,
        KEY_RETRY_INTERVAL_SECONDS: settings.interval_seconds,
        KEY_RETRY_NO_RETRY_CODES: settings.no_retry_codes.to_vec(),
    })
}
```

```rust
// server/config/types.rs:623
/// **同一账号内**的原地重发次数（0 = 失败立即换号，不重发）
pub const KEY_RETRY_COUNT: &str = "retryCount";
/// **换账号**的次数（0 = 不换号，直接收尾）。
pub const KEY_RETRY_ACCOUNT_SWITCH_COUNT: &str = "retryCrossProviderCount";
/// 两次重试之间的等待秒数
pub const KEY_RETRY_INTERVAL_SECONDS: &str = "retryIntervalSeconds";

pub const DEFAULT_RETRY_COUNT: i64 = 3;
pub const DEFAULT_RETRY_SWITCH_COUNT: i64 = 5;
pub const DEFAULT_RETRY_INTERVAL_SECONDS: i64 = 5;

pub const KEY_RETRY_NO_RETRY_CODES: &str = "noRetryStatusCodes";
/// 默认名单：402（WorkBuddy 积分不足）。
pub const DEFAULT_NO_RETRY_CODES: &[u16] = &[402];
/// 名单里状态码的合法范围：HTTP 状态码本身就定义在 100–599
pub const RETRY_CODE_MIN: u16 = 100;
pub const RETRY_CODE_MAX: u16 = 599;
/// 名单长度上限
pub const RETRY_MAX_NO_RETRY_CODES: usize = 50;

pub const RETRY_MIN_COUNT: i64 = 0;
pub const RETRY_MAX_COUNT: i64 = 10;
pub const RETRY_MIN_INTERVAL_SECONDS: i64 = 0;
pub const RETRY_MAX_INTERVAL_SECONDS: i64 = 300;
```

注意：`retryCrossProviderCount` 与 `retryCount` **共用同一组范围常量** `RETRY_MIN_COUNT` / `RETRY_MAX_COUNT`（0–10），见 `server/api/retry_api.rs:58-80` 的 targets 表。

---

## timeouts_api.rs — 上游请求超时（四项）

- **路由**：`GET /api/timeouts`、`PUT /api/timeouts`
- **请求（PUT）**：`{ "connectTimeoutSeconds"?, "headersTimeoutSeconds"?, "streamIdleTimeoutSeconds"?, "bodyTimeoutSeconds"? }`
  - 四项**同为**：整数，范围 **1–3600**（秒）。
  - 默认值分别：`connectTimeoutSeconds` **30**、`headersTimeoutSeconds` **300**、`streamIdleTimeoutSeconds` **300**、`bodyTimeoutSeconds` **300**。
  - 下限 1 而非 0：源码注释原文「`0` 在这里没有合理语义（「立即超时」等于禁用转发，想禁用某一阶段保护的人其实要的是把它调到大上限）」。
  - 部分字段更新：缺省项保持原值，`null` 同义。有一项非法 → 整单 400，整体不落盘。
- **响应**：`{ "connectTimeoutSeconds": number, "headersTimeoutSeconds": number, "streamIdleTimeoutSeconds": number, "bodyTimeoutSeconds": number }`
- **配置键**：`connectTimeoutSeconds` / `headersTimeoutSeconds` / `streamIdleTimeoutSeconds` / `bodyTimeoutSeconds`（config.json）
- **前置**：挂 `protected`，需 API Key 或管理员会话。无其它前置（无副作用，不重启进程）。
- **位置**：
  - 路由登记 `server/http.rs:296`
  - `GET` handler `server/api/timeouts_api.rs:33`
  - `PUT` handler `server/api/timeouts_api.rs:38`（校验循环 78–93）
  - 响应组装 `server/api/timeouts_api.rs:120`
  - 校验函数 `server/api/timeouts_api.rs:132`
  - 常量 `server/config/types.rs:749` / `:751` / `:753` / `:755` / `:758` / `:760` / `:762` / `:764` / `:770` / `:771`

源码片段：

```rust
// server/api/timeouts_api.rs:120
fn timeouts_json(settings: TimeoutSettings) -> Value {
    json!({
        KEY_TIMEOUT_CONNECT_SECONDS: settings.connect_seconds,
        KEY_TIMEOUT_HEADERS_SECONDS: settings.headers_seconds,
        KEY_TIMEOUT_STREAM_IDLE_SECONDS: settings.stream_idle_seconds,
        KEY_TIMEOUT_BODY_SECONDS: settings.body_seconds,
    })
}
```

```rust
// server/config/types.rs:748
/// 连接超时：建立上游 TCP/TLS 连接或代理隧道的最大等待时间（秒）
pub const KEY_TIMEOUT_CONNECT_SECONDS: &str = "connectTimeoutSeconds";
/// 等待响应超时：请求发出后等待上游响应头的最大时间（秒）
pub const KEY_TIMEOUT_HEADERS_SECONDS: &str = "headersTimeoutSeconds";
/// 流式响应空闲超时：流式响应相邻数据之间允许的最大空闲时间（秒），收到新数据后重新计时
pub const KEY_TIMEOUT_STREAM_IDLE_SECONDS: &str = "streamIdleTimeoutSeconds";
/// 非流式响应超时：读取完整非流式响应体允许的最大时间（秒）
pub const KEY_TIMEOUT_BODY_SECONDS: &str = "bodyTimeoutSeconds";

pub const DEFAULT_TIMEOUT_CONNECT_SECONDS: i64 = 30;
pub const DEFAULT_TIMEOUT_HEADERS_SECONDS: i64 = 300;
pub const DEFAULT_TIMEOUT_STREAM_IDLE_SECONDS: i64 = 300;
pub const DEFAULT_TIMEOUT_BODY_SECONDS: i64 = 300;

pub const TIMEOUT_MIN_SECONDS: i64 = 1;
pub const TIMEOUT_MAX_SECONDS: i64 = 3600;
```

四项对应的转发阶段（模块头 `server/api/timeouts_api.rs:1-16`）：`connectTimeoutSeconds` → 建连（含到代理那段，落在 `core::egress` 的 `connect_timeout`）；`headersTimeoutSeconds` → 请求发出到响应头到达；`streamIdleTimeoutSeconds` → 流式相邻分片空闲（收到新数据即重置）；`bodyTimeoutSeconds` → 非流式响应体读完的总预算（一次性计时，不重置）。

---

## debug_api.rs — 调试模式 + 报文详情

- **路由**：`GET /api/debug`、`PUT /api/debug`、`GET /api/debug/traffic`
- **请求（PUT /api/debug）**：`{ "debugMode": boolean }`
  - `debugMode`：布尔，**必填**。缺该键 → 400 `缺少 debugMode`；值非布尔 → 400 `debugMode 必须是 true 或 false`。
  - 与前面几个不同：**这不是部分更新端点**，没有 `null` = 不改的语义。
- **请求（GET /api/debug/traffic）**：查询参数 `id`（string，`#[serde(default)]`，缺省为空串）
  - `id` 为空 → 400 `缺少 id`；
  - 查不到 → 404 `该请求没有保存原始报文（调试模式当时未开启，或记录已超出保留条数）`。
- **响应（GET/PUT /api/debug）**：`{ "debugMode": boolean, "count": number, "limit": number }`
  - `count` = 当前 `debug_traffic` 表条数；`limit` = `debug_traffic::MAX_ENTRIES` = **500**。
- **响应（GET /api/debug/traffic）**：`{ "id", "ts", "url", "provider", "requestHeaders", "requestBody", "status", "responseHeaders", "responseBody", "truncated" }`
  - `id`: string（与请求日志条目同 id）；`ts`: number（毫秒 Unix 时间戳）；`url`: string（含路径，查询串原样保留）；`provider`: string（实际承载的 provider id）；
  - `requestHeaders`: object（**已脱敏**）；`requestBody`: JSON 值（已按家改写 model 的最终形态）；
  - `status`: number | null（上游响应状态码，未发出 / 未收到时为 **null**）；`responseHeaders`: object | null（**已脱敏**）；
  - `responseBody`: string | null（流式为原始 SSE 文本，非流式为聚合前的原始文本）；
  - `truncated`: boolean（历史记录的截断标记；新采集的正文不截断）。
  - 上述三个 `Option` 字段以 **null** 而非空串表达缺失 —— 源码注释原文：「前端的详情弹窗依赖这个区分（`data.status == null` 显示 `-`）」（`server/core/debug_traffic.rs:222-225`）。
- **配置键**：`debugMode`（config.json 键）
- **前置**：挂 `protected`，需 API Key 或管理员会话。无「网关在跑」判定。
- **位置**：
  - 路由登记 `server/http.rs:328`（`/api/debug`）、`server/http.rs:332`（`/api/debug/traffic`）
  - `GET` handler `server/api/debug_api.rs:30`
  - `PUT` handler `server/api/debug_api.rs:35`
  - `GET` traffic handler `server/api/debug_api.rs:71`
  - 查询参数结构体 `server/api/debug_api.rs:89`
  - 响应组装 `server/api/debug_api.rs:96`
  - 详情响应组装 `server/core/debug_traffic.rs:280`
  - 配置键 `server/config/types.rs:92`；默认值 `server/config/mod.rs:596`
  - `MAX_ENTRIES` `server/core/debug_traffic.rs:83`

源码片段：

```rust
// server/api/debug_api.rs:96
fn debug_json() -> Value {
    json!({
        config::KEY_DEBUG_MODE: config::current().debug_mode(),
        "count": debug_traffic::count(),
        "limit": debug_traffic::MAX_ENTRIES,
    })
}
```

```rust
// server/core/debug_traffic.rs:280
pub fn detail_payload(entry: &TrafficEntry) -> Value {
    json!({
        "id": entry.id,
        "ts": entry.ts,
        "url": entry.url,
        "provider": entry.provider,
        "requestHeaders": entry.request_headers,
        "requestBody": entry.request_body,
        "status": entry.status,
        "responseHeaders": entry.response_headers,
        "responseBody": entry.response_body,
        "truncated": entry.truncated,
    })
}
```

```rust
// server/config/mod.rs:594
        // 只有字面 `true` 算开启（手改文件写 "1" / "yes" 一律当关）：与
        // 「写坏回落」同一取向 —— 这个开关控制是否把凭据落盘，宁可少采
        debug_mode: raw.get(KEY_DEBUG_MODE).and_then(Value::as_bool).unwrap_or(false),
```

**默认：关闭**（缺失 / 非字面 `true` 一律当关）。

开启后的行为（模块头 `server/api/debug_api.rs:1-15`）：转发层把发给上游的请求（头脱敏 + 体）与上游返回的响应（状态码 + 头脱敏 + 体）完整落到统一库的 `debug_traffic` 表，请求日志页「详情」列据此展示；报文与其余数据同居 `{config_dir}/agent2api.db`。开关开启时会在事件日志留一条记录。

---

## image_compress.rs — 会话图片压缩

- **路由**：`GET /api/image-compress`、`PUT /api/image-compress`
- **请求（PUT）**：`{ "imageCompressEnabled"?: boolean, "imageCompressMaxEdge"?: number, "imageCompressQuality"?: number, "imageCompressThresholdKb"?: number }`
  - `imageCompressEnabled`：布尔，**默认 `true`**（总开关；关 = 出站请求体一个字节都不动）。
  - `imageCompressMaxEdge`：整数，范围 **256–8192**，**默认 2048**。长边像素上限（超过等比缩小，不放大）。
  - `imageCompressQuality`：整数，范围 **40–95**，**默认 80**。JPEG 重编码质量。
  - `imageCompressThresholdKb`：整数，范围 **0–10240**，**默认 512**。触发阈值 KB（解码后小于它保持原样；`0` = 全部处理）。
  - **`null` 一律当类型不符 → 400**。源码注释原文：`null 一律当类型不符（本 PUT 没有「删掉这一项」的语义，缺项即「不动」）`（`server/api/image_compress.rs:77`）。**这一点与 queue / retry / timeouts 三个模块相反**，那些模块 `null` = 不改。
  - 四项都缺省 → **不写盘、不记日志**，直接把当前状态原样返回（`server/api/image_compress.rs:61`）。
- **响应**：`{ "imageCompressEnabled": boolean, "imageCompressMaxEdge": number, "imageCompressQuality": number, "imageCompressThresholdKb": number }`
- **配置键**：`imageCompressEnabled` / `imageCompressMaxEdge` / `imageCompressQuality` / `imageCompressThresholdKb`（config.json）
- **前置**：挂 `protected`，需 API Key 或管理员会话。无其它前置。
- **位置**：
  - 路由登记 `server/http.rs:758`
  - `GET` handler `server/api/image_compress.rs:39`
  - `PUT` handler `server/api/image_compress.rs:44`
  - 请求体 → patch `server/api/image_compress.rs:78`
  - 响应组装 `server/api/image_compress.rs:145`
  - 常量 `server/config/types.rs:993` / `:995` / `:997` / `:999` / `:1005` / `:1007` / `:1009` / `:1012` / `:1013` / `:1015` / `:1016` / `:1018` / `:1019`
  - 读侧解析 `server/config/parse.rs:488`

源码片段：

```rust
// server/api/image_compress.rs:145
fn state_json(settings: ImageCompressSettings) -> Value {
    json!({
        KEY_IMAGE_COMPRESS_ENABLED: settings.enabled,
        KEY_IMAGE_COMPRESS_MAX_EDGE: settings.max_edge,
        KEY_IMAGE_COMPRESS_QUALITY: settings.quality,
        KEY_IMAGE_COMPRESS_THRESHOLD_KB: settings.threshold_kb,
    })
}
```

```rust
// server/config/types.rs:993
pub const KEY_IMAGE_COMPRESS_ENABLED: &str = "imageCompressEnabled";
/// 图片长边像素上限（`imageCompressMaxEdge`）：超过则等比缩小。
pub const KEY_IMAGE_COMPRESS_MAX_EDGE: &str = "imageCompressMaxEdge";
/// JPEG 重编码质量（`imageCompressQuality`，40~95）。
pub const KEY_IMAGE_COMPRESS_QUALITY: &str = "imageCompressQuality";
/// 触发阈值 KB（`imageCompressThresholdKb`）：解码后小于它保持原样（0 = 全部处理）。
pub const KEY_IMAGE_COMPRESS_THRESHOLD_KB: &str = "imageCompressThresholdKb";

pub const DEFAULT_IMAGE_COMPRESS_MAX_EDGE: i64 = 2048;
pub const DEFAULT_IMAGE_COMPRESS_QUALITY: i64 = 80;
pub const DEFAULT_IMAGE_COMPRESS_THRESHOLD_KB: i64 = 512;

pub const IMAGE_COMPRESS_MIN_MAX_EDGE: i64 = 256;
pub const IMAGE_COMPRESS_MAX_MAX_EDGE: i64 = 8192;
pub const IMAGE_COMPRESS_MIN_QUALITY: i64 = 40;
pub const IMAGE_COMPRESS_MAX_QUALITY: i64 = 95;
pub const IMAGE_COMPRESS_MIN_THRESHOLD_KB: i64 = 0;
pub const IMAGE_COMPRESS_MAX_THRESHOLD_KB: i64 = 10240;
```

```rust
// server/config/parse.rs:491
        enabled: map
            .get(KEY_IMAGE_COMPRESS_ENABLED)
            .and_then(Value::as_bool)
            .unwrap_or(true),
```

**默认开的解析口径**：**只有字面 `false` 才算关**，键缺失 / 写成别的值（`"on"` / `1`）都按开 —— 于是升级上来的老配置一启动就是开启状态（`server/config/parse.rs:479-494`）。

作用范围（模块头 `server/api/image_compress.rs:13-15`）：实施点在 `core::upstream::payload::send_body`，**只作用在对话链路**（chat / responses / anthropic 三个入口归一后的 Chat 请求体）；生图与图片编辑走独立分支在该函数开头就返回，天然不经过压缩。

---

## role_compat.rs — 开发者角色兼容

- **路由**：`GET /api/developer-role-compat`、`PUT /api/developer-role-compat`
- **请求（PUT）**：`{ "developerRoleCompat": boolean }`
  - 布尔，**必填**。缺该键 → 400 `缺少 developerRoleCompat`；值非布尔 → 400 `developerRoleCompat 必须是 true 或 false`。
  - 与 `debugMode` 同形：**不是部分更新**，只有一个开关，没有别的字段。
- **响应**：`{ "developerRoleCompat": boolean }`
- **配置键**：`developerRoleCompat`（源码模块头写「`config` 的 `developerRoleCompat` 键（统一库 `kv` 表里的配置行）」，默认开）
- **前置**：挂 `protected`，需 API Key 或管理员会话。无其它前置。
- **位置**：
  - 路由登记 `server/http.rs:708`
  - `GET` handler `server/api/role_compat.rs:30`
  - `PUT` handler `server/api/role_compat.rs:35`
  - 响应组装 `server/api/role_compat.rs:71`
  - 配置键 `server/config/types.rs:114`；默认值 `server/config/mod.rs:603`
  - 写入 `server/config/mod.rs:1901`

源码片段：

```rust
// server/api/role_compat.rs:71
fn role_compat_json() -> Value {
    json!({
        config::KEY_DEVELOPER_ROLE_COMPAT: config::current().developer_role_compat(),
    })
}
```

```rust
// server/config/mod.rs:598
        // 只有字面 `false` 算关闭：**默认开**（缺失 → true）。
        developer_role_compat: raw
            .get(KEY_DEVELOPER_ROLE_COMPAT)
            .and_then(Value::as_bool)
            .unwrap_or(true),
```

```rust
// server/config/types.rs:104
/// 开发者角色兼容开关（config.json 键，设置页「网关 → 开发者角色兼容」）。
/// 开启后转发层在每次出站前把请求 `messages` 里 `role: "developer"` 的消息
/// 改写为 `role: "system"` ...
/// **默认开启**（与 OmniProxy 同默认）
pub const KEY_DEVELOPER_ROLE_COMPAT: &str = "developerRoleCompat";
```

**默认：开启**（缺失 → `true`；**只有字面 `false` 才算关**）。转换实施点在 `core::upstream::payload` 的 `send_body`。

---

## config_api.rs — 网关配置（API Key、语言）

- **路由**：`GET /api/config`、`POST /api/config`、`PUT /api/config`
  - `PUT` 是 Agent2API 改造新增的**别名**，与 `POST` 走**同一个处理函数**，行为逐字一致（路由表注释 `server/http.rs:216-219` 原文：「PUT 是 Agent2API 改造新增的**别名**（架构文档 §5 的接口表写作 GET/PUT）：走同一个处理函数，行为逐字一致」）。
- **请求（POST / PUT）**：`{ "apiKey"?: string | null, "locale"?: string }`
  - `apiKey`：字符串 → 设置 Key，**长度必须 ≥ 8 个字符**（`text.chars().count() < 8` → 400 `API Key 至少需要 8 个字符`）；`null` → **删除 Key**；非 `null` 且非字符串 → 同一个 400 文案。
  - `apiKey` 合法但本机加密不可用 → **500** `API Key 保存失败: <原因>`，且**一个字节都不写**（盘上仍是旧 Key）。这是与校验 400 不同的处置 —— 请求本身没问题，是加密环境不可用。
  - `locale`：**非空**字符串 → 更新语言；空串 → 忽略（不更新）。非字符串 → 忽略。
  - 校验顺序与 Node 版一致：**先校验 apiKey**（非法直接 400，`locale` 的改动也不落盘），再处理 locale。
  - 空 body 视为 `{}`（即什么都不改）。
- **响应（GET）**：`{ "apiKey": string | null, "apiKeySet": boolean, "locale": string, "defaultModel": string, "sanitizeBlacklistFingerprints": boolean }`
  - `apiKey`：**掩码**，格式为 `前6字符...后4字符`（如 `sk-abc...wxyz`）；无 Key 时 `null`。
  - `apiKeySet`：当前是否存在启用的 Key 配置（含旧字段和环境变量）；不表示模型可免鉴权。
  - `sanitizeBlacklistFingerprints`：指纹脱敏开关，**与 `GET /api/sanitize` 的键同名同值**。
- **响应（POST / PUT）**：`{ "apiKeySet": boolean, "locale": string, "defaultModel": string }`
  - 注意：**不含 `apiKey`**（不回显掩码），也不含 `sanitizeBlacklistFingerprints`。
  - 模块头 `server/api/config_api.rs:17` 写作 `{success:true,data:{apiKeySet,locale,defaultModel}}` —— 与代码一致（`ok_json` 负责外层信封）。
- **配置键**：`apiKey`（值可能是 `enc1:` 加密信封）、`locale`、`defaultModel`（本端点只读）、`sanitizeBlacklistFingerprints`（本端点只读）
- **前置**：挂 `protected`，需 API Key 或管理员会话。无其它前置。
- **位置**：
  - 路由登记 `server/http.rs:212`（`get(...).post(...).put(...)`）
  - `GET` handler `server/api/config_api.rs:45`
  - `POST`/`PUT` handler `server/api/config_api.rs:58`
  - 常量 `server/api/config_api.rs:41` / `:43`
  - 掩码实现 `server/config/mod.rs:406`
  - `sanitizeBlacklistFingerprints` 键名 `server/config/types.rs:102`

源码片段：

```rust
// server/api/config_api.rs:48
    ok_json(json!({
        "apiKey": snapshot.masked_api_key(),
        "apiKeySet": snapshot.api_key_set(),
        "locale": snapshot.locale(),
        "defaultModel": snapshot.default_model(),
        // 指纹脱敏开关（与 GET /api/sanitize 同一个键、同一个值）
        config::KEY_SANITIZE_FINGERPRINTS: snapshot.sanitize_fingerprints(),
    }))
```

```rust
// server/api/config_api.rs:112
    ok_json(json!({
        "apiKeySet": snapshot.api_key_set(),
        "locale": snapshot.locale(),
        "defaultModel": snapshot.default_model(),
    }))
```

```rust
// server/api/config_api.rs:40
const MIN_API_KEY_LENGTH: usize = 8;
/// 长度不足时的文案，逐字照抄 Node 版
const API_KEY_TOO_SHORT: &str = "API Key 至少需要 8 个字符";
```

```rust
// server/config/mod.rs:406
    pub fn masked_api_key(&self) -> Option<String> {
        let stored = self.api_key.as_ref().filter(|key| !key.is_empty())?;
        let key = crate::server::core::api_keys::stored_plaintext(stored);
        let head: String = key.chars().take(6).collect();
        let total = key.chars().count();
        let tail: String = key.chars().skip(total.saturating_sub(4)).collect();
        Some(format!("{head}...{tail}"))
    }
```

已下线的字段（源码模块头 `server/api/config_api.rs:19-27` 明确记录，供对照）：
- `providerRoute`（provider 路由优先级）已随「账号全局一条队列」下线，配置里不再有这一项（文件里残留的键原样保留、忽略）；
- 曾经的 `desensitize` 子对象（`{enabled, termCount, roles}` 摘要）随词表方案一起删除。

`locale` 与 `defaultModel` 的具体默认值 `(未确认)` —— 不在本次抓取的源码范围内（本文件只提取它们的字段名与读写语义）。

---

## 汇总表

| 方法 | 路径 | 模块 | 用途 |
| --- | --- | --- | --- |
| GET | `/api/config` | config_api.rs | 读网关配置（掩码 apiKey / apiKeySet / locale / defaultModel / 指纹脱敏开关） |
| POST | `/api/config` | config_api.rs | 写 apiKey / locale（与 PUT 行为一致） |
| PUT | `/api/config` | config_api.rs | 写 apiKey / locale（POST 的别名，同一处理函数） |
| GET | `/api/retry` | retry_api.rs | 读请求重试设置（两档次数 / 间隔 / 错误码名单） |
| PUT | `/api/retry` | retry_api.rs | 部分更新重试设置，返回生效后全量值 |
| GET | `/api/timeouts` | timeouts_api.rs | 读四项上游超时（连接 / 等待响应 / 流空闲 / 非流式） |
| PUT | `/api/timeouts` | timeouts_api.rs | 部分更新四项超时，返回生效后全量值 |
| GET | `/api/queue` | queue_api.rs | 读排队等待设置（次数 / 单次秒数） |
| PUT | `/api/queue` | queue_api.rs | 部分更新排队等待设置，返回生效后全量值 |
| GET | `/api/debug` | debug_api.rs | 读调试模式开关 + 报文存储概况（count / limit） |
| PUT | `/api/debug` | debug_api.rs | 写调试模式开关（`debugMode` 必填） |
| GET | `/api/debug/traffic` | debug_api.rs | 按 `?id=` 取一条请求的原始报文详情 |
| GET | `/api/image-compress` | image_compress.rs | 读会话图片压缩开关 + 长边 / 质量 / 阈值 |
| PUT | `/api/image-compress` | image_compress.rs | 部分更新图片压缩四项，返回生效后全量值 |
| GET | `/api/developer-role-compat` | role_compat.rs | 读开发者角色兼容开关 |
| PUT | `/api/developer-role-compat` | role_compat.rs | 写开发者角色兼容开关（`developerRoleCompat` 必填） |

---

## 附：字段速查（请求字段 → 范围/默认 → 配置键）

| 模块 | 请求字段 | 类型 | 范围 | 默认 | PUT 时 `null` 语义 | 配置键 |
| --- | --- | --- | --- | --- | --- | --- |
| queue_api | `queueMaxWaits` | number(int) | 0–10 | 2 | = 不改 | `queueMaxWaits` |
| queue_api | `queueWaitSeconds` | number(int) | 0–120 | 0（跟随上游建议） | = 不改 | `queueWaitSeconds` |
| retry_api | `retryCount` | number(int) | 0–10 | 3 | = 不改 | `retryCount` |
| retry_api | `retryCrossProviderCount` | number(int) | 0–10 | 5 | = 不改 | `retryCrossProviderCount` |
| retry_api | `retryIntervalSeconds` | number(int) | 0–300 | 5 | = 不改 | `retryIntervalSeconds` |
| retry_api | `noRetryStatusCodes` | number[] | 每项 100–599，≤50 项 | `[402]` | = 不改 | `noRetryStatusCodes` |
| timeouts_api | `connectTimeoutSeconds` | number(int) | 1–3600 | 30 | = 不改 | `connectTimeoutSeconds` |
| timeouts_api | `headersTimeoutSeconds` | number(int) | 1–3600 | 300 | = 不改 | `headersTimeoutSeconds` |
| timeouts_api | `streamIdleTimeoutSeconds` | number(int) | 1–3600 | 300 | = 不改 | `streamIdleTimeoutSeconds` |
| timeouts_api | `bodyTimeoutSeconds` | number(int) | 1–3600 | 300 | = 不改 | `bodyTimeoutSeconds` |
| debug_api | `debugMode` | boolean | true/false | false（关） | 必填，无 `null` 语义 | `debugMode` |
| image_compress | `imageCompressEnabled` | boolean | true/false | true（开） | **400 报错** | `imageCompressEnabled` |
| image_compress | `imageCompressMaxEdge` | number(int) | 256–8192 | 2048 | **400 报错** | `imageCompressMaxEdge` |
| image_compress | `imageCompressQuality` | number(int) | 40–95 | 80 | **400 报错** | `imageCompressQuality` |
| image_compress | `imageCompressThresholdKb` | number(int) | 0–10240 | 512 | **400 报错** | `imageCompressThresholdKb` |
| role_compat | `developerRoleCompat` | boolean | true/false | true（开） | 必填，无 `null` 语义 | `developerRoleCompat` |
| config_api | `apiKey` | string \| null | 长度 ≥ 8 字符 | — | `null` = **删除 Key** | `apiKey` |
| config_api | `locale` | string | 非空才生效 | — | 忽略（不更新） | `locale` |

两种 `null` 语义务必区分：queue / retry / timeouts 是「这一项不改」，config_api 的 `apiKey: null` 是「删除 Key」，image_compress 的 `null` 是类型错误 400。

---

## 复核用源码副本

已按仓库真实相对路径落盘于 `C:\Users\Admin\Downloads\HG\gw-src\`：

```
desktop-tauri/src-tauri/server/src/server/api/queue_api.rs
desktop-tauri/src-tauri/server/src/server/api/retry_api.rs
desktop-tauri/src-tauri/server/src/server/api/timeouts_api.rs
desktop-tauri/src-tauri/server/src/server/api/debug_api.rs
desktop-tauri/src-tauri/server/src/server/api/image_compress.rs
desktop-tauri/src-tauri/server/src/server/api/role_compat.rs
desktop-tauri/src-tauri/server/src/server/api/config_api.rs
desktop-tauri/src-tauri/server/src/server/api/mod.rs
desktop-tauri/src-tauri/server/src/server/http.rs
desktop-tauri/src-tauri/server/src/server/errors.rs
desktop-tauri/src-tauri/server/src/server/config/types.rs
desktop-tauri/src-tauri/server/src/server/config/mod.rs
desktop-tauri/src-tauri/server/src/server/config/parse.rs
desktop-tauri/src-tauri/server/src/server/core/debug_traffic.rs
```

每个文件由 `git/blobs/{sha}`（tag `v3.4.2` 的 tree 给出 sha）下载并按 base64 解码写入，字节长度与该 tag 的 tree 条目 size 逐一相符，内容身份即 `v3.4.2` 对应 blob。

## 未确认项汇总

- `/api/config` 响应里 `locale` 与 `defaultModel` 的**默认值** `(未确认)`（本次未抓取决定这两项默认值的代码）。
- 本批七个模块中**未发现任何**「网关必须在运行」一类前置判定 `(未确认)`；准入条件只有 §0.4 的鉴权一条。
- `api/mod.rs` 的模块头注释里**没有**登记 `timeouts_api.rs` 的路由（注释只列了 retry / queue），其真实路径以 `server/http.rs:296` 的路由登记为准。
