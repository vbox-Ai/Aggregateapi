# 「App 内点下载 → 用我们自己的仓库发插件」可行性分析

> 需求：打开 App → 进「网关插件」→ 点下载 → 装上就能用；下载源改成**我们自己的仓库**，后期加/修提供商**不用重装 App**；不要自动回退，出错直接打日志。
> 本文只给结论与分析，不含代码改动。

---

## 0. 结论

**可行，而且几乎完全符合你要的形态。** 关键结论三条：

1. 插件的「索引 → 下载 → 安装」是**纯数据驱动**的：网关只读一个 `index.json`，再加一条"每包各自的 release 仓库"，就能决定去哪儿下载。**把索引仓库改成我们的，后期所有更新都是发 release，不用碰 App。**
2. iOS 上网关自认的平台键是 `aarch64-unknown-linux-gnu`（源码兜底分支决定的），所以我们只要把资产命名成 `{包id}-{版本}-aarch64-unknown-linux-gnu.zip`，里面放 **iOS 的 Mach-O**，它就会选中并原生跑起来 —— 不需要它认识 "ios"。
3. **但有一次性的架构切换**：App 现在这个包是「网关跑在 App 进程内（EMBED=1）」，App 沙盒禁止 exec 子进程，所以插件永远起不来。要变成「App 只当界面 + 后台 daemon 跑网关」，这一步需要重装一次 App（换成 EMBED=0 的客户端版）。**之后插件怎么加、怎么修，都不再动 App。**

| 事项 | 一次性 | 之后每次更新 |
|---|---|---|
| 换 App（EMBED=1 → EMBED=0 客户端） | ✅ 一次 | ❌ 不用 |
| 换 daemon（索引地址指向我们仓库 + 关回退） | ✅ 一次 | ❌ 不用 |
| 发插件新版本 | — | ✅ 只往我们仓库推 release |

---

## 1. 源码证据：下载链路到底长什么样

`plugin_host/update.rs`：

```rust
pub const INDEX_REPO: &str   = "Agent2plugin/Agent2plugin";              // 索引仓库（常量）
pub const FALLBACK_REPO: &str = "Agent2Builder/agent2api-providers-releases";
const GITHUB_API: &str        = "https://api.github.com";

// 索引地址：https://raw.githubusercontent.com/{INDEX_REPO}/main/index.json
// 资产命名：{pack_id}-{version}-{target}.zip
pub fn asset_name(pack_id: &str, version: &str, target: &str) -> String {
    format!("{pack_id}-{version}-{target}.zip")
}
```

上游 `index.json`（`Agent2plugin/Agent2plugin/main/index.json`）实际内容：

```json
{
  "schema": 1,
  "plugins": [
    {
      "id": "agent2api-providers",
      "name": "提供商增强",
      "manifest": "plugins/agent2api-providers.json",
      "source": { "type": "github-release", "repo": "Agent2Builder/agent2api-providers-releases" },
      "official": true
    },
    { "id": "agent2api-web-providers", "...": "同上，另一个包" }
  ]
}
```

也就是说链路是：

```
index.json（INDEX_REPO） → 每个包的 source.repo → 该 repo 的 releases/latest
   → 找资产 {pack_id}-{version}-{target}.zip → 下载 → 校验 → 解包 → spawn 入口
```

**"下载源"由两处决定：索引仓库（常量）+ 每个包的 repo（数据）。** 我们只要把常量指到自己的库，之后 index.json 与 release 都是我们说了算。

---

## 2. iOS 上它凭什么会选中我们的包

`plugin_host/rpc.rs:115`：

```rust
pub(super) fn target_triple() -> String {
    let arch = std::env::consts::ARCH;
    match std::env::consts::OS {
        "windows" => format!("{arch}-pc-windows-msvc"),
        "macos"   => format!("{arch}-apple-darwin"),
        _         => format!("{arch}-unknown-linux-gnu"),   // ← iOS 走这里
    }
}
```

所以 iOS 上 `target = "aarch64-unknown-linux-gnu"`。我们发布：

```
agent2api-providers-<版本>-aarch64-unknown-linux-gnu.zip
    └─ pack.json（platforms 里 aarch64-unknown-linux-gnu → iOS 的 Mach-O 文件名）
    └─ agent2api-providers        ← 用 aarch64-apple-ios 编出来的 Mach-O，ldid 签名
```

网关按名字取资产、按 pack.json 取入口 → 拿到 iOS 二进制 → 原生 spawn。**无需它认识 iOS，也无需伪造平台。**

---

## 3. 签名与"要不要官方通道"

- pack 的 `require_signed` 是**索引/发布数据里的字段**（`PackAsset.require_signed`）。我们自己的 index 写成 `false`，就能装自建包；
- 我们仍然会给**可执行文件本身**做 `ldid -S`（这是 iOS/AMFI 的要求，与 pack 的 ed25519 签名无关）；
- 若某条路径强制要求 ed25519，那也只是"要求一个签名"，我们可以在自己仓库里生成自己的密钥对并在网关内置公钥（需要改代码一次）——**默认不需要**，先用 `require_signed:false`。

---

## 4. 关于"不要回退，直接打日志"

现状：安装/启动失败时，`packages.rs` 有 `rollback()`，所以面板会显示「已恢复原插件状态」。
改造方向（一次性，daemon 侧）：

- 去掉 rollback 调用点：失败就**保持当前状态 + 记录错误**，不自动还原；
- 错误落日志：`plugin_host/process.rs` 已有 `process::event("error", …, data)` 与 `record_failure`，把 stderr 尾部一并打出来（`drain_stderr` 已抓 stderr，`redact` 已脱敏）；
- 面板上"插件"卡片显示最近一次失败原因与"查看日志"入口即可。

这属于小改动（≈30 行），不改协议、不改包格式。

---

## 5. 你要的最终使用流程（改造后）

```
1. 手机装 daemon（一次）+ 装 EMBED=0 的 App（一次）
2. 打开 App → 网关插件 → 看到两张卡（来自我们仓库的 index.json）
3. 点「下载并安装」
      → GET raw.githubusercontent.com/vbox-Ai/Agent2apiPluginIndex/main/index.json
      → GET api.github.com/repos/vbox-Ai/Agent2apiPluginReleases/releases/latest
      → 下载 agent2api-providers-<ver>-aarch64-unknown-linux-gnu.zip
      → 校验 protocol=1 → 解包 → ldid 签名（若包内二进制未签）
      → spawn → 握手成功 → 卡片显示「运行中」
4. 后期我们修某家 provider：Bump 版本 → 发新 release → 用户在 App 里点「检查更新/更新」
      → 只下新 zip，不重装 App、不重启手机
5. 出问题时：卡片显示错误 + 日志里能看到完整 stderr（不回退、不静默）
```

---

## 6. 需要落地的东西（一次性）

| # | 内容 | 位置 | 量级 |
|---|---|---|---|
| 1 | `INDEX_REPO` / `FALLBACK_REPO` 改指我们的仓库 | daemon（一个常量） | 1 行 |
| 2 | 关掉 rollback，失败只记日志 | daemon `packages.rs` + `lifecycle.rs` | ~30 行 |
| 3 | 建索引仓库 `vbox-Ai/Agent2apiPluginIndex`：`index.json` + `plugins/*.json` | 新仓库 | 数据 |
| 4 | 建发布仓库 `vbox-Ai/Agent2apiPluginReleases`：Release 资产 | 新仓库 | CI 自动发 |
| 5 | 插件 iOS 打包脚本：编译 → 组 `pack.json`（`aarch64-unknown-linux-gnu` 键）→ zip 命名规范 | 我们仓库 `scripts/` | ~60 行 |
| 6 | 编译期补丁：插件 `Cargo.toml` 的 `reqwest` 去 `system-proxy`（iOS SDK 编不过） | CI 里改 2 行 | — |
| 7 | App 端重出 `EMBED=0` 客户端版（面板不变） | 现有 workflow 改一个输入 | 1 行 |

工期：**≈1.5 人日**（含真机联调）。

---

## 7. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| `raw.githubusercontent.com` 在国内不稳 | 下载卡住/失败 | 先试直连；失败则在索引仓库里用 `main` 分支 raw（同一域名），或后续加"自定义镜像地址"配置（需改代码）；也可把 index.json 内容内联到网关（就变成"内置索引 + 外链下载"） |
| 索引 schema 与网关解析不一致 | 列不出包 | 严格照抄上游 `schema:1` 结构与字段名（已拿到原文） |
| 插件 iOS 编译踩 `system-proxy` | 编不过 | 构建期按 target 关特性（网关那处已踩过并解决） |
| AMFI 拒绝未签助手 | spawn 失败 | 所有 Mach-O 一律 `ldid -S`；路径在容器的可写目录，daemon 以 mobile 身份运行 |
| 版本号规则 | "有没有更新"判断错 | 索引里的 `version` 与资产文件名必须一致（`{id}-{version}-{target}.zip`） |
| 关闭回退后装坏包 | 插件起不来，但状态可见 | 这正是你要的：错误原文进日志；重装包即可，不需要系统级回滚 |

---

## 8. 一句话

**可行。** 你要的"App 内点下载、从我们仓库取、后期我们自己更新、出错只打日志不回退"，恰好都能在这个网关的既有机制上做到——代价是**一次性**把架构换成 daemon + 客户端 App，并把索引常量指向我们的仓库；**之后所有 provider 增删改都不需要再动 App**。
