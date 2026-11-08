import { apiCall } from './client'

/**
 * 账号路由设置（`api/routing_api.rs`）。
 *
 * 与 `/api/timeouts` 同一模式：独立端点、允许部分字段、返回生效后的全量值、
 * 保存后对下一个请求立即生效（转发层逐请求读内存快照，不读盘）。
 */

export type RoutingStrategy = 'order' | 'rotate' | 'provider'
export type RoutingSticky = 'off' | 'on'

export type RoutingSettings = {
  strategy: RoutingStrategy
  sticky: RoutingSticky
  failoverBackoff: number
  sink?: string
  breakerEnabled?: boolean
  breakerThreshold?: number
  breakerTimeout?: number
  breakerSuccess?: number
}

export type RoutingPatch = Partial<Pick<RoutingSettings, 'strategy' | 'sticky' | 'failoverBackoff'>>

/** 读生效的路由设置 */
export function fetchRouting(): Promise<RoutingSettings> {
  return apiCall<RoutingSettings>('/api/routing')
}

/** 部分字段更新：不给的键不动 */
export function putRouting(patch: RoutingPatch): Promise<RoutingSettings> {
  return apiCall<RoutingSettings>('/api/routing', { method: 'PUT', body: patch })
}

/**
 * 队列可见化：按当前策略，这个模型的候选账号会怎么排、谁被跳过、为什么。
 *
 * `model` 省略（或空）时按「不限模型」的全局队列展开。
 * 排序实现与转发选路是同一个函数（`routing::plan_route`）——
 * 界面画的顺序和实际转发顺序不会分叉。
 */
export function fetchRoutingQueue(model?: string): Promise<RoutingQueue> {
  const query = model ? `?model=${encodeURIComponent(model)}` : ''
  return apiCall<RoutingQueue>(`/api/routing/queue${query}`)
}

export type RoutingQueueEntry = {
  id: string
  name?: string
  provider?: string
  reason?: string
}

export type RoutingQueue = {
  strategy: string
  sticky: string
  model: string | null
  modelKnown?: boolean
  lastRequestModel?: string
  pickedId?: string
  ordered: RoutingQueueEntry[]
  blocked: RoutingQueueEntry[]
}
