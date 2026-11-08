# Agent2API v3.4.2 —「内容与识别类设置」HTTP 契约提取

来源仓库：`aimod-cc/Agent2API`，tag `v3.4.2`
源码目录：`desktop-tauri/src-tauri/server/src/server/api/`
提取方式：下载该 tag 下原始文件后逐行阅读；所有字段名逐字来自源码。

本批 7 个文件（git blob SHA-1 + 字节数）：

| 文件 | 字节 | blob SHA-1 |
|---|---|---|
| `prompt.rs` | 33085 | `3cc0587d219d13635fd88b82167e7396cef53880` |
| `sanitize.rs` | 5483 | `8d1bbe46b3451267c9995033885b51e5caf4e6cb` |
| `client_identification.rs` | 5684 | `5e66acc92b685843b3f4104f800dccbcf026d25f` |
| `model_meta.rs` | 4990 | `b52c76fa2c609567cf60e50bd3c4496532fbead2` |
| `cors.rs` | 3702 | `7856ca5bfc9f0598b80a6728ddc5d0c6d3c91fb0` |
| `captcha.rs` | 5112 | `94b140753b5b820622413a0f4315fd54a91282bf` |
| `sidebar_layout.rs` | 3654 | `930876f5238caf11111baefcab31e99827937d24` |

---

## 0. 全批共用事实（先读这一节）

### 0.1 路由登记表在哪
`api/mod.rs` **只声明模块**（`pub mod prompt;` 等，`api/mod.rs:139`、`api/mod.rs:159`、`api/mod.rs:67`、`api/mod.rs:94`、`api/mod.rs:84`、`api/mod.rs:119`、`api/mod.rs:164`），**不含路由**。
真正的路由表在 `server/src/server/http.rs` 的 `panel_router()`（`http.rs:89`）里，本批 7 个模块**全部注册在该函数的 `protected` 路由组**内，该组末尾统一挂 `.layer(middleware::from_fn(require_api_key))`（`http.rs:901`）。

### 0.2 鉴权（前置条件）
`require_api_key`（`http.rs:1174`）对 `/api/*` 的准入规则：

- **管理员面板会话**（`access::session_valid`）通过 —— 即「需要管理员」。
- **不限权的网关 API Key** 通过（`http.rs:1205`，桌面壳 / 脚本自动化通道）。
- **受限 API Key**（`scope.restricts_models()` 或 `scope.restricts_providers()`）访问非模型端点 → `403`，code `management_access_denied`，文案「受限 API Key 不能访问管理接口，请使用管理员会话登录」（`http.rs:1192-1194`）。
- 都没有 → 面板登录跳转响应（`errors::panel_login_required_response_with_refresh_state`）。

结论：**本批 7 个模块的全部端点都需要管理员会话或管理员级 API Key**；没有一条是公开端点，也没有「桌面形态才可用」的限制（形态差异只体现在响应字段上，见 `captcha.rs` 的 `localPanel`）。

### 0.3 错误信封
管理面（`/api/*`）错误体统一为 `{ "success": false, "error": "<文案>" }`（`errors.rs:362-368`，`errors::management_error`）。**不是** OpenAI 风格。
成功体为裸 JSON 对象（`http::ok_json`，`http.rs:1295`），**没有** `success: true` 包裹。

### 0.4 配置落盘位置
配置落在统一库 `kv` 表的配置行（config JSON），按顶层键读写。涉及本批的键（字面值逐字来自源码）：

| 配置键（字面） | 定义位置 | 归属模块 |
|---|---|---|
| `promptMode` | `config/types.rs:218` | prompt |
| `promptFile` | `config/types.rs:225` | prompt |
| `promptText` | `config/types.rs:239` | prompt |
| `promptProviders` | `config/types.rs:254` | prompt |
| `promptGateway` | `config/types.rs:274` | prompt |
| `promptGatewayText` | `config/types.rs:290` | prompt |
| `sanitizeBlacklistFingerprints` | `config/types.rs:102` | sanitize |
| `sanitizeFingerprintRules` | `config/sanitize_config.rs:9` | sanitize |
| `sanitizeFingerprintProviders` | `config/sanitize_config.rs:10` | sanitize |
| `clientIdentification` | `config/client_identification.rs:9` | client_identification |
| `corsEnabled` | `config/types.rs:146` | cors |
| `captchaEnabled` | `config/types.rs:185` | captcha（旧键） |
| `captchaDesktop` | `config/types.rs:192` | captcha |
| `captchaWeb` | `config/types.rs:197` | captcha |
| `modelsDevEnabled` | `config/types.rs:209` | model_meta |

`sidebar_layout` **不落 config JSON**，落 `kv` 表的固定键 `sidebarLayout`（`core/sidebar_layout.rs:37`，`KV_KEY`）。

### 0.5 部分更新（partial update）的三套口径
本批同时存在三种「省略字段」的语义，**不能混用**：

1. **省略 / `null` 都 = 不改**：`prompt.rs` 的全局项（`prompt.rs:83-136`）、`captcha.rs` 的两个布尔（`captcha.rs:68-71`）。
2. **省略 = 不改；`null` = 清除 / 回默认**：
   - `prompt.rs` 的 `promptProviders.<id> = null` → 删掉这一家；`promptGateway.<id> = null` → 删键回默认；`promptGatewayText.<id> = null` → 回官方原文；段值 `null` = 该段不改（`prompt.rs:351`）、段值空串 = 清掉该段。
   - `sanitize.rs` 的 `sanitizeFingerprintRules: null` → 恢复内置词表（`sanitize.rs:74`）。
3. **`null` ≠ 不改**（唯一的反例）：`sanitize.rs` 的 `sanitizeFingerprintProviders: null` → 归一成**空数组**，而空数组语义是「应用到全部提供商」（`sanitize.rs:93-95` + `config/sanitize_config.rs:36-41`）。也就是说显式传 `null` **会**把已选范围改写成「全部」并落盘。

---

## prompt.rs — 系统提示词

- **路由**：`GET /api/prompt`、`PUT /api/prompt`（`http.rs:804-807`；`prompt.rs:56` GET handler、`prompt.rs:61` PUT handler）
- **请求（PUT）**：JSON 对象，全部字段可选，未知字段被**静默忽略**（无 `deny_unknown_fields`）

```jsonc
{
  "promptMode": "passthrough" | "custom" | "append",  // 可选，null=不改
  "promptFile": ""    | "<路径>" | null,              // 可选；空串=清除→回内置默认；null=不改
  "promptText": ""    | "<正文>" | null,              // 可选；空串=清除界面正文；null=不改
  "promptProviders": {                                // 可选，null=不改
    "<providerId>": {                                 //   值 null = 删掉这一家（回落全局）
      "promptMode": "passthrough|custom|append",      //   可选，null=保持这家原值；这家没配过则兜底为全局模式
      "promptFile": "" | "<路径>" | null,             //   可选，null=保持原值；空串=清除
      "promptText": "" | "<正文>" | null              //   可选，null=保持原值；空串=清除
    }
  },
  "promptGateway": {                                  // 可选，null=不改
    "<providerId>": true | false | null               //   必须是布尔或 null；null=删键回默认（装）
  },
  "promptGatewayText": {                              // 可选，null=不改
    "<providerId>": {                                 //   值 null = 回官方原文
      "identity": "<文本>",                           //   段名 = GatewayBlocks::FIELDS，三段固定
      "stable":   "<文本>",
      "dynamic":  "<文本>"
    }
  },
  "clearDegrade": true | false                        // 可选，默认 false；独立的动作，非布尔值被忽略（.and_then(as_bool)）
}
```

字段细节与校验（逐条对应源码）：

| 字段 | 类型 | 取值 | 校验 / 语义 |
|---|---|---|---|
| `promptMode` | string | `passthrough` / `custom` / `append` | 大小写不敏感 + 去首尾空白；空串按 `passthrough`。非法 → `400`，文案格式 `"{promptMode} 只认 {}（收到: {text}）"`，其中 `{}` = `allowed_modes()` = `"passthrough / custom / append"`（`prompt.rs:89-96` + `prompt.rs:640-646`）。非字符串 → `400` `promptMode 必须是字符串（收到: {value}）` |
| `promptFile` | string \| null | 路径；空串/纯空白 = 清除 | 非字符串非 null → `400`。**仅在 `custom`/`append` 且 `promptText` 为空时**才校验文件可读（`prompt.rs:139-145`）；读不到 → `400`（写侧当场报错，读侧回落内置默认并记 `promptFileError`） |
| `promptText` | string \| null | 正文；空串/纯空白 = 清除 | 优先级**高于** `promptFile` 与内置默认；它非空时不校验文件 |
| `promptProviders` | object \| null | 见上 | 非对象非 null → `400`。每个 id：空串 → `400`「提供商 id 不能为空串」；未登记 → `400`「未知的提供商 id：{id}（只能配已登记的提供商）」（`providers::is_known_provider_id`）。**整批校验通过才落盘**——一条请求改三家、第三家写错则前两家也不写（`prompt.rs:153-154`） |
| `promptGateway` | object \| null | `bool \| null` 值 | 非对象 → `400`；值非 bool/null → `400` `promptGateway.{id} 必须是 true / false / null` |
| `promptGatewayText` | object \| null | 见上 | 非对象 → `400`；段值非字符串非 null → `400` `promptGatewayText.{id}.{field} 必须是字符串或 null`；段名认不出的被忽略 |
| `clearDegrade` | bool | — | 为 `true` 且当前处于降级期时调 `degrade::clear()`；与配置写入相互独立 |

- **响应（GET 与 PUT **同形**，PUT 直接用响应刷新界面，前端不必再 GET 一次）**

```jsonc
{
  "promptMode": "passthrough|custom|append",
  "promptFile": "<字符串，未指定时为空串>",
  "promptText": "<**生效**正文；passthrough 下是用户存下的界面正文或空串>",
  "promptSource": "none" | "builtin" | "file" | "inline",
  "promptFileError": "<原因>" | null,
  "promptLines": 123,                     // 生效正文行数（promptText.lines().count()）
  "degradeActive": false,                 // 是否处于内容拦截降级期
  "degradeUntil": 0,                      // 降级截止时刻，UTC 毫秒；0 = 不在降级期
  "degradeUntilText": "",                 // 本地化文案（UTC+8，"%Y/%m/%d %H:%M"），不在降级期为空串
  "promptProviders": {                    // 只含**配过的家**
    "<providerId>": {
      "promptMode": "...",
      "promptFile": "...",
      "promptText": "...",
      "promptSource": "none|builtin|file|inline",
      "promptLines": 0,
      "promptFileError": null
    }
  },
  "promptGateway": { "<providerId>": true },       // 只含**被明确拨过**的家；键缺失 = 默认装
  "promptGatewayText": {                           // 只含**改过的段**
    "<providerId>": { "identity": "...", "stable": "...", "dynamic": "..." }
  },
  "promptProviderOptions": [                       // 注册表全量（界面下拉）
    {
      "id": "zcode",
      "label": "ZCode",
      "gatewayNote": "<说明>" | null,              // 非空 = 这家有网关提示词装配
      "gatewayChars": 1234 | null,                 // 那段装配的字符数
      "gatewayBlocks": { "identity": "...", "stable": "...", "dynamic": "..." } | null
    }
  ]
}
```

响应体逐字片段（`prompt.rs:505-537`）：

```rust
json!({
    KEY_PROMPT_MODE: settings.mode.as_str(),
    KEY_PROMPT_FILE: settings.file.clone().unwrap_or_default(),
    KEY_PROMPT_TEXT: settings.text,
    "promptSource": settings.source.as_str(),
    "promptFileError": settings.file_error,
    "promptLines": settings.text.lines().count(),
    "degradeActive": degrade::active(),
    "degradeUntil": degrade::until_ms(),
    "degradeUntilText": degrade::until_text(),
    KEY_PROMPT_PROVIDERS: providers_json(settings),
    KEY_PROMPT_GATEWAY: gateway_json(settings),
    KEY_PROMPT_GATEWAY_TEXT: gateway_text_json(settings),
    "promptProviderOptions": provider_options(state).await,
})
```

**返回整表还是单项**：
- `promptProviders` / `promptGateway` / `promptGatewayText` 三个都是**稀疏子表**——只回已配 / 已拨 / 已改的项（`prompt.rs:541`、`prompt.rs:560`、`prompt.rs:569`）。
- `promptGatewayText.<id>` 内**只含改过的段**（`gateway_text_json` 里 `if !text.trim().is_empty()` 才插入，`prompt.rs:575`）。
- 官方原文不在 `promptGatewayText` 里回，而在 `promptProviderOptions[].gatewayBlocks` 里给（编辑器当初始值与「恢复官方原文」的目标，`prompt.rs:532-533`）。
- 写入是**逐家逐项**的部分更新（`config::set_prompt_provider` / `set_prompt_gateway` / `set_prompt_gateway_text` 一家一条，`prompt.rs:398-423`），不是整表替换。

- **子结构：三段块 `GatewayBlocks`**
  段名常量 `GatewayBlocks::FIELDS = ["identity", "stable", "dynamic"]`（`core/prompt.rs:191`），字段 `identity` / `stable` / `dynamic`（`core/prompt.rs:180-187`）。三段必须**各自成块**（上游按结构校验：三段并成一段会 405/3012，`core/prompt.rs:171-173`）。
  动态段（`dynamic`）支持占位符，发请求时才换真值：`{cwd}`、`{platform}`、`{shell}`、`{os_version}`、`{git}`、`{provider}`、`{model}`（`config/types.rs:284-287`）。

- **子结构：`promptMode` 枚举**
  `PromptMode::ALL = [Passthrough, Custom, Append]`（`core/prompt.rs:84-88`），字符串形态 `passthrough` / `custom` / `append`（`core/prompt.rs:91-97`），解析时 `trim().to_ascii_lowercase()`，**空串按 `passthrough`**（`core/prompt.rs:103-111`）。`custom` 不参与降级（`PromptMode::degradable()`，`core/prompt.rs:126-128`）。

- **子结构：`promptSource` 枚举**
  `none`（passthrough）/ `builtin`（内置默认）/ `file`（文件）/ `inline`（界面正文）（`core/prompt.rs:149-156`）。

- **生效文本的唯一解析口径 `resolve_choice`**（`config/mod.rs:844-896`）：
  - 非 `custom`/`append`（即 `passthrough`）：**不读盘**；`text` = 用户存下的界面正文（若有），`source` 恒为 `none`，`file` 保留但 `file_error` 恒为 `null`。
  - `custom`/`append`：`inline` 非空白 → 以它为准，**不读文件**、`file_error` 为 `null`；否则文件非空则读，成功 → `file`；失败 → 回落内置默认 + `file_error` 记原因；文件未指定 → `builtin`。

- **配置键**：`promptMode` / `promptFile` / `promptText` / `promptProviders` / `promptGateway` / `promptGatewayText`（见 0.4 表）。降级状态**不落盘**（进程内 `AtomicI64`，`core/degrade.rs:51`）。

- **前置**：需要管理员（在 `protected` 组，`http.rs:804-807`）。无形态限定。
- **副作用**：`clearDegrade: true` 且降级中会清降级期；配置真变化才写运行日志（`prompt.rs:431-439`）。
- **注意**：GET 会对**每一家**已登记提供商各发一次插件 RPC（`prompt.info` 管理动作）来填 `promptProviderOptions`（`prompt.rs:597-637`），插件不在时三项为 `null`/`0`。
- **位置**：`prompt.rs:57`（GET）/ `prompt.rs:71`（PUT）/ `prompt.rs:83-145`（全局三项）/ `prompt.rs:156-269`（promptProviders）/ `prompt.rs:277-311`（promptGateway）/ `prompt.rs:319-373`（promptGatewayText）/ `prompt.rs:376-386`（clearDegrade）/ `prompt.rs:503-537`（响应体）/ `prompt.rs:597-613`（providerOptions）

---

## sanitize.rs — 出站指纹脱敏

- **路由**：`GET /api/sanitize`、`PUT /api/sanitize`（`http.rs:699-702`；handler `sanitize.rs:21`、`sanitize.rs:25`）
- **请求（PUT）**：JSON 对象。**至少要给三个键之一**，否则 `400`「请提供指纹脱敏开关、词表或应用提供商」（`sanitize.rs:54-63`）。

```jsonc
{
  "sanitizeBlacklistFingerprints": true | false,   // 可选；非布尔 → 400
  "sanitizeFingerprintRules": [ /* SanitizeRule */ ] | null,
                                                   // 省略 = 不改；null = 恢复内置词表；[] = 空词表
  "sanitizeFingerprintProviders": ["zcode", "..."] | null
                                                   // 省略 = 不改；null = 清空（= 全部提供商）
}
```

- **子结构：脱敏规则元素 `SanitizeRule`**（`core/sanitize/rules.rs:57-74`，Serde `rename_all = "camelCase", deny_unknown_fields`）

| JSON 字段 | Rust 字段 | 类型 | 可选性 / 默认 | 约束 |
|---|---|---|---|---|
| `id` | `id` | string | **必填** | 1–64 位，仅 `[A-Za-z0-9_-]`；不得重复（`rules.rs:113-126`） |
| `name` | `name` | string | **必填** | 去首尾空白后 1–128 字符（`MAX_NAME_CHARS`，`rules.rs:8`） |
| `enabled` | `enabled` | bool | 可选，**默认 `true`**（`enabled_by_default`，`rules.rs:62-63`、`rules.rs:82-84`） | `false` 的规则保留在词表里但不参与替换（`rules.rs:157-162`） |
| `matchType` | `match_type` | string | 可选，默认 `"literal"`（`rules.rs:64-65`） | `"literal"` \| `"regex"`（`rename_all = "lowercase"`，`rules.rs:13-18`） |
| `pattern` | `pattern` | string | **必填** | 非空白、≤ 4096 字符（`MAX_PATTERN_CHARS`，`rules.rs:9`） |
| `replacement` | `replacement` | string | 可选，默认 `""` | ≤ 4096 字符（`MAX_REPLACEMENT_CHARS`，`rules.rs:10`） |
| `repeat` | `repeat` | bool | 可选，默认 `false` | **只有正则删除规则可以启用**：`repeat && (matchType != regex || replacement != "")` → 报错（`rules.rs:144-147`） |
| `roles` | `roles` | string[] | 可选，默认 `[]`；**空数组时序列化时被省略**（`skip_serializing_if = "Vec::is_empty"`，`rules.rs:72`） | 元素取值 `system`/`developer`/`user`/`assistant`/`tool`/`function`；写入时排序去重 |

  规则数组整体约束：最多 `MAX_RULES = 200` 条（`rules.rs:7`）。正则编译 `size_limit = 1 MiB`（`rules.rs:152`）。角色语义：`roles` 为空 = 沿用旧规则的全字段行为；指定角色时**只改对应消息的正文**（`core/sanitize/rules.rs:76-80`）。

- **响应（GET **及** PUT 同形；PUT 额外多一个 `saved`）**

```jsonc
{
  "sanitizeBlacklistFingerprints": true,
  "sanitizeFingerprintRules": [ /* 当前生效词表（含 enabled=false 的条目） */ ],
  "sanitizeFingerprintProviders": ["zcode"],       // 空数组 = 全部提供商
  "defaultRules": [ /* 内置词表全量 */ ],
  "customRules": false,                            // true = 当前词表是用户自定义的
  "providerOptions": [ { "id": "...", "label": "...", "count": 0, "category": "agent|...", "source": "builtin|plugin" } ],
  "roleOptions": ["system","developer","user","assistant","tool","function"],
  "limits": { "maxRules": 200, "maxNameChars": 128, "maxPatternChars": 4096, "maxReplacementChars": 4096 }
}
```

PUT 响应额外：`"saved": true|false`（配置写盘是否成功；失败也回 2xx，`sanitize.rs:47-49`）。

响应体逐字片段（`sanitize.rs:140-154`）：

```rust
json!({
    KEY_SANITIZE_FINGERPRINTS: settings.enabled,
    KEY_SANITIZE_RULES: settings.rules.entries(),
    KEY_SANITIZE_PROVIDERS: settings.providers,
    "defaultRules": sanitize::default_rules().entries(),
    "customRules": settings.custom_rules,
    "providerOptions": options,
    "roleOptions": sanitize::SanitizeRole::ALL,
    "limits": {
        "maxRules": sanitize::MAX_RULES,
        "maxNameChars": sanitize::MAX_NAME_CHARS,
        "maxPatternChars": sanitize::MAX_PATTERN_CHARS,
        "maxReplacementChars": sanitize::MAX_REPLACEMENT_CHARS,
    },
})
```

**返回整表还是单项：脱敏词表是「整表替换」，不是逐条增删。**
`PUT` 里 `sanitizeFingerprintRules` 是一个数组，整体经 `RuleSet::compile` 编译后整份写入配置键 `sanitizeFingerprintRules`（`config/sanitize_config.rs:97-103`）。客户端要改一条规则，必须**把完整数组发回来**。`null` = 从配置里删掉该键并回落内置词表（`config/sanitize_config.rs:104-108`，同时 `customRules` 变回 `false`）；`[]` = 空词表（什么都不替换）。
`GET` 回的是当前词表全量（`settings.rules.entries()`，含 `enabled: false` 的条目）。

- **`providerOptions` 的来源与形状**：内置家 `{id,label,count,category,source}`（`core/providers/mod.rs:517-525`，插件家 `source: "plugin"`、`category` 来自插件，否则 `category: "agent"`、`source: "builtin"`），自定义家 `{id,label,count}`（`core/custom_providers.rs:607`）；若已选范围内的 id 不在上面两张表里（插件被临时卸载），额外补 `{"id": id, "label": providers::label_of(id)}`（`sanitize.rs:132-139`）。

- **`sanitizeFingerprintProviders` 的校验**（`sanitize.rs:92-125`）：
  - 必须是数组（或 `null`）；元素必须是字符串；元素 `trim().to_ascii_lowercase()` 后不能为空。
  - 最多 `MAX_SANITIZE_PROVIDERS = 200` 个（`config/sanitize_config.rs:11`）。**`null` 会在长度检查之前直接返回空数组**，因此不受 200 上限约束。
  - 未知 id → `400`「未知的提供商：{id}」——**除非**它已在当前已选范围里（`previous.contains(&id)`），这样「插件暂时卸载时保留已选范围，不能因为保存词表而扩大成全部提供商」（`sanitize.rs:113-118`）。
  - 结果 **`sort()` + `dedup()`** 后落盘。
  - 语义：空数组 = 全部提供商，**包含之后新增的插件与自定义提供商**（`config/sanitize_config.rs:17`、`config/sanitize_config.rs:34-41`）。

- **生效范围**：`sanitize::sanitize_body` 只改写出站请求副本，且仅当 `body.messages` 是数组时（`core/sanitize.rs:172-179`）；改写 `content`（字符串或 `[{text}]` 数组）、`reasoning_content`、`tool_calls[].function.arguments`（`core/sanitize.rs:138-170`）。字面替换与正则替换的替换文本都**不解释 `$` 捕获组**（`regex::NoExpand`，`core/sanitize.rs:68`）。

- **配置键**：`sanitizeBlacklistFingerprints`（默认 `true`，`config/sanitize_config.rs:71-74`）/ `sanitizeFingerprintRules` / `sanitizeFingerprintProviders`。

- **前置**：需要管理员（`http.rs:698-702`）。无形态限定。
- **位置**：`sanitize.rs:21`（GET）/ `sanitize.rs:25`（PUT）/ `sanitize.rs:52-90`（parse_patch）/ `sanitize.rs:92-125`（parse_providers）/ `sanitize.rs:127-155`（响应体）/ `core/sanitize/rules.rs:57-74`（SanitizeRule）/ `core/sanitize/rules.rs:104-165`（RuleSet::compile 校验）

---

## client_identification.rs — 客户端识别（软件标识归类）

- **路由**：`GET /api/client-identification`、`PUT /api/client-identification`、`POST /api/client-identification/preview`（`http.rs:756-757`；handler `client_identification.rs:30`、`client_identification.rs:39`、`client_identification.rs:112`）
- **请求（PUT）**：结构体 `SaveSettings`（`client_identification.rs:32-37`），Serde `rename_all = "camelCase", deny_unknown_fields` —— **两个字段都必填**，多一个未知字段即 `400`。

```jsonc
{
  "config": {                       // 必填，ClientSettings
    "acceptDeclarations": true,     // bool
    "clients": [                    // 自定义客户端表
      { "id": "custom:xxxxxxxx", "name": "<显示名>" }
    ],
    "rules": [                      // 识别规则表
      {
        "id": "<规则 id>",
        "enabled": true,
        "header": "user-agent" | "x-title" | "x-client-type"
                  | "x-cerebras-3rd-party-integration" | "x-agent2api-client",
        "matchType": "product" | "prefix" | "contains" | "exact",
        "pattern": "<匹配内容>",
        "clientId": "<内置 id 或 custom:* id>"
      }
    ]
  },
  "revision": "<GET 回的 revision 原样回传>"   // 必填，乐观锁
}
```

- **子结构：`ClientSettings`**（`core/client/catalog.rs:66-72`，`rename_all = "camelCase", deny_unknown_fields`）

| JSON 字段 | Rust 字段 | 类型 | 默认 |
|---|---|---|---|
| `acceptDeclarations` | `accept_declarations` | bool | `false`（`#[derive(Default)]`） |
| `clients` | `clients` | `CustomClient[]` | `[]` |
| `rules` | `rules` | `ClientRule[]` | `[]` |

- **子结构：`CustomClient`**（`catalog.rs:44-49`）：`id`（string，必须 `custom:` 前缀、长度 ≥ 12、≤ 80 字符、字符集 `[A-Za-z0-9_:-]`）、`name`（string，≤ 80 字符）。

- **子结构：`ClientRule`**（`catalog.rs:55-64`，`rename_all = "camelCase", deny_unknown_fields`）

| JSON 字段 | Rust 字段 | 类型 | 约束 |
|---|---|---|---|
| `id` | `id` | string | 非空、≤ 80、字符集 `[A-Za-z0-9_:-]`、不重复（`catalog.rs:102-103`、`catalog.rs:120`） |
| `enabled` | `enabled` | bool | **必填**（无 `default`） |
| `header` | `header` | string | 必须是 `user-agent` 或 `IDENTITY_HEADERS` 之一（`catalog.rs:123-125`）。`IDENTITY_HEADERS = ["x-agent2api-client","x-title","x-client-type","x-cerebras-3rd-party-integration"]`（`catalog.rs:36-38`）；`DECLARATION_HEADER = "x-agent2api-client"`（`catalog.rs:35`） |
| `matchType` | `match_type` | string | `"product"` \| `"prefix"` \| `"contains"` \| `"exact"`（`rename_all = "snake_case"`，`catalog.rs:51-53`） |
| `pattern` | `pattern` | string | 非空、无控制字符、`text.trim() == text`、≤ `MAX_HEADER_BYTES = 256` 字符（`catalog.rs:40`、`catalog.rs:100-101`、`catalog.rs:126-128`） |
| `clientId` | `client_id` | string | 必须能解析到内置家或自定义家，否则 400「识别规则指向的客户端不存在」（`catalog.rs:133-135`） |

  `matchType: "product"` 额外约束：`header` 必须是 `user-agent`，且 `pattern` 只允许 `[A-Za-z0-9_.-]` 与空格（不能含版本号分隔符 `/`）（`catalog.rs:129-132`）。

  数量上限：`rules ≤ MAX_RULES = 200`，`clients ≤ MAX_CLIENTS = 100`（`catalog.rs:41-42`、`catalog.rs:97-98`）。

  自定义 `clients[].name` 禁用名单（会被判非法）：`"other"`、`"unknown"`、`"assistant"`、`"model_test"`、`"assistant_images"`、`"assistant_title"`、`"checkin_keepalive"`，且不能与内置名冲突、不能重复（`catalog.rs:112-116`）。

- **响应（GET / PUT 同形，PUT 也回复 GET 的视图，`client_identification.rs:49`）**

```jsonc
{
  "config": { /* 当前 ClientSettings，camelCase */ },
  "revision": "<sha256(配置值 JSON 序列化文本) 的十六进制；无配置时为 null 的哈希>",
  "builtins": [ { "id": "claude-code", "name": "Claude Code", "value": "Claude Code", "products": ["claude-cli","claude-code"] }, /* …共 20 项 */ ],
  "headers": ["user-agent", "x-title", "x-client-type", "x-cerebras-3rd-party-integration", "x-agent2api-client"],
  "declarationHeader": "x-agent2api-client",
  "maxRules": 200,
  "maxClients": 100
}
```

响应体逐字片段（`client_identification.rs:14-20`）：

```rust
json!({
    "config": settings, "revision": snapshot.revision,
    "builtins": catalog::CLIENTS,
    "headers": ["user-agent", "x-title", "x-client-type", "x-cerebras-3rd-party-integration", catalog::DECLARATION_HEADER],
    "declarationHeader": catalog::DECLARATION_HEADER,
    "maxRules": catalog::MAX_RULES, "maxClients": catalog::MAX_CLIENTS,
})
```

`builtins` 元素字段：`id` / `name` / `value` / `products`（`catalog.rs:3-10`）。共 **20 家**内置客户端（`catalog.rs:12-33`）：`claude-code`、`codex`、`zcode`、`github-copilot`、`cherry-studio`、`dsh`、`magpie`、`hermes`、`hindsight`、`cline`、`cursor`、`opencode`、`workbuddy`、`codebuddy`、`kimi-code`、`zed`、`crush`、`qwen-code`、`factory-droid`、`goose`。

**返回整表还是单项：整表替换 + 乐观锁。**
`clientIdentification` 键被 `config` 整个替换（`config/client_identification.rs:51`）。`revision` 不匹配 → **`409`**，文案「客户端识别设置已在其他位置修改，请重新读取后再保存；当前草稿未丢失」（`config/client_identification.rs:48-50`）。
`revision` 的计算方式：`sha256(<该配置值的 JSON 文本>.to_string())` 的十六进制；键不存在时对 `Value::Null` 求哈希（`config/client_identification.rs:21-23`）。
配置写盘失败 → `500`「客户端识别设置保存失败，未应用本次修改」。校验失败 → `400`。

- **请求（POST /api/client-identification/preview）**：结构体 `PreviewSettings`（`client_identification.rs:56-64`），`rename_all = "camelCase"`（**无** `deny_unknown_fields`）

```jsonc
{
  "config": { /* 同上 ClientSettings，必填，用于试算而非保存 */ },
  "ruleId": "<可选，默认空串；非空时必须存在于 config.rules 里，否则 400「待预览的识别规则不存在」>",
  "sample": { /* 可选，一份 ClientEvidence；见下 */ }
}
```

`sample` 用的是 `ClientEvidence`（`core/client/evidence.rs:10-39`，`rename_all = "camelCase"`，全部字段带 `#[serde(default)]`，无 `deny_unknown_fields` → 可只给部分字段）：

`userAgent`(string) / `userAgentTruncated`(bool) / `headers`(object，键为请求头名) / `truncatedHeaders`(string[]) / `invalidHeaders`(string[]) / `method`(string) / `ruleId`(string) / `matchedHeader`(string) / `matchedPattern`(string) / `clientId`(string) / `clientName`(string) / `candidate`(string) / `declarationStatus`(string)。

- **响应（preview）**：

```jsonc
{
  "scanned": 12,     // 窗口内实际参与试算的记录数（client_evidence 非空且 method 非空）
  "matched": 8,      // ruleId 命中数
  "applied": 5,      // 最终生效的是该 ruleId 的条数
  "window": 500,     // 扫描窗口常量：最近 500 行
  "samples": [       // 最多 20 条
    {
      "id": "<requests.id>",
      "ts": 1700000000000,
      "before": "<原 client 值>",
      "client": "<识别后 client 值>",
      "clientLabel": "<显示名>",
      "evidence": { /* ClientEvidence */ },
      "ruleMatches": true,
      "ruleApplied": true
    }
  ],
  "sample": { /* 与 samples 元素同形但没有 id/ts；请求未给 sample 时为 null */ }
}
```

`ruleId` 为空串时不按规则过滤：`ruleMatches` / `ruleApplied` 恒为 `true`（`client_identification.rs:83-85`、`is_none_or`）。

- **补充：客户端识别的头白名单**
  `ClientEvidence::capture` 只采集 `user-agent` + `IDENTITY_HEADERS`；多个同名头或含控制字符的值 → 记进 `invalid_headers` 并跳过；`user-agent` 截断上限 `MAX_UA_BYTES = 1024` 字节，其它头 `MAX_HEADER_BYTES = 256` 字节（`evidence.rs:52-71`、`catalog.rs:39-40`）。

- **配置键**：`clientIdentification`（`config/client_identification.rs:9`）。读侧解析/校验失败时 `config` 报错（`GatewayError`，`config/client_identification.rs:28-31`），GET 会把该错误按 `status_code` 返回。
- **前置**：需要管理员（`http.rs:751-757`，注释明确说明它改写发给上游的请求体）。无形态限定。
- **位置**：`client_identification.rs:11-21`（view）/ `client_identification.rs:30`（GET）/ `client_identification.rs:39`（PUT）/ `client_identification.rs:56-64`（PreviewSettings）/ `client_identification.rs:66-110`（preview）/ `client_identification.rs:112`（preview handler）/ `core/client/catalog.rs:44-72`（结构体）/ `core/client/catalog.rs:95-138`（validate）

---

## model_meta.rs — models.dev 模型元数据

- **路由**：`GET /api/models/metadata`、`PUT /api/models/metadata`、`POST /api/models/metadata/refresh`（`http.rs:594-598`；handler `model_meta.rs:49`、`model_meta.rs:57`、`model_meta.rs:90`）
- **请求（PUT）**：JSON 对象，**必须**含 `modelsDevEnabled`

```jsonc
{ "modelsDevEnabled": true | false }   // 缺失 → 400「缺少 modelsDevEnabled 字段」；非布尔 → 400「modelsDevEnabled 必须是布尔值」
```

- **请求（POST refresh）**：**无请求体**（handler 只取 `State`）。
- **响应（GET / PUT 同形；PUT 也回复新状态）**

```jsonc
{
  "source": "builtin" | "cache" | "network",   // 当前索引来历
  "updatedAt": 1700000000000,                  // 索引生成时刻（毫秒）；未知名 0
  "count": 1234,                                // 索引里的模型条数
  "modelsDevEnabled": true                      // 由 handler 注入（model_meta.rs:40-43）
}
```

前三个字段来自 `core::model_meta::status()`（`core/model_meta/snapshot.rs:130-137`）：

```rust
serde_json::json!({
    "source": snapshot.source,
    "updatedAt": snapshot.generated_at,
    "count": snapshot.models.len(),
})
```

`source` 的三个字面值：`"builtin"`（内嵌快照）/ `"cache"`（库里上一次刷新结果）/ `"network"`（本次刚拉到的）（`core/model_meta/snapshot.rs:6-8`）。

- **响应（POST refresh）：** **永远 2xx**，成败由 `result.status` 表达（`model_meta.rs:85-102`）

```jsonc
{
  "result": {
    "provider": "modelsdev",                    // 伪 provider（SCHEDULE_SCOPE）
    "providerLabel": "models.dev 模型库",
    "refreshedAt": 1700000000000,
    "status": "refreshed" | "skipped" | "failed",
    "count": 1234,                              // 仅 status == "refreshed" 时出现
    "message": "<原因>",                        // skipped / failed 时出现
    "retryAt": 1700000000000                    // 仅「冷却中」的 skipped 时出现
  },
  "status": { /* 与 GET /api/models/metadata 完全同形的一份状态 */ }
}
```

结果行逐字片段（`core/model_meta/refresh.rs:56-62`）：

```rust
let mut row = json!({
    "provider": SCHEDULE_SCOPE,          // = "modelsdev"
    "providerLabel": "models.dev 模型库",
    "refreshedAt": snapshot::origin().1,
});
```

`status == "skipped"` 的两个原因：已关闭（`"已在设置里关闭 models.dev 模型元数据"`，`refresh.rs:63-67`）与冷却中（`refresh.rs:78-88`，可能带 `retryAt`）；`"failed"` 时带 `message`（`refresh.rs:90-94`、`refresh.rs:108-112`）；`"refreshed"` 时带 `count` 并刷新 `refreshedAt`（`refresh.rs:103-105`）。

- **手动刷新的间隔约束**：`MANUAL_INTERVAL_MINUTES = 1440`（24 小时），即 `interval_ms = 86_400_000`（`model_meta.rs:35`、`model_meta.rs:91`）。排期键 `"modelRefresh:modelsdev"`（`refresh.rs:48`、`refresh.rs:70`），与各家目录刷新同一命名空间。
- **关掉的语义**：只停**联网刷新**（`refresh` 直接返回 `skipped`，不打网络），已装载的索引继续用（内存 + 库里都不清）（`model_meta.rs:55-56`、`config/types.rs:206-208`）。
- **`modelsDevEnabled` 默认值**：**默认开启**（只有字面 `false` 算关闭，`config/mod.rs:653-657`）。
- **配置键**：`modelsDevEnabled`（`config/types.rs:209`）。
- **前置**：需要管理员（`http.rs:591-598`，注释理由：刷新那条会真打公网）。无形态限定。
- **位置**：`model_meta.rs:35`（间隔常量）/ `model_meta.rs:37-46`（metadata_json）/ `model_meta.rs:49`（GET）/ `model_meta.rs:57`（PUT）/ `model_meta.rs:90`（refresh）/ `core/model_meta/snapshot.rs:130-137`（status）/ `core/model_meta/refresh.rs:55-114`（结果行）

---

## cors.rs — 网关面跨域访问开关

- **路由**：`GET /api/cors`、`PUT /api/cors`（`http.rs:726-729`；handler `cors.rs:32`、`cors.rs:41`）
- **请求（PUT）**：JSON 对象，**必须**含 `corsEnabled`

```jsonc
{ "corsEnabled": true | false }   // 缺失 → 400「缺少 corsEnabled」；非布尔 → 400「corsEnabled 必须是 true 或 false」
```

- **响应（GET / PUT 同形，只有一项）**

```jsonc
{ "corsEnabled": false }          // 默认 false
```

响应体逐字片段（`cors.rs:71-75`）：

```rust
fn cors_json() -> Value {
    json!({
        config::KEY_CORS_ENABLED: config::current().cors_enabled(),
    })
}
```

- **开关作用面**：只影响**网关面 `/v1/*`**。打开后：预检直接 `204`，三个 `Access-Control-Allow-*` 头随每个响应下发（来源 `*`），另加 `access-control-allow-private-network: true`（`http.rs:1163-1168`）。关着时（默认）网关面不碰 CORS —— 预检会被 API Key 中间件 401 拒掉（预检按规范不带 `Authorization`）。
  **面板路由 `/api/*` 不受本开关影响**，保持既有的无条件 CORS（`http.rs:1065`、`config/types.rs:144-145`）。本批其它 6 个模块的端点都在 `/api/*` 下，因此与本开关无关。
- **配置键**：`corsEnabled`（`config/types.rs:146`）。
- **前置**：需要管理员（`http.rs:721-729`）。无形态限定。
- **副作用**：开关**两种**状态都会写一条事件日志（`cors.rs:59-66`），因为是「谁能调本机网关」的安全边界。写盘失败只记日志，仍回 2xx 新状态（`cors.rs:56-58`）。
- **位置**：`cors.rs:32`（GET）/ `cors.rs:41`（PUT）/ `cors.rs:71-75`（响应体）

---

## captcha.rs — 机器人校验（ALTCHA）开关

- **路由**：`GET /api/captcha`、`PUT /api/captcha`（`http.rs:766-769`；handler `captcha.rs:48`、`captcha.rs:54`）
- **请求（PUT）**：JSON 对象，三个键**至少给一个**

```jsonc
{
  "captchaDesktop": true | false | null,   // 可选；null = 不改
  "captchaWeb":     true | false | null,   // 可选；null = 不改
  "captchaEnabled": true | false | null    // 可选；旧键，同时写两端
}
```

规则（`captcha.rs:62-97`）：
- 逐项解析：`null`（或未给）与「没给」同义（部分更新）；给了非布尔值 → `400` `{key} 必须是布尔值`。
- 旧键 `captchaEnabled` 同时写两端：`desktop = desktop.or(legacy)`、`web = web.or(legacy)`（`captcha.rs:90-91`）——**分端键优先于旧键**。
- 两端都没给 → `400`「缺少 captchaDesktop / captchaWeb 字段（旧客户端可用 captchaEnabled 同时设置两端）」。
- 写盘失败 → `500`「写入配置失败，请重试」。

- **响应（GET / PUT 同形）**

```jsonc
{
  "captchaDesktop": true,   // 桌面端（Tauri 壳）开关，默认 true
  "captchaWeb": true,       // 网页端（headless / Docker / 浏览器面板）开关，默认 true
  "localPanel": true        // **只读**，本进程形态：桌面壳 true / headless false
}
```

契约在模块头里逐字写明（`captcha.rs:15-18`）：

```text
{ captchaDesktop: bool, captchaWeb: bool, localPanel: bool }
```

`localPanel` 是**只读**字段，来自 `ServerState.local_panel`，是「本进程」的形态而非可配置项；写侧**不接受**它（传了也不会报错，因为无 `deny_unknown_fields`，只是被忽略）——这一点为**推断**（源码里没有对未知字段的显式拒绝逻辑，也没有对 `localPanel` 的显式忽略分支）。

- **开关作用面**：控制面板登录 / 注册端点的 ALTCHA proof-of-work 校验（`server::altcha`）。开启时登录页必须先领题、浏览器后台算完、随请求提交 payload；关闭时两个端点不再校验（challenge 端点也回 400）。**默认开启**。只影响面板的 login / setup，与 `/v1/*` 的 API Key 鉴权无关（`config/types.rs:173`）。
  两端独立：由 `ServerState.local_panel` 决定登录端点读哪一个（`captcha.rs:9-13`）。
- **配置键**：`captchaDesktop` / `captchaWeb` / `captchaEnabled`（后者为旧版单开关，现在只作为两端的共同默认值：读取时优先看分端键，两者都没有才回落它，`config/types.rs:181-185`）。
  部署级兜底：配置里没有该键时读环境变量 `AGENT2API_CAPTCHA_ENABLED`（优先级「配置里的值 > 环境变量」，`config/types.rs:175-179`）。
- **前置**：需要管理员（`http.rs:763-769`）。两个布尔项本身**不受进程形态限制**——桌面形态也能写 `captchaWeb`，反之亦然；`localPanel` 只是告诉界面「你正在用的这一端」。
- **副作用**：无条件写一条 `[Security]` 日志，含两端最终状态（`captcha.rs:102-109`）。
- **位置**：`captcha.rs:38-45`（响应体）/ `captcha.rs:48`（GET）/ `captcha.rs:52-53`（请求体说明）/ `captcha.rs:54`（PUT）/ `captcha.rs:64-76`（逐项解析）/ `captcha.rs:90-97`（旧键合并与缺字段报错）

---

## sidebar_layout.rs — 侧边栏布局

- **路由**：`GET /api/sidebar-layout`、`PUT /api/sidebar-layout`（`http.rs:464-467`；handler `sidebar_layout.rs:39`、`sidebar_layout.rs:47`）
- **请求（PUT）**：JSON 对象，只有一个键

```jsonc
{ "layout": { /* 任意布局对象 */ } | null }
```

- 缺 `layout` 键与显式 `null` **同义**（都表示「恢复默认」，`sidebar_layout.rs:55`）。
- `layout` 非对象非 null → `400`「layout 必须是 JSON 对象或 null」。
- **后端只判「顶层是不是对象」**，对象内部形状完全不校验（`sidebar_layout.rs:17-21`）：合法形状由前端 `ui/sidebar-layout.js` 的 `MENUS` 表定义，而插件页的菜单键是运行期才有的（`plugin:<pack>:<page>`）。后端抄白名单必然漂移。

- **响应（GET / PUT 同形，回写后重新读一次）**

```jsonc
{ "layout": { /* 存下来的那份原文原样交还 */ } }   // 库里没存过时：{ "layout": null }
```

契约在模块头里逐字写明（`sidebar_layout.rs:10-13`）：

```text
GET  /api/sidebar-layout  → { layout: <布局对象> | null }
PUT  /api/sidebar-layout  → 收 { layout: <布局对象> | null }，回同一份
```

**返回整表还是单项：整份布局整体读写，不拆键。**
`save` 对整键重写（`core/sidebar_layout.rs:56-79`）。`null` → 写入字面量 `"{}"`（写空对象而不是删行，`kv_put` 没有删除口）；`load` 把**空对象也当作「没存过」**，因此回 `{layout: null}` 而不是 `{layout: {}}` —— 契约只有一种说法（`core/sidebar_layout.rs:44-54`）。解析失败（库里那份读不懂）与顶层非对象（数组 / 标量 / null）同样按「没存过」处理，回 `null`。

- **存储位置**：**不在 config JSON**，而在统一库 `kv` 表的固定键 `sidebarLayout`（`core/sidebar_layout.rs:37`，`KV_KEY`）。该键登记在 `db::schema::RESERVED_KV_KEYS`（`core/sidebar_layout.rs:29-30`），也在云同步范围内（`SYNCED_RESERVED_KEYS`），因此写成功会显式通知云同步（`core/sidebar_layout.rs:78`）。
- **前置**：需要管理员（`http.rs:460-467`，注释理由：布局是用户配置，写操作会改两端共用的那一份）。
- **位置**：`sidebar_layout.rs:39`（GET）/ `sidebar_layout.rs:43-46`（PUT 说明）/ `sidebar_layout.rs:47`（PUT）/ `sidebar_layout.rs:56-62`（layout 字段解析）/ `core/sidebar_layout.rs:37`（KV_KEY）/ `core/sidebar_layout.rs:48-54`（load）/ `core/sidebar_layout.rs:61-80`（save）

---

## 汇总表

| 端点 | 方法 | 配置键（字面） | 请求字段 | 响应字段 | 写语义 | 前置 | 位置 |
|---|---|---|---|---|---|---|---|
| `/api/prompt` | GET | — | — | `promptMode`, `promptFile`, `promptText`, `promptSource`, `promptFileError`, `promptLines`, `degradeActive`, `degradeUntil`, `degradeUntilText`, `promptProviders`, `promptGateway`, `promptGatewayText`, `promptProviderOptions` | — | 管理员 | `prompt.rs:57` |
| `/api/prompt` | PUT | `promptMode` / `promptFile` / `promptText` / `promptProviders` / `promptGateway` / `promptGatewayText` | `promptMode`, `promptFile`, `promptText`, `promptProviders`, `promptGateway`, `promptGatewayText`, `clearDegrade` | 同 GET | 逐家逐项部分更新；map 值 `null` = 删项 | 管理员 | `prompt.rs:71` |
| `/api/sanitize` | GET | — | — | `sanitizeBlacklistFingerprints`, `sanitizeFingerprintRules`, `sanitizeFingerprintProviders`, `defaultRules`, `customRules`, `providerOptions`, `roleOptions`, `limits{maxRules,maxNameChars,maxPatternChars,maxReplacementChars}` | — | 管理员 | `sanitize.rs:21` |
| `/api/sanitize` | PUT | `sanitizeBlacklistFingerprints` / `sanitizeFingerprintRules` / `sanitizeFingerprintProviders` | `sanitizeBlacklistFingerprints`, `sanitizeFingerprintRules`, `sanitizeFingerprintProviders` | 同 GET + `saved` | **词表整表替换**；`rules:null`=回内置、`[]`=空词表；`providers:null`=全部 | 管理员 | `sanitize.rs:25` |
| `/api/client-identification` | GET | — | — | `config{acceptDeclarations,clients[],rules[]}`, `revision`, `builtins[]`, `headers[]`, `declarationHeader`, `maxRules`, `maxClients` | — | 管理员 | `client_identification.rs:30` |
| `/api/client-identification` | PUT | `clientIdentification` | `config`, `revision` | 同 GET | **整份 config 替换** + `revision` 乐观锁（不符 → 409） | 管理员 | `client_identification.rs:39` |
| `/api/client-identification/preview` | POST | — | `config`, `ruleId?`, `sample?` | `scanned`, `matched`, `applied`, `window`, `samples[]`, `sample` | 只试算，不写盘 | 管理员 | `client_identification.rs:112` |
| `/api/models/metadata` | GET | — | — | `source`, `updatedAt`, `count`, `modelsDevEnabled` | — | 管理员 | `model_meta.rs:49` |
| `/api/models/metadata` | PUT | `modelsDevEnabled` | `modelsDevEnabled` | 同 GET | 单布尔写入 | 管理员 | `model_meta.rs:57` |
| `/api/models/metadata/refresh` | POST | — | 无 | `result{provider,providerLabel,refreshedAt,status,count?,message?,retryAt?}`, `status{…}` | 手动刷新（间隔 1440 分钟） | 管理员 | `model_meta.rs:90` |
| `/api/cors` | GET | — | — | `corsEnabled` | — | 管理员 | `cors.rs:32` |
| `/api/cors` | PUT | `corsEnabled` | `corsEnabled` | `corsEnabled` | 单布尔写入 | 管理员 | `cors.rs:41` |
| `/api/captcha` | GET | — | — | `captchaDesktop`, `captchaWeb`, `localPanel` | — | 管理员 | `captcha.rs:48` |
| `/api/captcha` | PUT | `captchaDesktop` / `captchaWeb` / `captchaEnabled` | `captchaDesktop?`, `captchaWeb?`, `captchaEnabled?` | 同 GET | 分端部分更新；旧键同时写两端 | 管理员 | `captcha.rs:54` |
| `/api/sidebar-layout` | GET | （`kv` 键 `sidebarLayout`） | — | `layout` | — | 管理员 | `sidebar_layout.rs:39` |
| `/api/sidebar-layout` | PUT | （`kv` 键 `sidebarLayout`） | `layout` | `layout` | **整份布局替换**；`null`/缺键 = 恢复默认 | 管理员 | `sidebar_layout.rs:47` |

端点合计：**16 条**（GET 7 / PUT 7 / POST 2）。

---

## 附：本批未确认项

以下项在下载到的源码里**没有**直接证据，按 `(未确认)` 处理，不臆造：

1. **`promptProviderOptions[].gatewayBlocks` 的字段级契约**：网关侧只是把插件 `prompt.info` 返回的 `gatewayBlocks` 原样转发（`prompt.rs:608`），不在网关侧校验形状。其 `{identity, stable, dynamic}` 三段结构来自 `PLUGIN_SETTING_GATEWAY_PROMPT_TEXT` 的说明（`config/types.rs:304`），**插件实际返回的字段集 `(未确认)`**。
2. **`promptProviderOptions[].gatewayChars` 的具体数值**：由插件给出，本批未取到 ZCode 插件源码，各家的实际字符数 `(未确认)`。
3. **`/api/prompt` PUT 对未知顶层字段是否应报错**：源码里没有 `deny_unknown_fields`，未知键被静默忽略——「静默忽略」是读代码得出的行为，源码没有把这一条写成显式契约 `(未确认)`。
4. **`/api/captcha` PUT 传 `localPanel` 时的行为**：源码无显式分支，行为上是忽略（无 `deny_unknown_fields`）——属于推断 `(未确认)`。
5. **`builtins[].products` 的匹配优先级与多命中裁决**：`catalog::declared_client`（`catalog.rs:83-93`）按 `id` / `name` / `value` / `products` 逐个大小写不敏感比较，但多客户端同时命中时的取舍规则需要读 `core/client/matcher.rs` 的 `identify` 才能定论，本批只确认了匹配入口 `(未确认)`。
6. **`ClientEvidence.declarationStatus` / `candidate` 的取值枚举**：结构体只声明为 `String`（`evidence.rs:36-38`），字面取值集 `(未确认)`。
