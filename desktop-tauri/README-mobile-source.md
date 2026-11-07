# 手机端源码（同步自上游）

本目录的 mobile UI 源码同步自：

```text
https://github.com/aimod-cc/Agent2API
tag: v3.4.2
```

包含：

```text
desktop-tauri/mobile/        React + Vite + Capacitor 手机工程
desktop-tauri/ui-kit/        @ui 组件源码
desktop-tauri/ui-shared/     手机/桌面共享业务组件
desktop-tauri/ui-islands/    共享 islands（手机引用了 add-account-dynamic-fields）
desktop-tauri/ui/aliyun-captcha.js
```

## 构建

```bash
cd desktop-tauri/mobile
pnpm install
pnpm run typecheck
pnpm run build
```

`pnpm run build` 输出到：

```text
desktop-tauri/ui/m/mobile.js
desktop-tauri/ui/m/mobile.css
desktop-tauri/ui/m/sw.js
desktop-tauri/ui/sw.js
```

其中 `mobile.js` 已与当前 `Agent2API 3.4.182` 的 `ui/m/mobile.js` 做过 SHA-256 对比：

```text
67663cf046b8800eddffd18f8a0ed938a9846ef89adca75cd993feb1f057662da
```

两边一致，说明 v3.4.2 源码就是当前手机 UI 的对应源码。

## 注意

- 不要提交 `node_modules/`、`ui/m/`、`ui/sw.js` 等构建产物。
- `mobile/vite.config.ts` 的 `@ui` 指向 `../ui-kit/src`，构建时必须保留 `ui-kit`。
- 手机页面 `add-account-dynamic-sheet.tsx` 还引用 `../ui-islands/src/islands/add-account-dynamic-fields`，构建时必须保留 `ui-islands`。
- `ui/aliyun-captcha.js` 是手机构建 `closeBundle` 阶段需要的静态脚本。
