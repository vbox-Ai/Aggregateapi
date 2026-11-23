# patches-3.5.0-beta.7 —— 上游 beta.7 的可用补丁子集

⚠️ 本目录**不是** `build.yml` 现在读的目录（现在读的是 `agent2api-universal/patches/`）。
里面的补丁是照 **`v3.5.0-beta.1`** 写的，在 beta.7 上只有 9/28 可应用。
本目录是移植进度的一部分，先单独放，避免影响现有流水线。

文档索引：
- 完整分诊：`docs/PORTING-3.5.0-beta.7.md`
- 原生后端（加载/安装）：`NATIVE-BACKEND.md`
- iOS 下载→加载全链路：`PLUGIN-IOS.md`
- 自建目录（下载）：`PLUGIN-SELFHOST.md`

## 内容

| 文件 | 来源 | 验证 |
|---|---|---|
| `0029-native-pack-backend.diff` | 新写。恢复原生提供商插件包后端（默认关闭，env 放行） | 干净 beta.7 上 7/7 文件可应用 |
| `0030-self-hosted-catalog.diff` | 新写。自建插件目录（目录源可配、原生平台放行、签名策略可关），**须在 0029 之后** | 干净 beta.7 上按 0029→0030 顺序 4/4 可应用 |
| `0031-ios-target-build-fixes.diff` | 新写。修上游 `aarch64-apple-ios` 目标的编译失败（E0282） | 打上后 iOS target `cargo check` 通过 |
| `0013-index-cache.diff` | 按 beta.7 的 `script/distribution.rs` 手写重写 | 已纳入编译门（与 0029/0030/0031 同批跑） |
| `review_only/0021-remote-outbound-channel.WIP.diff` | 自动 rebase **不可用**：重复贴了整段 `Host` 结构体与 `write_for_run`，`mod.rs` 花括号净 +4 | 隔离，需人工重写后再入 |

## 怎么用

```bash
git -C Agent2API checkout v3.5.0-beta.7
for p in agent2api-universal/patches-3.5.0-beta.7/00{29,30,31}-*.diff; do
  git -C Agent2API apply --3way "$(pwd)/$p"
done
```

顺序：`0013` → `0029` → `0030` → `0031`。`0029`/`0030` 有依赖关系，`0013`/`0031` 独立。

## 编译状态（CI 实测）

`compile-check` 工作流（`.github/workflows/compile-check.yml`）在 `porting/3.5.0-beta.7` 分支上跑，
每次改动本目录自动触发：

| 门 | 未打补丁（基线） | 打上 0029+0030+0031 |
|---|---|---|
| `cargo check -p agent2api-server`（x86_64-linux） | exit 0 | **exit 0**（36.99s 增量） |
| `cargo check -p agent2api-server --target aarch64-apple-ios`（macos-15） | **E0282 编不过**（上游 bug） | **exit 0**（58.08s） |

- iOS 那条基线失败是上游问题：`wasm/qoder_umid/discovery.rs:4` 的 `let mut roots = Vec::new()`，
  在 `target_os = "ios"` 时 windows/macos/linux 三个 `cfg` 分支全不成立，推不出元素类型。`0031` 显式标注 `Vec<PathBuf>`。
- iOS 的 check 必须跑在 macOS runner 上：Linux 没有 `xcrun`，`cc-rs` 会在编 C 依赖时直接失败。

## 独立形态要设的环境变量

```bash
AGENT2API_ALLOW_NATIVE_PACKS=1                              # 网关放行原生包
AGENT2API_ALLOW_EXEC=1                                      # spawn 前二次放行
AGENT2API_PLUGIN_CATALOG_URL=https://…/catalog.json         # 自建目录（路线 B）
AGENT2API_PLUGIN_ASSET_ORIGINS=https://github.com           # 资产与目录不同源时必填
AGENT2API_ALLOW_UNSIGNED_PLUGINS=1                          # 未签名包（仅在设了目录地址时生效）
```

不设 `AGENT2API_PLUGIN_CATALOG_URL` 时，行为与签名策略完全等同上游。

## 未纳入

| 补丁 | 原因 |
|---|---|
| `0011-script-remote-host-start` | 忠实 rebase，依赖 `0001` 的闸门；`0029` 已含等价闸门，可在 `0029` 之后单独启用 |
| `0001` | 作用已被 `0029` 的 `AGENT2API_ALLOW_EXEC` 闸门覆盖 |
| `0002` `0005` `0008` `0010` | 自动合并会额外删除 5–44 行上游代码，需人工裁决 |
| `0012` `0016` `0017` `0025` `0026` | 已被上游取代（官网 CDN 源 / 目录网络层删除） |
| 其余 | 见分诊表 2.3「需重写」 |

## 判据

补丁交付只认三条：**能应用** + **只做原补丁的增删** + **两个 target 都编得过**。
自动 rebase 出来的补丁若删掉上游原有代码（哪怕能编译），一律不进本目录。
真机（装 → 起 → 打一次模型请求）仍为 `NOT RUN`。
