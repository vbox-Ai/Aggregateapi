# agent2api-universal · 六端通用改造件

配合 `../agent2api-ios/`（iOS 落地件）一起用。完整设计见 `docs/ARCHITECTURE-universal.md`。

## 目录

| 路径 | 作用 | 落到上游哪里 |
|---|---|---|
| `crates/host-api/` | 平台能力抽象（Capabilities + Host trait + 501 映射），**零依赖** | 作为新 crate 加入 `desktop-tauri/src-tauri/` 的 workspace，`server` 依赖它 |
| `ui/host.js` | UI 侧统一入口：能力驱动渲染 + 登录分发 + `workbuddyDesktop` 透传 | 放进 `ui/` 并在 `index.html`/`m.html` 的 `</head>` 前加 `<script src="host.js"></script>` |
| `mobile-src/host.ts` | 手机端（Capacitor）能力层：`/api/host` + 能力闸门 + 登录统一入口 | 复制成 `desktop-tauri/mobile/src/host.ts` |
| `mobile-plugin/` | **A2ALogin** Capacitor 隔离登录容器（iOS `nonPersistent` WKWebView + 回调闭环） | `npm install ../agent2api-universal/mobile-plugin` → `npm run build:ios` |
| `patches/0001-plugin-host-ios-exec-gate.diff` | 插件宿主 spawn 前的形态闸门（+43/−0，已验证 `git apply`） | `git apply` 到上游仓库 |
| `patches/0002-host-capabilities-endpoint.diff` | `GET /api/host` 能力表端点（新文件 + 两处注册，已验证 `git apply`） | 同上 |
| `docs/ARCHITECTURE-universal.md` | 分层/能力矩阵/改动清单/里程碑；§7.5 Capacitor 双壳、§7.6 provider 外置的更正 | 设计依据 |
| `docs/PLUGIN-PORT-IOS.md` | 给插件作者：`agent2api-providers` 出 iOS 构建的三件事与验收清单 | 转发给插件维护者 |
| `docs/MOBILE-CALLSITES.md` | `mobile/src` 十处调用点的逐行改法 + 与 sed 补丁的迁移对照 | M2 施工单 |
| `scripts/build-matrix.sh` | 一条命令出六端产物 | 仓库根目录 `scripts/` |
| `.github/workflows/matrix.yml` | 六端 CI（六个 artifact，互不阻塞） | 仓库根目录 `.github/workflows/` |

## 三步接线（M1 + M2，约 2.5 人日）

**1. 能力表上线**

```rust
// server/src/server/api/host.rs（新增）
pub async fn get_host(State(state): State<ServerState>) -> Response {
    // state.host: Arc<dyn host_api::Host>
    ok_json(json!({
        "platform": state.host.capabilities().platform.as_str(),
        "form": state.host.capabilities().form.as_str(),
        "version": env!("CARGO_PKG_VERSION"),
        "caps": serde_json::from_str::<Value>(&state.host.capabilities().to_json()).unwrap(),
        "ui": { "mobileFirst": true, "defaultRoute": "/m" }
    }))
}
// 注册：router.route("/api/host", get(get_host))   // 不需要鉴权
```

**2. 把四处平台泄漏换成能力闸门**

```rust
// core/sub_kernel/runtime.rs / providers/qoder/risk.rs / 插件 loader
state.host.capabilities().require(host_api::Feature::Sidecar)?;   // 或 Plugins / ExecHelpers
let child = state.host.exec_helper(&host_api::HelperSpec {
    program, args, env, piped_stdio: true, label: "plugin:atomcode".into(),
})?;
// 路由层统一：
Err(err) => (StatusCode::from_u16(err.http_status()).unwrap(), err.to_json())
```

**3. 面板接线**

```html
<!-- ui/index.html 与 ui/m.html 的 </head> 之前 -->
<script src="host.js"></script>
```

```js
// 需要能力的入口加声明式标记，host.js 自动隐藏/禁用
<button data-cap-disable="sidecar">下载订阅内核</button>
<a data-cap-require="plugins" href="#/plugins">插件</a>

// 登录统一走（取代散落的 A2A_LOGIN_OPEN / ksu.exec / UA 判断）
A2AHost.login.open(authUrl, state);
```

## 验收（六端同一张表）

`GET /api/host` 的 `caps` 必须与本端实际能力一致（不许虚报），然后逐项过：
`/health` → 面板首屏 → 注册+建 Key → `/v1/models` → 流式 chat → 隔离登录 → 杀进程自恢复 → 冷启动自启 → `.a2ab` 跨端互导。

## 各端形态一句话

| 端 | 后端 | 壳 | 常驻靠 |
|---|---|---|---|
| Windows | `agent2api-server.exe` | Tauri 2 | 托盘 + 自启 |
| macOS | universal 二进制 | Tauri 2 | LaunchAgent |
| Linux | 二进制 / 容器 | Tauri 2 | systemd user |
| Android(root) | `aarch64-linux-android` | KSU 模块 | `service.sh` + supervisor |
| Android(APK) | staticlib + JNI | 前台 Service | 通知常驻 |
| iOS(越狱) | `aarch64-apple-ios` | WKWebView 壳 | launchd `KeepAlive` |
| Web | 借用上面任一端 | 无壳（PWA） | 后端负责 |
