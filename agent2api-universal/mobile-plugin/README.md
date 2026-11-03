# A2ALogin · Capacitor 隔离登录容器

`Agent2Login.apk`（Android 系统 WebView 容器）在 Capacitor 侧的等价实现。
iOS 用 `WKWebsiteDataStore.nonPersistent()` 起一次性 cookie 罐；Android / Web 自动降级。

## 为什么需要它（不是"再加一层封装"）

上游 `mobile/src` 在网页端是「新标签 + 轮询 `login/wait`」。在 WKWebView 里
`window.open` **复用同一个 `WKWebsiteDataStore`**，登录态会跟主面板互串——多账号场景下
第二次登录会拿到上一次的会话，表现为「新账号里出现旧 token」。

隔离容器的三条硬要求，只有原生能做到：

| 要求 | 实现位置 |
|---|---|
| 每次登录一个独立 cookie 罐 | `config.websiteDataStore = WKWebsiteDataStore.nonPersistent()` |
| 关闭即焚（cookie/localStorage/IndexedDB/缓存） | `removeData(ofTypes: allWebsiteDataTypes, modifiedSince: .distantPast)` + `URLCache.removeAllCachedResponses()` |
| 回调闭环 | `decidePolicyFor`：custom scheme → `POST /api/session/login/callback`；loopback → 放行 |

## 接入（3 步）

```bash
# 0. 假定本目录在 ../agent2api-universal/mobile-plugin
cd desktop-tauri/mobile

# 1. 作为本地插件安装
npm install ../agent2api-universal/mobile-plugin

# 2. 同步到 iOS 工程（Podfile / SPM 二选一，Capacitor 8 会按 podspec 自动处理）
npx cap sync ios          # 等价于 package.json 里的 npm run build:ios

# 3. 打开工程打包
open ios/App/App.xcodeproj
```

`mobile/ios/App/App/Info.plist` 已经有 ATS 全放行与 `NSLocalNetworkUsageDescription`
（上游已配好），本插件不需要额外权限。

## 使用

```ts
import { openLogin } from '@agent2api/capacitor-a2a-login';

// 面板发起登录后拿到 authUrl + state，直接交给统一入口：
const { result } = await openLogin({ url: authUrl, state, gateway: gatewayBase });
// result: 'loopback' | 'callback-posted' | 'cancelled' | 'tab' | 'intent'
// 真正的成功与否仍由面板轮询 login/wait 判定（与桌面壳语义一致）
```

改造点只有一处：把 `mobile/src` 里原来的 `window.open(authUrl, '_blank')`
换成 `openLogin({ url: authUrl, state, gateway })`。

## Android 侧现状

Android 的隔离登录器是模块自带的 `Agent2Login.apk`（`agent2api://login` intent）。
本插件的 `openLogin` 在 Android 上先尝试原生（未实现 → 抛 `not implemented`），
然后降级到 intent，所以**不必为本插件写 Android 实现**。若将来要做 APK 形态的
一体化隔离容器，照着 `A2ALoginPlugin.swift` 写一份 `A2ALoginPlugin.java` 即可
（`WebView` + `CookieManager.removeAllCookies` + 自定义 scheme 拦截）。

## 已知边界

- 容器里不做 `User-Agent` 改写：部分上游按 UA 下发风控挑战，改了反而失败。
- 同一时刻只允许一个容器（`session != nil` 时直接 reject），避免 cookie 罐互串。
- 容器关闭后不再响应任何回调；轮询超时由面板侧的 `login/wait` 负责。
