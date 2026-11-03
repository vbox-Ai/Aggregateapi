# mobile/src 能力改造调用点地图（M2 施工单）

面板**不需要重写**，只需要把"猜平台"换成"查能力"。本文件是逐处施工单：
左边是现在的判断方式，右边是改后写法。文件路径全部来自上游 `desktop-tauri/mobile/src/`。

## 0. 先做地基（0.5 天）

1. 把 `agent2api-universal/mobile-src/host.ts` 复制成 `mobile/src/host.ts`；
2. `npm install ../agent2api-universal/mobile-plugin`（隔离登录容器）；
3. 在 `App.tsx` 的启动流程里 `await loadHostInfo()` 一次（失败也继续，用保守表）。

完成后下面所有改动都只是"把原来的判断换成 `hostHas()` / `openLogin()`"。

## 1. 定位命令（先跑一遍，确认清单与上游同步）

```bash
cd desktop-tauri/mobile/src
grep -rn "window\.open\|Capacitor\.getPlatform\|isNative\|navigator\.userAgent" .
grep -rn "login/start\|login/wait" .
grep -rn "ApkUpdater\|ImageSaver\|registerPlugin" .
grep -rn "installPlugin\|plugin" pages/PluginsPage.tsx pages/plugins/*.tsx api/plugins.ts
```

## 2. 逐处改动

| # | 文件 | 现状（推测依据） | 改法 | 能力键 |
|---|---|---|---|---|
| 1 | `pages/PluginsPage.tsx` | 直接渲染插件列表与"安装/更新"按钮 | 页面顶部 `if (!hostHas('plugins'))` → 渲染 `UnsupportedNotice('plugins')`；列表与按钮整块加 `data-cap-require="plugins"` | `plugins` |
| 2 | `pages/plugins/PluginCards.tsx` / `PluginSettingsSheet.tsx` | 插件卡片的启用/设置开关 | 同上，整块 capability 包裹；不要在"不可用"时仍显示开关 | `plugins` |
| 3 | `api/plugins.ts` | 直接 `fetch /api/plugins*` | 每个导出函数入口 `if (!hostHas('plugins')) throw new HostUnsupportedError('plugins')`，让上层 toast 走统一文案 | `plugins` |
| 4 | `pages/CheckinUmid.tsx` | Qoder 国际版签到用 `runtime-info` 子进程 | 该页入口加 `data-cap-disable="execHelpers"`；说明"本端不支持该签到方式" | `execHelpers` |
| 5 | `lib/appUpdate.ts` | 走 `ApkUpdater`（仅 Android 插件） | `if (!hostHas('selfUpdate'))` → 隐藏"检查更新/下载安装"，改为"请重新安装应用" | `selfUpdate` |
| 6 | `pages/add-account-dynamic-sheet.tsx` + `api/add-account-dynamic.ts` | 网页登录用 `window.open` + 轮询 `login/wait` | 把 `window.open(authUrl)` 换成 `openLogin(authUrl, state)`（`host.ts` 已封装三档降级），其余轮询逻辑不动 | `isolatedLogin` |
| 7 | `pages/AccountSheet.tsx`（重新登录） | 同上 | 同 6 | `isolatedLogin` |
| 8 | `components/AssistantImageSave` 相关（`lib/assistant-image-save.ts`） | 走 `ImageSaver` 原生插件 | iOS 无该插件时会抛 `not implemented`：加 try/catch → 降级为 `a[download]` 或长按保存提示 | — |
| 9 | `pages/ServersPage.tsx` / `lib/servers.ts` | 多服务器切换（已存在） | 无需改；只需在"添加服务器"时允许 `http://127.0.0.1:3065`（本机 daemon 形态默认项） | — |
| 10 | `components/PwaNotice.tsx` | 提示"添加到主屏幕" | 原生壳里应不显示：`if (Capacitor.isNativePlatform()) return null`（这一条是 UA/平台判断的**正当用途**：它描述的是"我在不在浏览器里"，不是能力） | — |

> 第 10 条值得单独说明：**平台判断不是原罪**。"我是不是在浏览器里"这种**事实**可以用
> `Capacitor.isNativePlatform()`；"能不能装插件"这种**能力**必须查 `/api/host`。
> 两者混在一起才是要清理的债。

## 3. 验收

| 门禁 | 判据 |
|---|---|
| V1 | iOS 构建里"插件"入口不存在（不是灰掉），`PluginsPage` 不出现空列表 |
| V2 | iOS 上添加账号 → 网页登录走原生隔离容器（关掉后第二次登录不串 cookie） |
| V3 | 浏览器（PWA）里"插件""订阅内核""自更新"入口都不出现，控制台无 404/401 噪音 |
| V4 | Windows/macOS 桌面端入口一个不少（能力表 `plugins:true`） |
| V5 | `npm run typecheck` 通过，无 `any` 扩散 |

## 4. 与 sed 补丁的对应关系（迁完之后删掉 `patch-ui.sh` 的 5 段）

| `patch-ui.sh` 现在干的事 | 迁到源码后 |
|---|---|
| 往 `m.html` 注入 `A2A_LOGIN_OPEN` + `stateCapture` | 删除。`openLogin(authUrl, state)` 直接把 state 传给原生容器 |
| `mobile.js` 里 `window.open($.url,...)` → `A2A_LOGIN_OPEN` | 第 6、7 项 |
| `sw.js` 的 `CACHE` md5 戳 | `vite.config.ts` 注入 `__BUILD_HASH__` |
| `mobile.css` 追加两段高度 `!important` | 直接改组件里的 Tailwind 类 |
| `mobile.js` 万/亿 → K/M/B（sed 三处正则） | 统一用 `Intl.NumberFormat(undefined,{notation:'compact'})` |
