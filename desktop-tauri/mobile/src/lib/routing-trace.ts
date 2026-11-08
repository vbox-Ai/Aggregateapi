import { t } from '../i18n'
import { formatDuration } from './format'
import type { FlowAttempt, FlowDecisionEntry, FlowRow } from '../api/routing-flow'

/**
 * 请求回放的展示语义。
 *
 * 逐条对应桌面端 `ui-islands/src/islands/routing-trace-model.ts` —— 这不是可有可无的
 * 重复：**判据本身是有口径的**，比如「进行中」是 `status === 0 && error == null`，
 * 「成功」还要额外要求 `error == null`（有些上游会回 200 但 body 里是错误）。
 * 各自实现一份就会出现「手机说成功、桌面说失败」。
 */

export type TraceState = 'running' | 'success' | 'failed' | 'unknown'

export type TraceAttempt = FlowAttempt & { index: number; inferred?: boolean }

export type TraceCandidate = FlowDecisionEntry & { kind: 'available' | 'skipped' }

/** 一次请求的唯一键：`traceKey` 优先，否则 `id:ts`（同 id 可能有多条） */
export const requestKey = (row: FlowRow): string => row.traceKey || `${row.id}:${row.ts}`

export const requestModel = (row: FlowRow): string => row.clientModel || row.model || t('模型未记录')

export const isTraceRunning = (row: FlowRow): boolean => row.status === 0 && row.error == null

export const isTraceSuccess = (row: FlowRow): boolean =>
  row.status >= 200 && row.status < 300 && row.error == null

export const traceProvider = (id?: string, label?: string): string =>
  label || id || t('提供商未记录')

/**
 * 尝试列表。
 *
 * 没有保存完整明细时**回退成一条「推断」尝试**（用请求记录里那个承载账号），
 * 而不是显示「没有尝试」—— 老记录（升级前）本来就不带 `attemptDetails`，
 * 直接留空会让用户以为请求没发生过。
 */
export function traceAttempts(row: FlowRow): TraceAttempt[] {
  const entries = Array.isArray(row.attemptDetails) ? row.attemptDetails : []
  if (entries.length) return entries.map((entry, index) => ({ ...entry, index }))
  if (!row.provider && !row.accountId && !row.upstreamModel) return []
  return [
    {
      index: Math.max(0, (row.attempts || 1) - 1),
      provider: row.provider,
      accountId: row.accountId,
      account: row.accountName,
      model: row.upstreamModel,
      inferred: true,
    },
  ]
}

/** 当时的候选队列快照：已尝试的**仍然留在这里**（尝试明细另记），否则会出现「1 个候选但列表为空」 */
export function traceCandidates(row: FlowRow): TraceCandidate[] {
  const ordered = Array.isArray(row.route?.ordered) ? row.route!.ordered! : []
  const blocked = Array.isArray(row.route?.blocked) ? row.route!.blocked! : []
  const seen = new Set<string>()
  return [
    ...ordered.map(entry => ({ ...entry, kind: 'available' as const })),
    ...blocked.map(entry => ({ ...entry, kind: entry.state === 'tried' ? ('available' as const) : ('skipped' as const) })),
  ].filter(entry => {
    const key = (entry as { candidateId?: string }).candidateId || `${entry.id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function lastAttemptIndex(row: FlowRow): number {
  const entries = traceAttempts(row)
  return entries.length ? Math.max(...entries.map(item => item.index)) : 0
}

export function attemptState(row: FlowRow, attempt: TraceAttempt): TraceState {
  const isLast = attempt.index === lastAttemptIndex(row) && (attempt.index + 1 >= (row.attempts || 1) || attempt.inferred === true)
  if (attempt.error || (attempt.status != null && (attempt.status < 200 || attempt.status >= 300))) return 'failed'
  if (isLast && isTraceRunning(row)) return 'running'
  if (isLast && !isTraceSuccess(row)) {
    return attempt.finishedAt != null || attempt.responseAt != null ? 'failed' : 'unknown'
  }
  if (attempt.status != null || attempt.responseAt != null || (isLast && isTraceSuccess(row))) return 'success'
  return 'unknown'
}

export function attemptLabel(row: FlowRow, attempt: TraceAttempt): string {
  const state = attemptState(row, attempt)
  if (state === 'running') return tracePhase(row.phase)
  if (state === 'failed') return t('尝试失败')
  if (state === 'success') return attempt.index + 1 >= (row.attempts || 1) ? t('最终承载') : t('上游已响应')
  return t('结果未记录')
}

export function tracePhase(phase?: string): string {
  return phase === 'waiting'
    ? t('等待响应')
    : phase === 'streaming'
      ? t('响应中')
      : phase === 'retrying'
        ? t('重试中')
        : phase === 'queued'
          ? t('排队中')
          : phase === 'connecting'
            ? t('连接中')
            : t('进行中')
}

export function attemptDuration(row: FlowRow, attempt: TraceAttempt): string {
  if (attempt.startedAt != null && attempt.finishedAt != null) {
    return formatDuration(Math.max(0, attempt.finishedAt - attempt.startedAt))
  }
  if (attemptState(row, attempt) === 'running') return t('进行中')
  return t('耗时未记录')
}

/** 相对请求起点的时间（+1.2s 这种） */
export function relativeTime(row: FlowRow, time?: number | null): string {
  return time != null ? formatDuration(Math.max(0, time - row.ts)) : t('未记录')
}

/** 上游错误常带整段 HTML：摘要只留可读文字，原文留给「展开完整原因」 */
export function errorText(value?: string | null, limit = 0): string {
  const plain = (value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  return limit > 0 && plain.length > limit ? `${plain.slice(0, limit)}…` : plain
}

/** 一句话讲清这次请求发生了什么（列表与详情顶部共用） */
export function requestSummary(row: FlowRow): string {
  const switches = Math.max(0, (row.attempts || 1) - 1)
  if (isTraceRunning(row)) return t('请求仍在处理中，当前阶段：{phase}', { phase: tracePhase(row.phase) })
  if (!isTraceSuccess(row)) return errorText(row.error, 180) || t('请求未成功完成')
  if (switches) {
    return t('经过 {n} 次切换后成功，最终承载：{account}', {
      n: switches,
      account: row.accountName || traceProvider(row.provider, row.providerLabel),
    })
  }
  if (row.route?.stickyHit) return t('命中会话粘性，沿用原账号完成请求')
  return t('请求成功完成，未发生账号切换')
}

export function candidateReason(row: FlowRow, candidate: TraceCandidate): string {
  if (candidate.kind === 'skipped') return candidate.reason || t('当时被候选过滤规则跳过')
  if (isTraceRunning(row)) return t('当时可用，当前请求尚未轮到这个账号')
  if (isTraceSuccess(row)) return t('其他账号已完成请求，没有继续调用这个候选')
  return t('候选快照中有此账号，但保存的尝试明细未显示它被调用')
}

/** token 读数：没记录时显示「未记录」，而不是 0（0 是「确实用了 0」） */
export function traceTokens(value?: number): string {
  if (value == null) return t('未记录')
  return value.toLocaleString()
}
