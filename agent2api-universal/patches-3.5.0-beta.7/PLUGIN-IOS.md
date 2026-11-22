# 插件板块：iOS 独立形态的「下载 → 加载」全链路

对象：网关跑在手机上的独立形态（iOS `EMBED=1` / LaunchDaemon）。
前置补丁：`0029-native-pack-backend.diff`；本文说明这条链路上每一段的断点与处理办法。

## 1 四段链路，断在哪

| 段 | 代码位置 | 上游（beta.7）行为 | iOS 独立形态的现状 |
|---|---|---|---|
| ① 目录 | `plugin_host/catalog.rs`、`core/update/website.rs` | 只认官网 CDN 目录（`cdn.agent2api.dev/.../community/catalog.json`），资产只列 `wasm32-unknown-unknown` | **目录里没有 iOS 资产** → 面板显示「当前通道暂无可安装的版本」 |
| ② 取包 | `operations.rs:217/227`、`update.rs::validate_release_urls` | 只允许 wasm 目标的资产；`require_signed: true` 硬编码；URL 必须是官网/受信仓库 | 自建源与未签名包都会被拒 |
| ③ 安装 | `packages.rs::prepare`、`packages/provenance.rs` | `entry_for_target()` **恒取 wasm 键**（`install.rs:441` 参数 `_target`） | 原生包报「插件包没有为当前平台提供入口」 |
| ④ 加载 | `support.rs`（`LEGACY_REASON`）、`lifecycle.rs:99` | 非 wasm 一律拒绝；宿主只跑 wasm 或脚本 | 报「旧原生提供商插件已停止支持」 |

`0029` 修的是 **③ + ④**（含 `packages.rs`、`packages/provenance.rs`、`support.rs`、`lifecycle.rs`、
`bootstrap.rs`、`rpc.rs`、`catalog.rs` 的目录形状）。① ② 属于「下载」，要另一条路。

## 2 路线 A：Sideload（现在就能用，零额外补丁）

前提：网关侧设两个环境变量，然后重启。

```
AGENT2API_ALLOW_NATIVE_PACKS=1     # ③ ④ 两段放行
AGENT2API_ALLOW_EXEC=1             # 真正 spawn 插件二进制前的二次放行
```

步骤：

```bash
# 1) 出包（沿用现有脚本；entry 键必须写 aarch64-unknown-linux-gnu）
bash scripts/pack-ios-plugins.sh --official <官方骨架.zip> \
  --binary out/plugins/agent2api-providers \
  --id agent2api-providers --version 3.5.0-beta.7 --out out/packs

# 2) 传到手机
scp out/packs/agent2api-providers-3.5.0-beta.7-aarch64-unknown-linux-gnu.zip \
    root@<手机IP>:/var/mobile/Documents/

# 3) 先预览：确认包被接受、入口解析正确
curl -sS "http://127.0.0.1:3065/api/plugins/install?preview=true&expected_id=agent2api-providers" \
  -H "Authorization: Bearer <面板管理员 Key>" \
  -H 'content-type: application/octet-stream' \
  --data-binary @/var/mobile/Documents/agent2api-providers-3.5.0-beta.7-aarch64-unknown-linux-gnu.zip

# 4) 正式安装（同一个接口，去掉 preview）
curl -sS "http://127.0.0.1:3065/api/plugins/install?expected_id=agent2api-providers" \
  -H "Authorization: Bearer <面板管理员 Key>" \
  -H 'content-type: application/octet-stream' \
  --data-binary @/var/mobile/Documents/agent2api-providers-3.5.0-beta.7-aarch64-unknown-linux-gnu.zip
```

为什么这条路不需要签名：`api/plugins.rs::install` 调的是
`prepare_pack(&bytes, id, version, /* require_signed = */ false)`，本地导入本来就免签名。
前提是 `③` 的入口解析要能认出原生包 —— 这正是 `0029` 补的那两处（`packages.rs` / `provenance.rs`）。

面板里等价操作：插件页 →「导入插件包」→ 选 zip。预览（`preview=true`）会回
`{id,name,version,signed,sha256,previousVersion,enabled,providers}`，先看 `id` 与 `version` 对不对再装。

## 3 路线 B：手机自己从自有目录下载（需要 `0030`，尚未写）

官网目录永远不会给 iOS 发资产，所以「从官网目录点安装」对 iOS 无解。要自己下，需要四处改造：

| # | 位置 | 改法 |
|---|---|---|
| 1 | `website.rs::PLUGIN_BASE` / `CDN_*`、`update.rs::INDEX_SOURCE` | 增加 `AGENT2API_PLUGIN_CATALOG_URL` 覆盖，或在 `convert()` 白名单加入自有域名 |
| 2 | `operations.rs:217` `platform["target"] != wasm TARGET → LEGACY_REASON` | 放行 `host_target()`（`AGENT2API_ALLOW_NATIVE_PACKS=1` 时） |
| 3 | `operations.rs:227`、`catalog.rs:280/320/338` `require_signed: true` | 加 `AGENT2API_ALLOW_UNSIGNED_PLUGINS=1` 时置 false |
| 4 | `update.rs::validate_release_urls` | 放行自有 GitHub 仓库/域名 |

自有目录 JSON 的形状（与官网聚合一致，`platforms` 用对象数组）：

```json
{
  "plugins": [{
    "id": "agent2api-providers",
    "version": "3.5.0-beta.7",
    "protocol": 9,
    "platforms": [{
      "target": "aarch64-unknown-linux-gnu",
      "url": "https://github.com/vbox-Ai/Aggregateapi/releases/download/.../agent2api-providers-3.5.0-beta.7-aarch64-unknown-linux-gnu.zip",
      "size": 12345678,
      "sha256": "…"
    }]
  }]
}
```

注：`target` 写 `aarch64-unknown-linux-gnu`，因为 `host_target()` 在 iOS 上就是回落到这个值
（`rpc.rs:131` 的 `_` 分支）。

## 4 排错对照表

| 现象 | 原因 | 处理 |
|---|---|---|
| 「旧原生提供商插件已停止支持…」 | 没设 `AGENT2API_ALLOW_NATIVE_PACKS=1` | 加上，重启网关 |
| 「原生插件执行未放行：请设置 AGENT2API_ALLOW_EXEC=1」 | 只设了前者 | 两个都设 |
| 「插件包没有为当前平台（aarch64-unknown-linux-gnu）提供入口」 | `pack.json` 的 `entry` 没有该键，或补丁未打全 | 用 `pack-ios-plugins.sh` 重出包；确认 `0029` 全 7 文件都打上 |
| 「这个插件包要求协议版本 X，而当前网关是 Y」 | 插件包是旧协议编的 | 用 beta.7 的 `agent2api-provider-protocol` 重编插件包 |
| 「插件包完整性复核失败」 | 包被改过、签名与内容不符 | 重新出包；或走本地导入（免签名） |
| `/api/plugins` 里 `supported=false` | `support_state` 仍是 LegacyUnsupported | 看 `reason` 字段；多为 ③ 的入口解析未命中 |
| 装了但 `startup.phase` 停在 `starting` | 子进程起不来（架构不对/权限不足） | `AGENT2API_VERBOSE=1` 看 `{PROXY_HOME}/logs/server.log`；确认二进制是 `aarch64-apple-ios` |

## 5 建议的落地顺序

1. 打 `0029` + 设两个环境变量 → **先走路线 A 把「装上能跑」验证通**（这一步不依赖任何网络改造）。
2. 通了之后再写 `0030`，把「下载」这段补上，手机才能自己从你们的 Releases 更新插件。
3. 脚本插件（JS）另算：iOS 上没有 Bun，需要 `0008~0023` 那套远端宿主桥，属于 P1。

## 6 验证状态

| 判据 | 状态 |
|---|---|
| `0029` 在干净 `v3.5.0-beta.7` 上 7/7 文件可应用 | Observed |
| 入口解析三处（`packages.rs` / `provenance.rs` / `bootstrap.rs`）均已改到 | Observed |
| 编译 | `NOT RUN`（本机无 Rust 工具链） |
| 路线 A 真机（装 → 起 → 打一次模型请求） | `NOT RUN` |
