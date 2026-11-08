import { apiCall } from './client'

/**
 * 转发行为设置（排队 / 重试 / 超时 / 图片压缩 / 兼容与排障）。
 *
 * 契约要点（`docs/mobile-ui/contracts/FORWARDING.md`，逐条来自上游 `server/src/server/api/*.rs`）：
 *
 *  · **响应信封**：管理面统一是 `{success:true,data:…}`，`apiCall` 已经解开，
 *    这里拿到的是 `data` 本身。
 *  · **写入语义**：`queue` / `retry` / `timeouts` 是**部分更新** —— 省略的键（含显式
 *    `null`）都表示「这一项不改」。所以保存时只发改过的键，不要把整份 draft 发出去。
 *  · **例外**：`/api/image-compress` 四项**不接受 null**（传 null 直接 400，
 *    源码注释写明「本 PUT 没有删掉这一项的语义」），没值就不发。
 *  · 两个布尔端点（`debugMode` / `developerRoleCompat`）是**必填**字段，
 *    且默认值都是「开」的解析口径是「只有字面 false 才算关」，别用 `!== true` 判断。
 */

// ── 排队等待（api/queue_api.rs）────────────────────────────────

export type QueueSettings = {
  /** 0–10，默认 2：同一账号最多排几次 */
  queueMaxWaits?: number
  /** 0–120，默认 0（跟随上游建议）：单次等待秒数 */
  queueWaitSeconds?: number
}

export const QUEUE_LIMITS = {
  queueMaxWaits: { min: 0, max: 10, fallback: 2 },
  queueWaitSeconds: { min: 0, max: 120, fallback: 0 },
} as const

export const fetchQueue = () => apiCall<QueueSettings>('/api/queue')
export const putQueue = (body: QueueSettings) => apiCall<QueueSettings>('/api/queue', { method: 'PUT', body })

// ── 重试（api/retry_api.rs）───────────────────────────────────

export type RetrySettings = {
  /** 0–10，默认 3：同一账号重试次数 */
  retryCount?: number
  /** 0–10，默认 5：键名是历史措辞，语义＝**切换账号**次数 */
  retryCrossProviderCount?: number
  /** 0–300，默认 5：重试间隔秒 */
  retryIntervalSeconds?: number
  /** 每项 100–599、最多 50 项，默认 [402]：命中就直接换号不重试 */
  noRetryStatusCodes?: number[]
}

export const RETRY_LIMITS = {
  retryCount: { min: 0, max: 10, fallback: 3 },
  retryCrossProviderCount: { min: 0, max: 10, fallback: 5 },
  retryIntervalSeconds: { min: 0, max: 300, fallback: 5 },
  statusCode: { min: 100, max: 599 },
  maxStatusCodes: 50,
} as const

export const fetchRetry = () => apiCall<RetrySettings>('/api/retry')
export const putRetry = (body: RetrySettings) => apiCall<RetrySettings>('/api/retry', { method: 'PUT', body })

// ── 超时（api/timeouts_api.rs）────────────────────────────────

export type TimeoutSettings = {
  /** 1–3600 秒，默认 30 */
  connectTimeoutSeconds?: number
  /** 1–3600 秒，默认 300 */
  headersTimeoutSeconds?: number
  /** 1–3600 秒，默认 300 */
  streamIdleTimeoutSeconds?: number
  /** 1–3600 秒，默认 300 */
  bodyTimeoutSeconds?: number
}

export const TIMEOUT_LIMITS = { min: 1, max: 3600 } as const
export const TIMEOUT_FALLBACK: Required<TimeoutSettings> = {
  connectTimeoutSeconds: 30,
  headersTimeoutSeconds: 300,
  streamIdleTimeoutSeconds: 300,
  bodyTimeoutSeconds: 300,
}

export const fetchTimeouts = () => apiCall<TimeoutSettings>('/api/timeouts')
export const putTimeouts = (body: TimeoutSettings) =>
  apiCall<TimeoutSettings>('/api/timeouts', { method: 'PUT', body })

// ── 图片压缩（api/image_compress.rs）──────────────────────────

export type ImageCompressSettings = {
  /** 默认**开**：解析口径是「只有字面 false 才算关」 */
  imageCompressEnabled?: boolean
  /** 256–8192，默认 2048：长边像素上限 */
  imageCompressMaxEdge?: number
  /** 40–95，默认 80：重编码质量 */
  imageCompressQuality?: number
  /** 0–10240，默认 512：超过这个大小才压缩 */
  imageCompressThresholdKb?: number
}

export const IMAGE_COMPRESS_LIMITS = {
  imageCompressMaxEdge: { min: 256, max: 8192, fallback: 2048 },
  imageCompressQuality: { min: 40, max: 95, fallback: 80 },
  imageCompressThresholdKb: { min: 0, max: 10240, fallback: 512 },
} as const

export const fetchImageCompress = () => apiCall<ImageCompressSettings>('/api/image-compress')
/** 注意：四项都不接受 null，调用方要先把 undefined 剔掉 */
export const putImageCompress = (body: ImageCompressSettings) =>
  apiCall<ImageCompressSettings>('/api/image-compress', { method: 'PUT', body })

// ── 兼容与排障 ────────────────────────────────────────────────

/** 开发者角色兼容（api/role_compat.rs）：转发前把 developer 角色转成 system */
export type RoleCompatSettings = { developerRoleCompat?: boolean }
export const fetchRoleCompat = () => apiCall<RoleCompatSettings>('/api/developer-role-compat')
export const putRoleCompat = (developerRoleCompat: boolean) =>
  apiCall<RoleCompatSettings>('/api/developer-role-compat', { method: 'PUT', body: { developerRoleCompat } })

/** 调试模式（api/debug_api.rs）：保存上游原始报文；count/limit 是只读概况 */
export type DebugSettings = {
  debugMode?: boolean
  /** 已保存的报文条数（只读） */
  count?: number
  /** 容量上限（只读，500） */
  limit?: number
}
export const fetchDebug = () => apiCall<DebugSettings>('/api/debug')
export const putDebug = (debugMode: boolean) =>
  apiCall<DebugSettings>('/api/debug', { method: 'PUT', body: { debugMode } })

// ── 只发改动的键 ──────────────────────────────────────────────

/**
 * 从 draft 里挑出与 baseline 不同的键。
 *
 * 这几个端点都是「省略 = 不改」，所以只发差异既省一次无谓写盘，也避免
 * 用本地默认值覆盖服务端（服务端可能有我们不知道的当前值）。
 */
export function changedKeys<T extends object>(draft: T, baseline: T): Partial<T> {
  const patch: Partial<T> = {}
  for (const key of Object.keys(draft) as Array<keyof T>) {
    const next = draft[key]
    const before = baseline[key]
    if (Array.isArray(next) || Array.isArray(before)) {
      if (JSON.stringify(next ?? null) !== JSON.stringify(before ?? null)) patch[key] = next
      continue
    }
    if (next !== before) patch[key] = next
  }
  return patch
}
