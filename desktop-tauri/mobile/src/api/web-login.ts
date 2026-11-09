/**
 * 网页登录（官方页面登录）—— 手机端实现。
 *
 * ── 为什么手机端能做，而桌面端要用壳的桥 ──────────────────────
 * 桌面端把这一步交给壳（`workbuddyDesktop.startLogin`），因为桌面壳要开**内嵌窗口**
 * 并把 Cookie 捕获回来。但网关侧其实是一条**普通的 HTTP 流程**：
 *   1. `POST /api/session/login/oauth/start` → 回 `{state, authUrl}`；
 *   2. 用户在**官方登录页**完成登录，官方页回调到本机网关（`127.0.0.1:<端口>`）；
 *   3. `GET /api/session/login/wait?state=` 拿到结果。
 * 桌面端的**网页面板**（没有壳）走的就是这条路 —— 配置注释里写明网页端那一级
 * 「整级收起，用 `webHint` 说明唯一那条路（在新标签页中打开）」。
 *
 * 手机端同理：**回调地址指向 `127.0.0.1` 时，打开官方页的是手机自己的浏览器，
 * 回到的也正是手机自己的本机网关** —— 所以这条链在手机上成立，不需要壳。
 *
 * ── 手机端唯一的不便与处理 ──────────────────────────────────
 * Capacitor 的 WebView **忽略 `window.open`**（与 Tabbit 短信登录那次同一个坑）。
 * 所以这里的做法是：能开就开（`window.open` + 一个 `<a target="_blank">`），
 * **同时一定把地址显示出来并给「复制链接」** —— 用户能自己粘到 Safari 打开。
 * 完成后可以点「我已完成」直接查结果，也可以用「粘贴回调地址」走 callback 兜底。
 */
import { apiCall } from './client'

export type WebLoginStart = {
  state?: string
  authUrl?: string
  url?: string
  provider?: string
}

/**
 * 启动一次网页登录。
 *
 * 只发必要字段：`provider`（+ 可选 `methodIndex`，当这一家是"同一家多种登录方式"时
 * 用来指定哪一个）。**不发送任何占位值** —— 网关对不支持的家会回一条可读的 400
 * （如「X 不支持网页登录，请改用『填写凭证』…」），那条消息本身就是最好的提示。
 */
export function startWebLogin(input: { provider: string; methodIndex?: number }): Promise<WebLoginStart> {
  return apiCall<WebLoginStart>('/api/session/login/oauth/start', {
    method: 'POST',
    body: input.methodIndex === undefined
      ? { provider: input.provider }
      : { provider: input.provider, methodIndex: input.methodIndex },
  })
}
