import { apiCall } from './client'

/**
 * 路由流量 / 请求回放（`api/routing_flow.rs`、`api/routing_trace.rs`）。
 *
 * ⚠️ **这一条容易搞错**：请求列表用的**不是** `/api/routing/replays`，而是
 * `GET /api/routing/flow` 加 `detail=requests`。桌面端 `routing-request-list.tsx`
 * 就是这么拉的（`getRoutingFlow({ ...query, detail: 'requests', offset, limit: 30 })`）；
 * `/api/routing/replays` 与 `/api/routing/trace`（带 `status` / `startDate` /
 * `endDate` 的那两条）是另一处「请求日志」形态的入口，不在这条回放链路上。
 *
 * 字段名与桌面壳 `bridge()` 的返回类型逐字一致（见 `ui-islands/src/islands/
 * routing-flow-types.ts` 的 `FlowQuery` / `FlowDetails`），所以类型可以直接当契约用。
 */

export type FlowScope = 'window' | 'running'
export type FlowDetail = 'sessions' | 'requests' | 'models'

/** 与桌面端 `FlowQuery` 同形；未给的字段不发 */
export type FlowQuery = {
  model?: string
  minutes: number
  scope: FlowScope
  search?: string
  /** 请求列表用 'requests'；模型候选用 'models' */
  detail: FlowDetail
  offset?: number
  limit?: number
}

export type FlowAttempt = {
  candidateId?: string
  memberId?: string
  provider?: string
  providerLabel?: string
  account?: string
  accountId?: string
  accountName?: string
  model?: string
  reasoning?: string
  reason?: string
  stickyHit?: boolean
  startedAt?: number | null
  responseAt?: number | null
  finishedAt?: number | null
  status?: number | null
  error?: string | null
  notice?: string | null
  bodyBytes?: number | null
  retries?: Array<{ reason?: string; status?: number | null; delayMs?: number }>
}

export type FlowDecisionEntry = {
  id: string
  name: string
  provider: string
  providerLabel?: string
  state: string
  reason: string
  resetAt?: number | null
  priority?: number
}

export type FlowRouteDecision = {
  strategy?: string
  sticky?: string
  stickyHit?: boolean
  picked?: string
  pickedCandidate?: string
  sessionId?: string
  orderedTotal?: number
  blockedTotal?: number
  ordered?: FlowDecisionEntry[]
  blocked?: FlowDecisionEntry[]
}

/** 一次请求（桌面端 `ReplayRow`） */
export type FlowRow = {
  traceKey?: string
  id: string
  ts: number
  model: string
  clientModel?: string
  upstreamModel?: string
  provider?: string
  providerLabel?: string
  accountId?: string
  accountName?: string
  client?: string
  clientLabel?: string
  /** 0 = 仍在处理中；2xx 且无 error = 成功 */
  status: number
  error?: string | null
  durationMs?: number
  attempts?: number
  attemptDetails?: FlowAttempt[]
  phase?: string
  phaseStartedAt?: number | null
  phaseElapsedMs?: number | null
  firstResponseMs?: number | null
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  cacheReadTokens?: number
  clientReasoning?: string
  upstreamReasoning?: string
  apiKeyName?: string
  apiKeyId?: string
  apiKeySource?: string
  isTest?: boolean
  route?: FlowRouteDecision | null
}

export type FlowDetails = {
  available?: boolean
  entries?: FlowRow[]
  matched?: number
  unknownRequests?: number
  now?: number
}

export type FlowModels = { available?: boolean; models?: string[] }

/**
 * 拉一次路由流量数据。
 *
 * `detail=requests` 时返回 `{ entries, matched, available }`；
 * `detail=models` 时返回 `{ models, available }`。两者共用这一个端点，所以这里
 * 用重载而不是两个函数 —— 参数与返回是一一对应的。
 */
export async function fetchRoutingFlow(query: FlowQuery & { detail: 'requests' }): Promise<FlowDetails>
export async function fetchRoutingFlow(query: FlowQuery & { detail: 'models' }): Promise<FlowModels>
export async function fetchRoutingFlow(query: FlowQuery): Promise<FlowDetails | FlowModels> {
  const params = new URLSearchParams()
  params.set('minutes', String(query.minutes))
  params.set('scope', query.scope)
  params.set('detail', query.detail)
  if (query.model) params.set('model', query.model)
  if (query.search) params.set('search', query.search)
  if (query.offset != null) params.set('offset', String(query.offset))
  if (query.limit != null) params.set('limit', String(query.limit))
  return apiCall<FlowDetails | FlowModels>(`/api/routing/flow?${params.toString()}`)
}

/**
 * 单次请求的完整明细（含每次尝试）。
 *
 * `ts` 一起带上：`id` 在库里不是唯一键（同一请求重放会复用 id），
 * 桌面端也是这么传的。
 */
export function fetchTraceRequest(query: { id: string; ts?: number }): Promise<FlowRow> {
  const params = new URLSearchParams()
  params.set('id', query.id)
  if (query.ts != null) params.set('ts', String(query.ts))
  return apiCall<FlowRow>(`/api/routing/trace/request?${params.toString()}`)
}
