/**
 * 账号限流器的写入口。
 *
 * 只一个动作：把**整组规则**放进账号的 `limiterGroups` 交给 PATCH。
 *
 * ── 为什么是 PATCH 账号而不是一个专门的 limiter 接口 ──────────
 * 上游毕业后端把限流规则当作账号记录的一个字段（`store_crud.rs` 里
 * `patch.get("limiterGroups")` → `record.set("limiterGroups", next)`），
 * 所以写它就走账号 PATCH —— 与改备注名（`renameAccount`）同一条路。
 * 同一请求里 `limiters`（旧）与 `limiterGroups`（新）都在时，**新的胜出**。
 *
 * ── 稀疏还是整表 ─────────────────────────────────────────────
 * PATCH 只改传进去的键：传 `limiterGroups` 就是**整块替换这一项**，
 * 账号的其它字段不受影响。所以界面必须发**完整的一组规则**（不是增量），
 * 这也是为什么编辑面板始终持有整份草稿。
 */
import { apiCall } from './client'
import type { LimiterGroup } from '../lib/limiter'

export type AccountLimiterPatch = {
  limiterGroups: LimiterGroup[]
}

/** 保存这个账号的全部限流规则（`PATCH /api/accounts/{id}`） */
export function saveLimiterGroups(id: string, groups: LimiterGroup[]): Promise<unknown> {
  return apiCall(`/api/accounts/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: { limiterGroups: groups } satisfies AccountLimiterPatch,
  })
}
