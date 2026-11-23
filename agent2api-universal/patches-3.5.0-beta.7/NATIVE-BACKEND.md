# 原生 pack 后端（S-A）：让独立形态的插件重新可装可跑

对象：手机独立形态（网关跑在手机上，iOS 侧 `EMBED=1` / LaunchDaemon，Android 侧 KSU 模块）。
背景见 `docs/PORTING-3.5.0-beta.7.md` 第 4 节。

本补丁 **不新增任何插件实现**，只做一件事：把上游 beta.2 起封掉的「原生提供商插件包」后端重新打开，
并且**默认关闭**——不设环境变量时行为与上游完全一致。

## 1 为什么需要它

| 事实 | 位置 |
|---|---|
| 原生包被硬禁 | `support.rs:6` `LEGACY_REASON`；`require_wasm()` / `legacy_reason()` / `installed_state()` 三处闸门 |
| 执行通道其实还在 | `lifecycle.rs:119` `tokio::process::Command::new(&self.options.exe)`，只是被 `options.script` 门控 |
| 入口按目标三元组存 | `install.rs:636` `entry: BTreeMap<target, path>`；但 `entry_for_target()` 在 beta.2 后**忽略 target**（`install.rs:441`，参数写成 `_target`），恒取 wasm 键 |
| iOS 上 WASM 跑不了 | `wasmtime` 只带 cranelift(JIT)，无 `wasmi`/`pulley`；iOS 禁数据页取执行权 |

## 2 两个开关（都要设）

| 变量 | 作用 | 建议 |
|---|---|---|
| `AGENT2API_ALLOW_NATIVE_PACKS=1` | 网关侧放行原生包：安装、启动、目录、支持状态全链路 | 手机独立形态必设 |
| `AGENT2API_ALLOW_EXEC=1` | 真正 spawn 插件二进制前再确认一次（沿用你既有 iOS 约定） | 与上面同设 |

```bash
# iOS daemon plist（/var/jb/Library/LaunchDaemons/com.chiyu.agent2api.plist）
AGENT2API_ALLOW_NATIVE_PACKS=1
AGENT2API_ALLOW_EXEC=1
```

## 3 插件包契约（沿用 `scripts/pack-ios-plugins.sh` 现有产物）

```json
{
  "entry": {
    "aarch64-unknown-linux-gnu": "agent2api-providers",
    "aarch64-apple-ios": "agent2api-providers"
  },
  "platforms": ["aarch64-unknown-linux-gnu", "aarch64-apple-ios"]
}
```

- `host_target()` 在 iOS 上回落成 `aarch64-unknown-linux-gnu`（`rpc.rs:131` 的 `_` 分支），
  所以入口键要写这个值；`aarch64-apple-ios` 作为别名一并认。
- `platforms` 允许是 **字符串数组**（你们现有包）或官网那种 **对象数组**（`{"target": …}`），
  目录过滤两种形状都认。

## 4 改动清单（6 文件）

| 文件 | 改动 |
|---|---|
| `support.rs` | 新增 `native_allowed()` / `native_entry()`；`require_wasm()` 放行原生；`installed_state()` 认原生为 Supported |
| `rpc.rs` | `HostOptions` 增加 `native: bool`（`new()` 里默认 `false`，三处构造点都用 `..HostOptions::new(..)`，无破坏） |
| `lifecycle.rs` | `ensure()` / `start()` 两道 `LEGACY_REASON` 闸门加 `&& !self.options.native`；spawn 前加 `AGENT2API_ALLOW_EXEC` 复核 |
| `bootstrap.rs` | 入口解析先找 wasm 键、放行时再找原生键；`wasm.is_none()` 不再直接判死；`HostOptions` 带上 `native` |
| `packages.rs` | 下载安装闸门：`!is_wasm` 时若放行且确有本平台入口则通过 |
| `catalog.rs` | 目录平台过滤保留「本机 target」资产，兼容字符串/对象两种 `platforms` 形状 |

`install.rs:401/576/599`、`operations.rs:219/368`、`ownership.rs:9`、`compatibility.rs:42`、
`startup.rs:112/157/203/346` 全部走 `require_wasm` / `legacy_reason`，改 `support.rs` 即覆盖，无需逐处改。

## 5 验证状态

| 判据 | 状态 |
|---|---|
| 补丁在干净 `v3.5.0-beta.7` 树上可应用（6/6 文件） | Observed |
| 关键标记落位（`native_allowed` / `!self.options.native` / `native,` / 字符串数组分支） | Observed |
| 编译 | `NOT RUN`（本机无 Rust 工具链） |
| 真机（iOS）：装原生包 → 启动 → 握手出 provider | `NOT RUN`，验收步骤见下 |

真机验收三步：

```bash
# 1) 网关上确认识别
curl -s http://127.0.0.1:3065/api/plugins | jq '.data.plugins[] | {id,supported,reason}'
# 期望 supported=true、reason=null

# 2) 启动后握手
curl -s http://127.0.0.1:3065/api/plugins/startup | jq
# 期望 phase=ready、providers 非空

# 3) 真打一次模型请求
curl -s http://127.0.0.1:3065/v1/chat/completions -H "Authorization: Bearer <网关Key>" \
  -H 'content-type: application/json' \
  -d '{"model":"<插件模型>","messages":[{"role":"user","content":"ping"}],"max_tokens":8}'
```

## 6 与其它补丁的关系

- **替代** `0001-plugin-host-ios-exec-gate` 的作用（闸门已并入 `lifecycle.rs`），0001 可以不再单独移植。
- **不包含** `0004`（自有仓库免签名）：如果你们的包走官网目录下载，还会撞 `require_signed`；
  手工安装（scp + 面板导入）不受影响。
- 脚本插件（JS）走的是另一条路：iOS 上没有 Bun，仍需 `0008~0023` 那套远端宿主桥。

## 7 回滚

不设 `AGENT2API_ALLOW_NATIVE_PACKS` 即回到上游行为；或直接 `git apply -R` 本补丁。
