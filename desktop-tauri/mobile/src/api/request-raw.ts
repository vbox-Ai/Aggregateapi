import { ApiError, apiCall } from './client'

/**
 * 单条请求的原始报文（`api/stats_api.rs` 的 `stats_request_raw`）。
 *
 * `GET /api/stats/requests/raw?id=...`
 * → `{ id, requestBody, responseBody, truncated }`
 * → 400 缺少 id 参数
 * → 404 未找到（**这是正常状态，不是错误**）
 *
 * ── 为什么 404 要当正常状态 ─────────────────────────────────
 * 正文只在**调试模式开启期间**的请求上采集（关着时不写行），此外也可能已被清理。
 * 两种情况都是「本来就没有」，而不是「出错了」。所以这里把它归一成
 * `{ found: false }`，界面上给一句解释而不是红色报错。
 *
 * `truncated` 只表示**旧版本保存的正文可能不完整**，与新采集的无关。
 */

export type RawBody = {
  id?: string
  requestBody?: string | null
  responseBody?: string | null
  truncated?: boolean
}

export type RawBodyResult =
  | { found: true; body: RawBody }
  | { found: false; missing: 'not-recorded' }

export async function fetchRequestRaw(id: string): Promise<RawBodyResult> {
  try {
    const body = await apiCall<RawBody>(`/api/stats/requests/raw?id=${encodeURIComponent(id)}`)
    return { found: true, body: body || {} }
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 404) return { found: false, missing: 'not-recorded' }
    throw cause
  }
}

/** 展示前的可读化：是 JSON 就缩进，否则原样 */
export function prettify(body: string | null | undefined): string {
  const text = body || ''
  if (!text) return ''
  const trimmed = text.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return text
  // 大正文不做解析：这一步是为了「看得清」，不值得为它卡住界面
  if (text.length > 200_000) return text
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2)
  } catch {
    return text
  }
}
