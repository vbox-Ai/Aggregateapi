/**
 * 请求记录的维护操作：筛选候选 / 清理预览 / 清理 / 压缩数据库。
 *
 * ── 这几条为什么必须一起做 ────────────────────────────────────
 * 清理是**不可恢复**的，上游为此把「先看预览、再执行」拆成两条接口，并要求
 * 两者**共用同一份筛选计划**（`stats_api::stats_clear_preview` 与
 * `clear_stats_requests` 都走 `checked_filter`）。所以这里也把筛选原样传下去：
 * 预览说删 N 条，执行删的就是那 N 条。
 *
 * ── 筛选参数的键名（与列表完全一致，逐条核对过上游）──────────
 * `filter_from_params` 读 `model` / `provider` / `client` / `apiKey` /
 * `productionOnly` / `completedOnly` / `status`；日期是 `date_bounds` 读的
 * **`startDate` / `endDate`**（`YYYY-MM-DD`，与 `/api/stats/summary` 同名）。
 * 也就是说：**列表怎么筛，清理就怎么筛**，两边不会各说各话。
 *
 * ── 三条容易踩的上游语义 ──────────────────────────────────────
 *  1. `mode=raw` 只清空命中的**报文原文**（上游调试报文 + 下游正文），保留明细与日报；
 *     `mode=all` 连**明细**一起删。缺省是 `all`。
 *  2. **没有任何筛选时必须显式带 `all=1`**，否则 400
 *     「未指定筛选条件：要清空全部请求数据请显式带 all=1」——
 *     这是防误触的硬闸门，别在调用方"顺手补上"。
 *  3. 压缩是**后台任务**，POST 只表示「是否受理」（`{success, started:true}`，
 *     已在跑给 409，库不可用给 500）；进度靠本文件的预览读数轮询
 *     （`vacuumRunning` / `lastVacuum`）。
 */
import { apiCall } from './client'

/** 与列表同款的筛选参数（值都给字符串，未设的键不要传） */
export type RequestMaintenanceQuery = Record<string, string | undefined>

export type RequestClearPreview = {
  /** 命中的明细行数 */
  all?: number
  /** 两侧报文按 ID 去重的请求数 */
  raw?: number
  /** 上游调试报文行数 */
  upstreamRaw?: number
  /** 下游正文行数 */
  downstreamRaw?: number
  /** 主文件 + WAL 的全库占用（**不按筛选计算**） */
  dbBytes?: number
  /** 是否正在压缩（压缩进度靠它轮询） */
  vacuumRunning?: boolean
  /** 上次压缩完成时间 */
  lastVacuum?: number | null
}

export type RequestClearResult = {
  /** raw 模式 = 按 ID 去重的请求数；all 模式 = 明细行数 */
  deleted?: number
  raw?: number
  upstreamRaw?: number
  downstreamRaw?: number
}

export type RequestFilterOptions = {
  models?: string[]
  providers?: Array<{ id?: string; label?: string }>
}

function queryOf(params: RequestMaintenanceQuery): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue
    search.set(key, value)
  }
  return search.toString()
}

/** 筛选下拉的候选清单（来自**明细里实际出现过的值**，不是当前配置清单） */
export function fetchRequestFilterOptions(signal?: AbortSignal): Promise<RequestFilterOptions> {
  return apiCall<RequestFilterOptions>('/api/stats/requests/filters', { signal })
}

export function fetchRequestClearPreview(
  params: RequestMaintenanceQuery, signal?: AbortSignal,
): Promise<RequestClearPreview> {
  const suffix = queryOf(params)
  return apiCall<RequestClearPreview>(
    `/api/stats/requests/clear-preview${suffix ? `?${suffix}` : ''}`, { signal },
  )
}

/**
 * 执行清理。`params` 必须与预览时**同一份**（含 `all=1` 那条无筛选时的硬闸门）。
 */
export function clearRequests(
  params: RequestMaintenanceQuery, mode: 'raw' | 'all',
): Promise<RequestClearResult> {
  const suffix = queryOf({ ...params, mode })
  return apiCall<RequestClearResult>(`/api/stats/requests${suffix ? `?${suffix}` : ''}`, { method: 'DELETE' })
}

/** 压缩数据库（checkpoint + VACUUM）：只回收磁盘，不动数据 */
export function compactRequestsDb(): Promise<{ success?: boolean; started?: boolean }> {
  return apiCall('/api/stats/requests/compact', { method: 'POST' })
}

/** 字节数转可读文案（预览里显示"库占用"用） */
export function formatDbBytes(value: unknown): string {
  const bytes = Number(value)
  if (!Number.isFinite(bytes) || bytes <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let size = bytes
  let index = 0
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024
    index += 1
  }
  return `${size.toFixed(size >= 100 || index === 0 ? 0 : 1)} ${units[index]}`
}
