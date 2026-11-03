# Aggregateapi · Agent2API 多端构建

把 KernelSU 模块 `agent2api-ksu-module.zip`（Android 专用）扩展成 **iOS / Android / Windows / macOS / Linux / Web** 六端可安装产物的仓库。
上游代码不 vendoring：CI 构建时浅克隆 [aimod-cc/Agent2API](https://github.com/aimod-cc/Agent2API)，再打本仓库的两个补丁。

## 一键出包

仓库 → **Actions** → `build` → **Run workflow**（`embed` 默认 `1`）→ 跑完在页面底部 **Artifacts** 下载：

| Artifact | 内容 | 用途 |
|---|---|---|
| `ios` | `Agent2API.ipa` + `agent2api-server`（Mach-O） + `com.chiyu.agent2api.plist` | 手机直接装；plist 给"守护进程常驻"方案 |
| `macos` | `.dmg`（universal）+ 常驻二进制 | 桌面端 |
| `windows` | `.msi` / `.exe` | 桌面端 |
| `linux` | `.AppImage` / `.deb` + headless 二进制 | 桌面/服务器 |
| `android-ksu` | `agent2api-ksu-module.zip`（bionic 版网关重打包） | KernelSU / Magisk 刷入 |
| `web` | Docker 镜像 + 面板静态资源 | 浏览器 / PWA |

> 每个 job 都是 `continue-on-error`：某一端失败不影响其它端出包。

## iOS 的两种形态（对应 workflow 的 `embed` 输入）

| `embed` | IPA 内含 | 装完直接能用？ | 适用 |
|---|---|---|---|
| `1`（默认） | 网关静态库 + 面板资源，网关跑在 App 进程内 | ✅ 是（离线单机） | 想立刻看效果：装上→注册管理员→用面板 |
| `0` | 只有 WKWebView 壳 | ❌ 需要另外跑网关（另一台设备/局域网/守护进程） | 当"远程客户端" |

`embed=1` 时数据落在 App 容器 `Library/Application Support/agent2api/`，卸载 App 即清空。

## iOS 安装（17.0 越狱）

```bash
# 方式 A：AppSync 环境
appinst Agent2API.ipa

# 方式 B：TrollStore —— 直接把 ipa 传到手机，点开「用 TrollStore 安装」

# 方式 C：手工（Windows/Linux 也行，用 ssh/scp 到手机）
scp Agent2API.ipa root@<手机IP>:/var/mobile/Documents/
ssh root@<手机IP> 'appinst /var/mobile/Documents/Agent2API.ipa'
```

首次打开：`http://127.0.0.1:3065/` 由 App 内的网关提供 → 面板注册管理员 → 加账号 → 建 Key。

### 想让它熄屏也常驻（可选，形态 A1）

```bash
scp agent2api-server root@<手机IP>:/var/jb/usr/local/bin/
scp com.chiyu.agent2api.plist root@<手机IP>:/var/jb/Library/LaunchDaemons/
ssh root@<手机IP> '
  mkdir -p /var/mobile/Library/agent2api && chown mobile:mobile /var/mobile/Library/agent2api
  chmod 755 /var/jb/usr/local/bin/agent2api-server
  ldid -S /var/jb/usr/local/bin/agent2api-server
  launchctl bootstrap system /var/jb/Library/LaunchDaemons/com.chiyu.agent2api.plist
  sleep 3; curl -s http://127.0.0.1:3065/health
'
```

> 跑插件需要在 plist 里加 `AGENT2API_ALLOW_EXEC=1`（见 `agent2api-universal/docs/PLUGIN-PORT-IOS.md`）。

## 目录

```
.
├── .github/workflows/build.yml     六端构建流水线
├── assets/agent2api-ksu-module.zip 原始 KSU 模块（Android 重打包的骨架）
├── agent2api-ios/                  iOS 落地件
│   ├── app/Agent2API/              Swift 壳（WKWebView + 隔离登录容器 + 能力桥）
│   ├── ios-ffi/                    a2a_start/a2a_stop 的 C ABI（EMBED=1 用）
│   ├── daemon/                     LaunchDaemon plist（替代 supervisor.sh）
│   └── scripts/build-ipa.sh        xcodebuild 替代方案：swiftc + ldid + Payload
└── agent2api-universal/            六端通用改造件
    ├── patches/                    两个已验证可 git apply 的补丁
    ├── crates/host-api/            平台能力抽象（Capabilities + Host trait）
    ├── ui/host.js                  Web 侧能力层
    ├── mobile-src/host.ts          Capacitor 侧能力层
    ├── mobile-plugin/              A2ALogin 隔离登录容器（Capacitor iOS 插件）
    ├── docs/                       架构 / 插件移植 / mobile 施工单
    ├── scripts/build-matrix.sh     本地一条命令出六端
    └── .github/workflows/matrix.yml（备用：本仓库用的是根目录 build.yml）
```

## 两个补丁

| 补丁 | 作用 | 状态 |
|---|---|---|
| `0001-plugin-host-ios-exec-gate.diff` | 插件宿主 spawn 前加形态闸门（`AGENT2API_ALLOW_EXEC=1` 恢复 iOS 插件） | `git apply` 验证通过（+43/−0） |
| `0002-host-capabilities-endpoint.diff` | `GET /api/host` 能力表（界面据此隐藏不可用入口） | `git apply` 验证通过（新文件 + 两处注册） |

## 已知边界（写在前面，避免误判为 bug）

1. **插件 provider**：上游已把 provider 实现移进独立插件包；没装插件时面板会提示「该提供商需要安装插件」（503）。
   iOS 想跑插件需要插件包出 `aarch64-apple-ios` 构建 + daemon 形态 + `AGENT2API_ALLOW_EXEC=1`。
2. **`agent2api-web-providers`**（chatglm/deepseek/mimo 这类浏览器抓取型）在 iOS 上不可移植（要 Playwright/Chromium）。
3. **订阅内核（mihomo sidecar）** 仅桌面三端随附。
4. **菜单自更新** 在 iOS/Android 关闭（会下载 glibc ELF 覆盖自身）；升级走重装。
