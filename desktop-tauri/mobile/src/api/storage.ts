import { apiCall } from './client'

/**
 * 存储用量与数据保留（`docs/mobile-ui/contracts/DATA-SYSTEM.md`）。
 *
 *  · `GET /api/storage`：只读快照。**没有写路由**（旧的 relocate / progress 已删）。
 *  · `GET/PUT /api/retention`：五个保留策略，模块在 `api/stats_api.rs`（**不是** config_api.rs）。
 *    ⚠️ **PUT 之后网关会立刻裁剪**（`request_stats().prune()` + `LogStore::prune()`），
 *    超出新上限的历史数据当场删除、不可恢复 —— 所以保存前必须二次确认。
 */

export type StorageDatabase = {
  file?: string
  bytes?: number
  /** 库是否打开；false 时各计数都回落 0 */
  available?: boolean
  accounts?: number
  logs?: number
  requests?: number
  dailyDays?: number
  /** 与 upstreamRaw 同值的兼容字段 */
  debug?: number
  downstreamRaw?: number
  upstreamRaw?: number
}

export type StorageSnapshot = {
  configDir?: string
  database?: StorageDatabase
}

export const fetchStorage = () => apiCall<StorageSnapshot>('/api/storage')

export type RetentionSettings = {
  /** 事件日志保留天数，1–99999，默认 30 */
  logRetentionDays?: number
  /** 事件日志条数上限，1–100000000，默认 10000 */
  logRetentionCount?: number
  /** 请求日志保留天数，1–99999，默认 99999 */
  requestLogRetentionDays?: number
  /** 请求日志条数上限，1–100000000，默认 1000000 */
  requestLogRetentionCount?: number
  /** 按天聚合保留天数，1–99999，默认 99999 */
  dailyAggregateRetentionDays?: number
}

export const RETENTION_FIELDS = [
  { key: 'logRetentionDays', kind: 'days', fallback: 30 },
  { key: 'logRetentionCount', kind: 'count', fallback: 10000 },
  { key: 'requestLogRetentionDays', kind: 'days', fallback: 99999 },
  { key: 'requestLogRetentionCount', kind: 'count', fallback: 1000000 },
  { key: 'dailyAggregateRetentionDays', kind: 'days', fallback: 99999 },
] as const satisfies ReadonlyArray<{ key: keyof RetentionSettings; kind: 'days' | 'count'; fallback: number }>

export const RETENTION_LIMITS = {
  days: { min: 1, max: 99999 },
  count: { min: 1, max: 100000000 },
} as const

export const fetchRetention = () => apiCall<RetentionSettings>('/api/retention')
/** 部分更新：只发改动的键（`null` 表示该项不动） */
export const putRetention = (body: RetentionSettings) =>
  apiCall<RetentionSettings>('/api/retention', { method: 'PUT', body })
