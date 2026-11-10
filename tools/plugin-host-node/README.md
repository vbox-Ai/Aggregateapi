# tools/plugin-host-node

阶段 0 的**本地回归工具**：不依赖 Bun，把 `plugin_host/script/host/*.mjs` 这套宿主在 Node 下跑起来，
并驱动一支真实插件走完登录流程。它同时是「宿主侧对端契约」的可执行文档。

## 已实测的契约（2026-11-11）

| 方向 | 方法 | 形状要点 |
|---|---|---|
| 宿主 → 对端 | `script.http.open` | 入参 `{id,url,method,headers,body(base64),proxy}`；返回 `{id,status,headers,url}` |
| 宿主 → 对端 | `script.http.read` | 入参 `{id}`；返回 `{data: base64, done}` —— **`done` 为真时宿主只关闭不入队**，故最后一块必须 `done:false` 送完，下一次再 `done:true` |
| 宿主 → 对端 | `script.http.close` | 入参 `{id}` |
| 宿主 → 对端 | `store.get` / `store.list` / `store.update` / `store.ledger_get` / `store.ledger_put` / `script.proxy.resolve` | 登录路径可用空桩（`store.get` 需要 `{secret, public:{enabled:true}, proxy}`） |
| 对端 → 宿主 | `init` | `{packages:[{id,directory}], env:{data_dir}}`；返回各 provider 的 `id/capabilities/login_methods/default_models` |
| 对端 → 宿主 | `login.start` / `login.poll` / `login.callback` / `login.cancel` / `provider.info` | `login.start` 入参需用 **init 返回的真实 provider id**（本插件为 `nous-portal`，不是包名）；返回 `{flow,url,instructions,poll_interval_ms}` |

## 关键结论

- 宿主 JS 只依赖**两条流**（stdout 写、stdin 读，NDJSON 每行一帧）；Rust 侧的接缝在
  `plugin_host/lifecycle.rs`（`Stdio::piped()` + 取 `child.stdin/stdout`）与 `plugin_host/mod.rs`
  （`stdin: Arc<Mutex<ChildStdin>>`）⇒ iOS 只需换**传输层**（Worker ↔ 网关），`rpc.rs` 的处理函数无需改动。
- 宿主假设 Bun 存在，但**只需一个空壳**即可绕过：`globalThis.Bun` 的成员一被调用就抛错
  （保持"真用了本机进程能力才失败"的语义，而不是静默假装支持）。
- 插件入口判定对**具名导出**同样成立（`entries.mjs` 的 `servers()` 把模块里所有函数值导出都当 provider entry），
  故 Magpie 那批 `export async function XxxAuthPlugin({client})` 不用包一层。
