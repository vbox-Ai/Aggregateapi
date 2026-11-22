# 自建插件目录（S-B）：手机自己从自有源下载并安装

前置：`0029-native-pack-backend.diff`（加载 + 安装段入口解析）。
本补丁 `0030-self-hosted-catalog.diff` 补的是「下载」这段：目录源可配、原生平台放行、签名策略可关。

## 1 四个环境变量

| 变量 | 作用 | 必须 |
|---|---|---|
| `AGENT2API_ALLOW_NATIVE_PACKS=1` | 网关放行原生插件包（0029） | ✅ |
| `AGENT2API_ALLOW_EXEC=1` | spawn 插件二进制前放行（0029） | ✅ |
| `AGENT2API_PLUGIN_CATALOG_URL` | 自建目录 JSON 的完整地址（0030） | ✅ |
| `AGENT2API_PLUGIN_ASSET_ORIGINS` | 资产与目录**不同源**时，列出资产 origin（逗号分隔） | 视情况 |
| `AGENT2API_ALLOW_UNSIGNED_PLUGINS=1` | 允许未签名包（**仅**设了目录地址时生效） | 视情况 |

```xml
<!-- /var/jb/Library/LaunchDaemons/com.chiyu.agent2api.plist -->
<key>AGENT2API_ALLOW_NATIVE_PACKS</key><string>1</string>
<key>AGENT2API_ALLOW_EXEC</key><string>1</string>
<key>AGENT2API_PLUGIN_CATALOG_URL</key><string>https://raw.githubusercontent.com/vbox-Ai/Aggregateapi/main/catalog.json</string>
<key>AGENT2API_PLUGIN_ASSET_ORIGINS</key><string>https://github.com</string>
<key>AGENT2API_ALLOW_UNSIGNED_PLUGINS</key><string>1</string>
```

不设 `AGENT2API_PLUGIN_CATALOG_URL` → 完全回到官网通道，签名策略也不放松（`allow_unsigned_plugins()` 恒 false）。

## 2 生成目录

```bash
python3 scripts/gen-plugin-catalog.py \
  --packs out/packs \
  --base-url https://github.com/vbox-Ai/Aggregateapi/releases/download/ios-20261123-b12 \
  --repo vbox-Ai/Aggregateapi \
  --protocol 9 \
  --out catalog.json
```

- 输入是 `<id>-<version>-<target>.zip`，`pack-ios-plugins.sh` 的产物天然符合。
- 每个 id 只保留版本最大的那一条，多 target 会合并进同一个 release 的 `assets`。
- `--protocol` 必须等于网关的 `PROTOCOL_VERSION`（对不上会被 `validate_manifest` 拒）。
- 生成器会算 `sha256` 写进 `digest`，网关安装时会核对。

输出形状（网关解析器就是按这个读的）：

```json
{ "schema": 1, "plugins": [{
  "id": "agent2api-providers",
  "detail": { "protocol": 9, "release": { "repo": "...", "tag": "v{version}", "asset": "{id}-{version}-{target}.zip" } },
  "release": {
    "tag_name": "v3.5.0-beta.7",
    "prerelease": true,
    "assets": [{ "name": "agent2api-providers-3.5.0-beta.7-aarch64-unknown-linux-gnu.zip",
                 "size": 12345678,
                 "browser_download_url": "https://.../…zip",
                 "digest": "sha256:…" }]
  }
}]}
```

`target` 必须是 `aarch64-unknown-linux-gnu`：`host_target()` 在 iOS 上走 `rpc.rs:131` 的 `_` 分支就吐出这个值，
与 `pack-ios-plugins.sh` 写 `entry` 键的做法一致。

## 3 0030 改了哪四处

| 文件 | 改动 |
|---|---|
| `core/update/website.rs` | 新增 `custom_catalog_url()` / `custom_source_allowed()` / `allow_unsigned_plugins()`；`request()` 与跳转校验放行自建源；`plugin_url()` 对自建源改成「末节文件名精确匹配」 |
| `core/plugin_host/update.rs` | `pick_release_assets()` 的 target 过滤增加「原生目标」（`native_allowed() && target == host_target()`） |
| `core/plugin_host/catalog.rs` | `fetch_catalog()` 优先取自建目录；`require_signed` 由 `signed_policy` 统一（4 处）；自动更新的资产挑选也认原生 target |
| `core/plugin_host/operations.rs` | 目录安装的平台闸门放行原生 target；资产 `require_signed` 跟随策略 |

## 4 网关侧操作

1. **设置 → 更新通道**：勾上 **beta**。目录里 `prerelease: true`（`3.5.0-beta.7` 这种版本号本身也会被判预发布），
   不勾 beta 会被 `channels.accepts()` 过滤掉，表现为「当前通道暂无可安装的版本」。
2. 插件页 → **检查更新** → 应看到版本号与「安装」按钮。
3. 安装后看 `/api/plugins`：`supportState=supported`、`enabled=true`。

## 5 校验命令

```bash
# 目录本身可达、schema 正确
curl -sS "$AGENT2API_PLUGIN_CATALOG_URL" | jq '.schema, (.plugins|length)'

# 网关是否认这条目录（看 version / platforms[].target）
curl -sS http://127.0.0.1:3065/api/plugins | jq '.data.plugins[] | {id,version,platforms:[.platforms[].target]}'

# 已安装包的支持状态
curl -sS http://127.0.0.1:3065/api/plugins | jq '.data.plugins[] | {id,supported,reason}'
```

## 6 CI 接法（Aggregateapi 的 ios 腿末尾）

```yaml
- name: 生成自建插件目录
  run: |
    python3 scripts/gen-plugin-catalog.py \
      --packs out/stage-packs \
      --base-url "${{ github.server_url }}/${{ github.repository }}/releases/download/ios-${{ ... }}" \
      --repo "${{ github.repository }}" \
      --protocol 9 \
      --out catalog.json
```

把 `catalog.json` 一起放进 Release 资产、或提交到仓库根（走 raw 地址）。手机侧只需 `AGENT2API_PLUGIN_CATALOG_URL`
指向它即可，不需要重启后重新配。

## 7 安全边界

- 只有设了 `AGENT2API_PLUGIN_CATALOG_URL` 才进入自建模式；官网通道行为不变。
- 目录 origin 自动放行；**资产 origin 必须显式列**在 `AGENT2API_PLUGIN_ASSET_ORIGINS`，不列就仍被拒。
- 免签名必须显式 `AGENT2API_ALLOW_UNSIGNED_PLUGINS=1`，且只在自建模式下有效。
- 目录里的 `sha256` 会被核对；对不上安装失败。

## 8 验证状态

| 判据 | 状态 |
|---|---|
| `0029` → `0030` 顺序应用在干净 `v3.5.0-beta.7` 上 | Observed（0029: 7/7 文件、0030: 4/4 文件） |
| 关键标记（`custom_source_allowed` / `signed_policy` / `native_target` / `platform_target`） | Observed |
| 生成器：假包 → catalog.json（2 个 id、digest、target 解析） | Observed |
| 编译 | `NOT RUN` |
| 真机：检查更新 → 安装 → 握手 | `NOT RUN` |