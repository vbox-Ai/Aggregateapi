# patches-3.5.0-beta.7 —— 上游 beta.7 的可用补丁子集

⚠️ 本目录**不是** `build.yml` 现在读的目录（现在读的是 `agent2api-universal/patches/`）。
里面的补丁是照 **`v3.5.0-beta.1`** 写的，在 beta.7 上只有 9/28 可应用。
本目录是移植进度的一部分，先单独放，避免影响现有流水线。

完整分诊见 `docs/PORTING-3.5.0-beta.7.md`；原生后端见 `NATIVE-BACKEND.md`；iOS 下载/加载全链路见 `PLUGIN-IOS.md`；自建目录见 `PLUGIN-SELFHOST.md`。

## 内容

| 文件 | 来源 | 验证 |
|---|---|---|
| `0029-native-pack-backend.diff` | 新写。恢复原生提供商插件包后端（默认关闭，env 放行） | 在干净 beta.7 树上 7/7 文件可应用；入口解析三处已覆盖 |
| `0030-self-hosted-catalog.diff` | 新写。自建插件目录（目录源可配、原生平台放行、签名策略可关），须在 0029 之后应用 | 在干净 beta.7 上按 0029→0030 顺序 4/4 文件可应用 | 按 beta.7 的 `script/distribution.rs` 手写重写 | 在干净 beta.7 树上可应用 |
| `0021-remote-outbound-channel.diff` | 3 路合并忠实 rebase（只做原补丁的增删） | 在干净 beta.7 树上可应用 |

## 怎么用

```bash
git -C Agent2API checkout v3.5.0-beta.7
for p in agent2api-universal/patches-3.5.0-beta.7/*.diff; do
  git -C Agent2API apply --3way "$(pwd)/$p"
done
```

`0029` 必须先打；`0030` 只能打在 `0029` 之上（它改的是 0029 之后的 `support`/`catalog` 附近代码）。其余补丁互相独立。

## 独立形态要设的两个环境变量

```bash
AGENT2API_ALLOW_NATIVE_PACKS=1   # 网关侧放行原生包
AGENT2API_ALLOW_EXEC=1           # spawn 前二次放行（沿用既有 iOS 约定）
```

不设则完全等同上游行为（只认 WASM）。

## 未纳入

| 补丁 | 原因 |
|---|---|
| `0011-script-remote-host-start` | 忠实 rebase，原本依赖 `0001` 的闸门；`0029` 已含等价闸门，可在 `0029` 之后单独启用 |
| `0001` | 作用已被 `0029` 的 `AGENT2API_ALLOW_EXEC` 闸门覆盖，不再单独移植 |
| `0002` `0005` `0008` `0010` | 自动合并会额外删除 5–44 行上游代码（merge 边界问题），需人工裁决后再入 |
| `0012` `0016` `0017` `0025` `0026` | 已被上游取代（官网 CDN 源 + 回退链 / 目录网络层删除），不再需要 |
| 其余 | 见分诊表 2.3「需重写」 |

## 判据

补丁交付只认两条：**能应用** + **只做原补丁的增删**。
自动 rebase 出来的补丁若删掉了上游原有代码（哪怕能编译），一律不进本目录。
编译与真机均 `NOT RUN`（构建机无 Rust 工具链、手机不在本机可达范围）。
