import { ApiError, apiCall } from './client'
import { t } from '../i18n'

/**
 * 单条请求的**调试报文**（`api/debug_api.rs` 的 `get_traffic`）。
 *
 * `GET /api/debug/traffic?id=<请求 id>` —— 与 `/api/stats/requests/raw` **不是一回事**：
 *
 * | 端点 | 桌面端标签 | 内容 |
 * |---|---|---|
 * | `/api/stats/requests/raw` | **预览对话** | 两侧正文，用来拼出对话预览 |
 * | `/api/debug/traffic?id=` | **原始报文** | 请求头 / 请求体 / 响应头 / 响应体**四段** + URL、提供商、上游状态码 |
 *
 * 契约是从**已发布二进制里内嵌的面板 JS** 挖出来的（桌面 `ui-islands` 里没有这份代码，
 * 面板侧才是权威）：
 * ```js
 * wGe = [{label:'请求头', pick:e=>hL(e.requestHeaders)}, {label:'请求体', pick:e=>hL(e.requestBody)},
 *        {label:'响应头', pick:e=>hL(e.responseHeaders)}, {label:'响应体', pick:e=>String(e.responseBody||'')}]
 * function SGe(e){ return [e.requestHeaders,e.requestBody,e.responseHeaders,e.responseBody]
 *   .some(v => typeof v==='string' ? v.trim()!=='' : v!=null) }
 * function hL(e){ if(e==null) return ''; if(typeof e==='string') return e; try{return JSON.stringify(e,null,2)}catch{return ''} }
 * ```
 *
 * 所以：字段名固定是那四个（`status` / `url` / `provider` / `truncated` 是附带信息）；
 * **「四段全空」= 没保存（`found:false`）**，而不是错误 —— 报文只在调试模式开启期间采集。
 * 请求头里的凭据字段由网关替换成 `[redacted]` 后才落库，所以这里拿到的就是脱敏后的。
 */

export type DebugTraffic = {
  requestHeaders?: unknown
  requestBody?: unknown
  responseHeaders?: unknown
  responseBody?: unknown
  truncated?: boolean
  url?: string
  provider?: string
  status?: number | null
}

/** 与面板侧 `SGe` 同一判据：四段里只要有一段非空就算「有报文」 */
export function hasTraffic(data: DebugTraffic | null | undefined): boolean {
  if (!data) return false
  return [data.requestHeaders, data.requestBody, data.responseHeaders, data.responseBody].some(value =>
    typeof value === 'string' ? value.trim() !== '' : value != null,
  )
}

/** 与面板侧 `hL` 同一归一：null/undefined → 空串；字符串原样；其余 JSON 缩进 */
export function normalizeTrafficValue(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return ''
  }
}

export type TrafficSection = { label: string; text: string }

/** 四段（顺序与标签照抄面板侧 `wGe`） */
export function trafficSections(data: DebugTraffic | null | undefined): TrafficSection[] {
  if (!data) return []
  return [
    { label: t('请求头'), text: normalizeTrafficValue(data.requestHeaders) },
    { label: t('请求体'), text: normalizeTrafficValue(data.requestBody) },
    { label: t('响应头'), text: normalizeTrafficValue(data.responseHeaders) },
    { label: t('响应体'), text: data.responseBody ? String(data.responseBody) : '' },
  ]
}

export type DebugTrafficResult =
  | { found: true; data: DebugTraffic }
  | { found: false; reason: 'not-recorded' }

export async function fetchDebugTraffic(id: string): Promise<DebugTrafficResult> {
  try {
    const data = await apiCall<DebugTraffic>(`/api/debug/traffic?id=${encodeURIComponent(id)}`)
    // 后端也可能回 200 + 四段全空：同样按「没保存」处理，不显示空壳
    if (!hasTraffic(data)) return { found: false, reason: 'not-recorded' }
    return { found: true, data: data || {} }
  } catch (cause) {
    // 404 与「没保存」同义（面板侧也是把异常一律当 gone），所以一并归一
    if (cause instanceof ApiError && cause.status === 404) return { found: false, reason: 'not-recorded' }
    throw cause
  }
}
