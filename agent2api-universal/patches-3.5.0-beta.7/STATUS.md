# patches-3.5.0-beta.7 —— 上游 beta.7 的可用补丁子集

⚠️ 本目录**不是** `build.yml` 现在读的目录（现在读的是 `agent2api-universal/patches/`）。
里面的补丁是照 **`v3.5.0-beta.1`** 写的，在 beta.7 上只有 9/28 可应用。
本目录是移植进度的一部分，先单独放，避免影响现有流水线。

完整分诊见 `docs/PORTING-3.5.0-beta.7.md`。

## 内容

| 文件 | 来源 | 验证 |
|---|---|---|
| `0013-index-cache.diff` | 按 beta.7 的 `script/distribution.rs` 手写重写 | 在干净 beta.7 树上可应用 |
| `0021-remote-outbound-channel.diff` | 3 路合并忠实 rebase（只做原补丁的增删） | 在干净 beta.7 树上可应用 |

## 怎么用

```bash
git -C Agent2API checkout v3.5.0-beta.7
for p in agent2api-universal/patches-3.5.0-beta.7/*.diff; do
  git -C Agent2API apply --3way "$(pwd)/$p"
done
```

两条补丁互相独立，顺序无关。若日后要整体替换 `patches/`，必须等
`docs/PORTING-3.5.0-beta.7.md` 第 2.3 节的 20 条补丁全部重写完，否则 iOS 腿会产出功能残缺的包。

## 未纳入

| 补丁 | 原因 |
|---|---|
| `0011-script-remote-host-start` | 忠实 rebase，但依赖 `0001` 在 `lifecycle.rs` 里的闸门；`0001` 尚未重写 |
| `0001` `0002` `0005` `0008` `0010` | 自动合并会额外删除 5–44 行上游代码（merge 边界问题），需人工裁决后再入 |
| `0012` `0016` `0017` `0025` `0026` | 已被上游取代（官网 CDN 源 + 回退链 / 目录网络层删除），不再需要 |
| 其余 | 见分诊表 2.3「需重写」 |

## 判据

补丁交付只认两条：**能应用** + **只做原补丁的增删**。
自动 rebase 出来的补丁若删掉了上游原有代码（哪怕能编译），一律不进本目录。