import { apiCall } from './client'

/**
 * 连接与安全设置（`docs/mobile-ui/contracts/CONTENT.md`）。
 *
 * 两个开关各自的作用面不同，界面上必须说清，否则用户会以为「关了人机验证
 * 就等于关掉了网关鉴权」：
 *
 *  · **CORS**（`cors.rs`）：只影响**网关面 `/v1/*`**。开启后预检直接 204、三个
 *    `Access-Control-Allow-*` 头随每个响应下发（来源 `*`）。关闭时（默认）预检会被
 *    API Key 中间件 401 拒掉。**面板路由 `/api/*` 不受它影响**，一直是无条件 CORS。
 *  · **机器人校验**（`captcha.rs`）：只影响**面板的登录 / 注册**（ALTCHA 工作量证明），
 *    与 `/v1/*` 的 API Key 鉴权无关。两端独立：桌面壳读 `captchaDesktop`，
 *    网页/headless 读 `captchaWeb`；GET 回的 `localPanel` 告诉界面「你现在这一端」
 *    该看哪个开关，它是**只读**的进程形态，不是配置。
 */

export type CorsSettings = { corsEnabled?: boolean }

export const fetchCors = () => apiCall<CorsSettings>('/api/cors')
export const putCors = (corsEnabled: boolean) =>
  apiCall<CorsSettings>('/api/cors', { method: 'PUT', body: { corsEnabled } })

export type CaptchaSettings = {
  /** 桌面壳（Tauri / 本机应用）的登录校验，默认 true */
  captchaDesktop?: boolean
  /** 网页端（headless / Docker / 浏览器面板）的登录校验，默认 true */
  captchaWeb?: boolean
  /** **只读**：本进程形态。true = 桌面壳，false = headless / 网页 */
  localPanel?: boolean
}

export const fetchCaptcha = () => apiCall<CaptchaSettings>('/api/captcha')

/** 分端部分更新：只发要改的那一端（两端都没给会被后端 400 拒掉） */
export const putCaptcha = (patch: { captchaDesktop?: boolean; captchaWeb?: boolean }) =>
  apiCall<CaptchaSettings>('/api/captcha', { method: 'PUT', body: patch })

/** 本机这一端受哪个开关管 */
export function captchaSwitchFor(settings: CaptchaSettings): 'captchaDesktop' | 'captchaWeb' {
  return settings.localPanel === true ? 'captchaDesktop' : 'captchaWeb'
}
