/**
 * 账号限流器（limiter groups）：类型 + 只读换算。
 *
 * ── 这些是从桌面端 `ui-islands/src/islands/accounts-limiter-model.ts` 移植的 ──
 * 那份逻辑是纯函数（只有标签与换算），但它在**桌面 islands 目录**里，手机端 import
 * 不到。所以这里照搬一份，并用同一批中文文案作为 i18n key（两端显示同名同句）。
 * 若将来把它上移到 `ui-shared`，手机端应改为 import，别再各留一份。
 *
 * ── 数据从哪来（两条，别混）──────────────────────────────────
 *  1. **规则本身**在账号记录里：`limiterGroups`（新，权威）/ `limiters`（旧，转换后读）。
 *     账号列表与快照里都带着它，所以**不需要为读规则单独打接口**。
 *  2. **实时读数**在用量快照里（`GET /api/accounts/usage/snapshot`）：
 *     `limiterStates`（按账号的命中/读数）、`quotaSources`（按账号的额度来源）、
 *     `limiterModels`（按 provider 的模型清单，给条件选模型用）。
 *     只读记录表、不打上游 —— 所以可以随手拉。
 */
import { useSyncExternalStore } from 'react'
import { isCreditUnit, usageUnitLabel } from '../../../ui-shared/usage-readings'
import { t } from '../i18n'

export type LimiterJoin = 'and' | 'or'
export type LimiterMetric = 'remaining' | 'remaining_percent' | 'used' | 'used_percent' | 'tokens' | 'requests'
export type LimiterComparison = 'lt' | 'lte' | 'gte'

export type LimiterWindow = {
  reset: 'fixed' | 'rolling' | 'daily' | 'weekly' | 'monthly' | 'total'
  seconds?: number
  startsAt?: number
  endsAt?: number
  utcOffsetMinutes?: number | null
}

export type QuotaSource = {
  id: string
  label: string
  provider?: string
  channel?: string
  planId?: string
  planName?: string
  models?: string[]
  unit?: string
  remaining?: number | null
  total?: number | null
  used?: number | null
  remainingPercent?: number | null
  startsAt?: number
  endsAt?: number
  resetsAt?: number
  window?: LimiterWindow | null
  unlimited?: boolean
  localEstimate?: boolean
  localOnly?: boolean
}

export type LimiterCondition = {
  join: LimiterJoin
  sourceId: string
  source?: QuotaSource | null
  models: string[]
  metric: LimiterMetric
  comparison: LimiterComparison
  threshold: number
  window?: LimiterWindow | null
}

export type LimiterGroup = {
  enabled: boolean
  action: 'skip' | 'disable'
  target: 'models' | 'account'
  conditions: LimiterCondition[]
}

/** 旧格式的一条规则（记录上的 `limiters`） */
export type LimiterRule = {
  enabled?: boolean
  action: 'skip' | 'disable'
  type: 'balance' | 'token'
  threshold: number
  reset?: string
  period?: number
}

export type LimiterReading = {
  known: boolean
  value: number | null
  hit: boolean
  local: boolean
  models: string[]
  modelValues: Record<string, number>
  windowStart: number
  resetsAt: number
  reason: string
}

export type LimiterGroupState = {
  hit: boolean
  readings?: LimiterReading[]
}

/** 账号记录里与限流相关的字段（手机端的 Account 类型没写全，这里补齐） */
export type LimiterAccountFields = {
  id?: string
  provider?: string
  limiterGroups?: LimiterGroup[]
  limiters?: LimiterRule[]
}

/** 用量快照里与限流相关的字段 */
export type LimiterSnapshot = {
  tokenAt?: number
  limiterStates?: Record<string, LimiterGroupState[]>
  quotaSources?: Record<string, QuotaSource[]>
  limiterModels?: Record<string, Array<{ id: string; name?: string }>>
}

/* ── 快照（模块级，与桌面端同构：读数来自快照，规则来自账号记录）── */

let snapshot: LimiterSnapshot = {}
const listeners = new Set<() => void>()

export function adoptLimiterSnapshot(next: LimiterSnapshot | null | undefined): void {
  if (!next?.limiterStates && !next?.quotaSources && !next?.limiterModels) return
  const changed = JSON.stringify([snapshot.limiterStates, snapshot.quotaSources, snapshot.limiterModels])
    !== JSON.stringify([next.limiterStates, next.quotaSources, next.limiterModels])
  snapshot = {
    tokenAt: next.tokenAt,
    limiterStates: next.limiterStates,
    quotaSources: next.quotaSources,
    limiterModels: next.limiterModels,
  }
  if (changed) listeners.forEach(listener => listener())
}

/** 让界面在快照变化时重渲染（读数/模型清单都是从快照读的） */
export function useLimiterSnapshot(): LimiterSnapshot {
  return useSyncExternalStore(
    listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => snapshot,
    () => snapshot,
  )
}

/* ── 规则读取 ── */

export function groupsOf(account: LimiterAccountFields | null | undefined, legacy: LimiterRule[] = []): LimiterGroup[] {
  if (Array.isArray(account?.limiterGroups)) return account.limiterGroups
  return legacy.map(rule => ({
    enabled: rule.enabled !== false, action: rule.action, target: 'account',
    conditions: [{
      join: 'or', sourceId: '', models: [], threshold: rule.threshold,
      metric: rule.type === 'balance' ? 'remaining' : 'tokens',
      comparison: rule.type === 'balance' ? 'lt' : 'gte',
      ...(rule.type === 'token'
        ? { window: { reset: rule.reset === 'daily' ? 'daily' : 'fixed', seconds: rule.period || 0 } as LimiterWindow }
        : {}),
    }],
  }))
}

export function sourcesOf(account: LimiterAccountFields | null | undefined): QuotaSource[] {
  const sources = account ? snapshot.quotaSources?.[String(account.id || '')] : undefined
  return Array.isArray(sources) ? sources.slice() : [
    { id: 'account', label: t('账号主额度'), provider: String(account?.provider || '') },
    { id: 'local', label: t('本地用量保护'), provider: String(account?.provider || ''), localOnly: true },
  ]
}

export function modelsOf(account: LimiterAccountFields | null | undefined): Array<{ value: string; label: string }> {
  const provider = String(account?.provider || '')
  const models = snapshot.limiterModels?.[provider] || []
  return models.map(model => ({
    value: model.id,
    label: model.name && model.name !== model.id ? `${model.name}（${model.id}）` : model.id,
  }))
}

export function statesOf(account: LimiterAccountFields | null | undefined): LimiterGroupState[] {
  return account ? snapshot.limiterStates?.[String(account.id || '')] || [] : []
}

/* ── 文案 ── */

export function metricLabel(metric: LimiterMetric | string): string {
  switch (metric) {
    case 'remaining': return t('剩余额度')
    case 'remaining_percent': return t('剩余比例')
    case 'used': return t('已用额度')
    case 'used_percent': return t('已用比例')
    case 'tokens': return t('本地 Token 消耗')
    case 'requests': return t('本地请求次数')
    default: return t('全部模型')
  }
}

export function sourceLabel(source: QuotaSource | null | undefined, id = source?.id || 'account'): string {
  if (id === 'local') return t('本地用量保护')
  if (id === 'account' || !id) return isCreditUnit(source?.unit || '') ? t('总积分') : t('账号主额度')
  return source?.label ? t(source.label) : t('账号主额度')
}

export function tokenCount(value: number): string {
  const api = (window as unknown as { wbUnits?: { formatTokens?: (value: number) => string } }).wbUnits
  return api?.formatTokens?.(value) || value.toLocaleString()
}

/** 一条条件的可读描述：`来源 · 模型 · 指标 符号 阈值 单位` */
export function conditionText(condition: LimiterCondition, account?: LimiterAccountFields): string {
  const id = condition.sourceId
    || (condition.metric === 'tokens' || condition.metric === 'requests' ? 'local' : 'account')
  const current = sourcesOf(account).find(source => source.id === id)
  const source = sourceLabel(current || condition.source, id)
  const models = condition.models.length ? condition.models.join('、') : t('全部模型')
  const metric = metricLabel(condition.metric)
  const sign = condition.comparison === 'lt' ? '<' : condition.comparison === 'lte' ? '≤' : '≥'
  const unit = condition.metric.endsWith('percent') ? '%' : condition.metric === 'tokens' ? 'Token'
    : condition.metric === 'requests' ? t('次') : usageUnitLabel(current?.unit || condition.source?.unit || '', t)
  const quota = condition.metric === 'tokens' ? tokenCount(condition.threshold) : String(condition.threshold)
  return `${source} · ${models} · ${metric} ${sign} ${quota} ${unit}`.trim()
}

/** 整组的可读表达式：`A 与 B 或 C` */
export function expressionText(conditions: LimiterCondition[], account?: LimiterAccountFields): string {
  const terms: string[][] = []
  conditions.forEach((condition, index) => {
    if (index === 0 || condition.join === 'or') terms.push([])
    terms[terms.length - 1].push(conditionText(condition, account))
  })
  return terms.map(term => term.length > 1 ? `（${term.join(` ${t('与')} `)}）` : term[0])
    .join(` ${t('或')} `)
}

export function readingText(
  reading: LimiterReading | undefined, condition: LimiterCondition, account?: LimiterAccountFields,
): string {
  if (!reading?.known || reading.value === null) return readingReason(reading?.reason)
  const source = sourcesOf(account).find(item => item.id === (condition.sourceId || 'account'))
  const unit = usageUnitLabel(source?.unit || condition.source?.unit || '', t)
  const format = (value: number) => condition.metric === 'tokens' ? `${tokenCount(value)} Token`
    : condition.metric.endsWith('percent') ? `${Number(value.toFixed(2))}%`
      : `${Number(value.toFixed(2))} ${condition.metric === 'requests' ? t('次') : unit}`.trim()
  const models = Object.entries(reading.modelValues || {})
  return models.length ? models.map(([model, value]) => `${model}：${format(value)}`).join(' · ') : format(reading.value)
}

function readingReason(reason: string | undefined): string {
  switch (reason) {
    case '此额度不属于账号当前使用的通道': return t('此额度不属于账号当前使用的通道')
    case '套餐尚未生效或已经到期': return t('套餐尚未生效或已经到期')
    case '上游额度无上限': return t('上游额度无上限')
    case '统计周期尚未开始或已经结束': return t('统计周期尚未开始或已经结束')
    default: return t('暂无读数')
  }
}

export function windowLabel(window: LimiterWindow | null | undefined): string {
  if (!window) return t('不限窗口')
  switch (window.reset) {
    case 'daily': return t('每天')
    case 'weekly': return t('每周')
    case 'monthly': return t('每月')
    case 'total': return t('累计')
    case 'rolling': return t('滚动 {seconds} 秒', { seconds: Number(window.seconds) || 0 })
    default: return window.seconds ? t('固定 {seconds} 秒', { seconds: window.seconds }) : t('固定')
  }
}

/** 新增条件时的默认值（与上游/桌面端的缺省一致：账号主额度的剩余额度 < 0 就跳过） */
export function defaultCondition(): LimiterCondition {
  return { join: 'or', sourceId: '', models: [], metric: 'remaining', comparison: 'lt', threshold: 0, window: null }
}
