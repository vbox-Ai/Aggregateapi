import { apiCall } from './client'

/**
 * 更新出网代理（`api/update.rs` 的 `updateProxy`）。
 *
 * 装上后「检查更新 / 下载更新包」的出网走这个代理 —— 弱网或被墙的环境靠它。
 * GET 回 `{proxy}`；POST 用同一个键写入（空串或不发表示清除）。
 * `/api/system-info` 的 `security.updateProxy` 只报**有没有**指定出口，不回地址。
 */

export const fetchUpdateProxy = () => apiCall<{ proxy?: string | null }>('/api/update/proxy')
export const putUpdateProxy = (proxy: string) =>
  apiCall<{ proxy?: string | null }>('/api/update/proxy', { method: 'POST', body: { proxy } })

/**
 * 本地校验：允许 http / https / socks5 前缀，或直接填 `主机:端口`。
 * 空串合法（= 清除代理）。
 */
export function validateProxy(
  value: string,
  translate: (key: string) => string,
): string | null {
  const text = value.trim()
  if (!text) return null
  if (/\s/.test(text)) return translate('代理地址不能包含空格')
  const stripped = text.replace(/^(https?|socks5h?):\/\//i, '')
  if (!/^[^\s/:]+:\d{1,5}$/.test(stripped)) {
    return translate('格式应为 主机:端口，可带 http:// 或 socks5:// 前缀')
  }
  return null
}
