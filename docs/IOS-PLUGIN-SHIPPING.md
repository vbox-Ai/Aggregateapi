# iOS 插件随 deb 一起发（不依赖商店下载）

> 背景：面板「网关插件 → 下载并安装 / 补齐插件」走的是
> GitHub Release 下载 + ed25519 官方验签。自建包没有官方私钥，
> 国内网络又只能走加速镜像（镜像通道**强制验签**），所以点下载必然报
> 「加速下载的插件未通过官方签名校验」。这条链路不适合自建包。

## 1. 现在的做法：插件预置进 deb

```
CI: plugins 作业
   ├─ 编 agent2api-providers / agent2api-web-providers（aarch64-apple-ios）
   ├─ ldid -S plugin-entitlements.plist
   ├─ pack-ios-plugins.sh：拿官方 zip 当骨架，换掉入口二进制、删 signature、
   │                        entry 写成 aarch64-unknown-linux-gnu（iOS 上网关
   │                        target_triple() 就是它）
   └─ 上传 out/packs/*.zip

CI: ios 作业
   ├─ 取回 out/packs，stage-plugin-packs.py 摊成
   │     out/stage-packs/{id}/{version}/...  +  plugins.json
   └─ build-allinone-deb.sh --packs out/stage-packs --arch both
         └─ deb 里带上 /usr/local/share/agent2api/packs/
            postinst 把它们拷进网关的 $DATA/plugins/ 并写注册表
```

网关的插件目录布局与注册表：

```
{DATA}/plugins/
  plugins.json                 ← PackRegistry（"装了哪些包"的唯一来源）
  agent2api-providers/3.4.4/   ← 版本目录（pack.json + 入口二进制 + ui/）
```

`DATA = $AGENT2API_PROXY_HOME`（launchd plist 里是
`/var/jb/usr/local/var/agent2api`，rootful 版打包时会把 `/var/jb` 去掉）。

装上之后面板显示「已启用 / 未签名」，但**能加载**——签名只影响
"是否允许自动覆盖"，不影响加载。

## 2. 版本下限是硬门槛（最容易踩）

`plugin_host/compatibility.rs`：

```rust
const OFFICIAL_PACKS: &[&str] = &["agent2api-providers", "agent2api-web-providers"];
fn minimum_version(id: &str) -> Option<&'static str> {
    OFFICIAL_PACKS.contains(&id).then_some(CURRENT_VERSION)   // env!("CARGO_PKG_VERSION")
}
```

即 **插件包版本必须 ≥ 网关自身编译版本**，否则
`list_packs` 标 `update_required`（面板「需要补齐插件」），
`packages::prepare` 直接拒绝安装，provider 一家都起不来。

所以 CI 里加了一步 `scripts/align-plugin-version.py`：
用上游最新 `v*` tag 当下限，插件清单低于它就自动抬到下限
（plugins / ios / release 三个作业跑同一规则，保证 tag 与资产名一致）。

## 3. 商店通道的被改点（补丁 0004）

`agent2api-universal/patches/0004-plugin-store-own-repo-unsigned.diff`：

| 位置 | 上游行为 | 本构建 |
|---|---|---|
| `update.rs` 索引解析 | `require_signed = !response.official`（域名判定） | 读索引/清单里的 `require_signed` 字段，缺省 false |
| `update.rs` release 解析 | stable 通道走 `/releases/latest` | 一律列全量 release，按 tag 模板挑最新（否则 latest 被 `ios-*` 快照占住 → "暂无插件包"） |
| `update.rs` 下载 | 镜像通道无条件验签 | 只在 `asset.require_signed` 时验签 |
| `compatibility.rs` | 索引里 `official != true` 直接拒绝补齐 | 只记日志，继续补齐 |
| `operations/policy.rs` | 自动/补齐路径 `signed() = true` | 放行（自建包无官方私钥） |

## 4. 排障顺序

1. 面板「已加载 0 家」→ 先看版本：`plugins.json` 里 version ≥ 网关版本？
2. 「当前网关平台暂无插件包」→ 看 release：`v{version}` 这个 tag 在不在、
   资产名是不是 `{id}-{version}-aarch64-unknown-linux-gnu.zip`、
   `make_latest` 有没有被 `ios-*` 快照抢走。
3. 「加速下载的插件未通过官方签名校验」→ 本质是自建包没签名又走了镜像；
   要么用 0004 补丁，要么改用 deb 预置。
4. 入口 ENOENT / 起不来 → 看 `packs` 里 entry 指向的文件在不在、
   是否 `chmod 755`、`ldid -S` 有没有做。
