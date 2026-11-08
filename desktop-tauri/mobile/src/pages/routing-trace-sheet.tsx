import { useEffect, useState } from 'react'
import { Button, Card, Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@ui'
import { Badge, Empty, ErrorNote, SectionHead } from '../components/ui'
import { Icon } from '../components/Icon'
import { serverIdentity } from '../lib/servers'
import { formatClock, formatDuration, formatInt } from '../lib/format'
import { t } from '../i18n'
import { fetchTraceRequest, type FlowRow } from '../api/routing-flow'
import {
  attemptDuration,
  attemptLabel,
  attemptState,
  candidateReason,
  errorText,
  isTraceRunning,
  isTraceSuccess,
  relativeTime,
  requestModel,
  requestSummary,
  traceAttempts,
  traceCandidates,
  tracePhase,
  traceProvider,
  traceTokens,
} from '../lib/routing-trace'

/**
 * 单次请求明细（点开请求回放列表里的一行）。
 *
 * 这一屏回答的是「网关到底试了谁、为什么失败」——三个部分：
 *   ① 结果摘要（一句话，含错误原文）；
 *   ② **每次尝试**的时间线：账号 / 状态码 / 耗时 / 是否最终承载 / 同账号内部重试；
 *   ③ 当时的**候选队列快照**：哪些可用、哪些被跳过、跳过原因。
 *
 * ③ 是这份数据最不可替代的地方：事后只看失败原因，分不清「没候选」和「候选被规则刷掉了」。
 *
 * 没有保存完整尝试明细的老记录会用请求记录里那个承载账号**推断出一条**，
 * 并明确标注是推断（桌面端同一口径，见 `routing-trace.ts` 的说明）。
 */
export function RoutingTraceSheet({
  row,
  onClose,
}: {
  row: FlowRow
  onClose: () => void
}) {
  const identity = serverIdentity()
  const [detail, setDetail] = useState<FlowRow>(row)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState<Record<number, boolean>>({})

  useEffect(() => {
    let alive = true
    const load = async () => {
      setLoading(true)
      try {
        // 带 ts：id 不是唯一键（同一请求重放会复用 id）
        const next = await fetchTraceRequest({ id: row.id, ts: row.ts })
        if (!alive || serverIdentity() !== identity) return
        setDetail(next || row)
        setError('')
      } catch (cause) {
        if (alive && serverIdentity() === identity) {
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      } finally {
        if (alive && serverIdentity() === identity) setLoading(false)
      }
    }
    void load()
    return () => { alive = false }
  }, [row.id, row.ts, identity])

  const running = isTraceRunning(detail)
  const success = isTraceSuccess(detail)
  const attempts = traceAttempts(detail)
  const candidates = traceCandidates(detail)
  const clientLabel = detail.clientLabel || detail.client || t('客户端未记录')

  return (
    <Sheet open onOpenChange={open => { if (!open) onClose() }}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{t('请求明细')}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          {error ? <ErrorNote text={error} /> : null}

          {/* 结果摘要 */}
          <Card className='m-card m-card-pad'>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <Badge tone={running ? 'warn' : success ? 'ok' : 'bad'}>
                {running ? tracePhase(detail.phase) : success ? String(detail.status) : detail.status ? `${detail.status} · ${t('失败')}` : t('失败')}
              </Badge>
              {detail.isTest ? <Badge tone='mute'>{t('测试请求')}</Badge> : null}
              {detail.route?.stickyHit ? <Badge tone='mute'>{t('粘滞命中')}</Badge> : null}
            </div>
            <div className='m-mono' style={{ fontSize: 12.5, wordBreak: 'break-all', marginBottom: 4 }}>
              {requestModel(detail)}
            </div>
            <div style={{ fontSize: 12, color: 'var(--m-text-2)', lineHeight: 1.7 }}>
              {requestSummary(detail)}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.7, marginTop: 6 }}>
              {formatClock(detail.ts)} · {clientLabel} · {traceProvider(detail.provider, detail.providerLabel)}
              {detail.durationMs != null ? ` · ${formatDuration(detail.durationMs)}` : ''}
              {detail.totalTokens != null ? ` · ${traceTokens(detail.totalTokens)} tokens` : ''}
            </div>
          </Card>

          {/* 每次尝试 */}
          <div className='m-section' style={{ marginTop: 14 }}>
            <SectionHead title={t('每次尝试（{n}）', { n: attempts.length })} />
            {loading && !attempts.length ? (
              <Card className='m-card'><Empty text={t('正在读取请求明细…')} /></Card>
            ) : null}
            {attempts.length ? (
              <Card className='m-card'>
                {attempts.map(attempt => {
                  const state = attemptState(detail, attempt)
                  const name = attempt.account || attempt.accountName || attempt.accountId || t('账号未记录')
                  const detailText = errorText(attempt.error || attempt.notice)
                  const isOpen = expanded[attempt.index] === true
                  return (
                    <div key={attempt.index} style={{ padding: '11px 14px', borderTop: attempt.index ? '1px solid var(--m-line)' : undefined }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className='m-logo' style={{ flex: 'none' }}>
                          <Icon name={state === 'failed' ? 'alert' : state === 'running' ? 'clock' : 'check'} />
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className='m-t1' style={{ fontSize: 12.5 }}>
                            {t('尝试 {n}', { n: attempt.index + 1 })} · {traceProvider(attempt.provider, attempt.providerLabel)}
                          </div>
                          <div className='m-t2' style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {name}{attempt.model ? ` · ${attempt.model}` : ''}
                          </div>
                        </div>
                        <div style={{ flex: 'none', textAlign: 'right' }}>
                          <div className='m-mono' style={{ fontSize: 11.5 }}>
                            {attempt.status != null ? `${attempt.status} · ` : ''}{attemptDuration(detail, attempt)}
                          </div>
                          <div style={{ fontSize: 10.5, color: 'var(--m-text-3)' }}>{attemptLabel(detail, attempt)}</div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 11, color: 'var(--m-text-3)', marginTop: 6 }}>
                        {attempt.stickyHit ? <span>{t('粘滞命中')}</span> : null}
                        {attempt.responseAt != null ? <span>{t('响应到达')} +{relativeTime(detail, attempt.responseAt)}</span> : null}
                        {attempt.startedAt != null ? <span>{t('开始于 +{time}', { time: relativeTime(detail, attempt.startedAt) })}</span> : null}
                        {attempt.bodyBytes != null ? <span>{formatInt(attempt.bodyBytes)} B</span> : null}
                      </div>

                      {attempt.inferred ? (
                        <p style={{ fontSize: 11, color: 'var(--m-text-3)', lineHeight: 1.7, marginTop: 4 }}>
                          {t('未保存完整尝试明细，仅显示请求记录中的承载信息。')}
                        </p>
                      ) : null}

                      {attempt.reason ? (
                        <p style={{ fontSize: 11.5, color: 'var(--m-text-2)', lineHeight: 1.7, marginTop: 4 }}>{attempt.reason}</p>
                      ) : null}

                      {detailText ? (
                        <div style={{ marginTop: 6 }}>
                          <p style={{ fontSize: 11.5, color: 'var(--m-danger)', lineHeight: 1.7, margin: 0 }}>
                            {errorText(detailText, 180)}
                          </p>
                          {detailText.length > 180 ? (
                            <>
                              <Button size='sm' variant='ghost' type='button' onClick={() => setExpanded({ ...expanded, [attempt.index]: !isOpen })}>
                                {isOpen ? t('收起') : t('展开完整原因')}
                              </Button>
                              {isOpen ? (
                                <p className='m-mono' style={{ fontSize: 11, color: 'var(--m-text-2)', lineHeight: 1.6, wordBreak: 'break-all', whiteSpace: 'pre-wrap', margin: '4px 0 0' }}>
                                  {detailText}
                                </p>
                              ) : null}
                            </>
                          ) : null}
                        </div>
                      ) : null}

                      {attempt.retries?.length ? (
                        <div style={{ marginTop: 6 }}>
                          <div style={{ fontSize: 11, color: 'var(--m-text-3)' }}>
                            {t('同账号内部重试')} · {attempt.retries.length}
                          </div>
                          {attempt.retries.map((retry, index) => (
                            <p key={index} className='m-mono' style={{ fontSize: 11, color: 'var(--m-text-2)', lineHeight: 1.7, margin: '2px 0 0' }}>
                              {retry.status ?? '—'} · {retry.reason || t('未知原因')} · {t('退避 {time}', { time: formatDuration(retry.delayMs) })}
                            </p>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </Card>
            ) : (
              <Card className='m-card'><Empty text={t('这条记录没有可用的尝试明细。')} /></Card>
            )}
          </div>

          {/* 当时的候选队列 */}
          {candidates.length ? (
            <div className='m-section' style={{ marginTop: 14 }}>
              <SectionHead title={t('当时的候选队列（{n}）', { n: candidates.length })} />
              <Card className='m-card'>
                {candidates.map((candidate, index) => (
                  <div key={`${candidate.id}-${index}`} style={{ padding: '10px 14px', borderTop: index ? '1px solid var(--m-line)' : undefined }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className='m-mono' style={{ fontSize: 11, color: 'var(--m-text-3)', flex: 'none', width: 26 }}>
                        #{candidate.id}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className='m-t1' style={{ fontSize: 12.5 }}>{candidate.name || candidate.id}</div>
                        <div className='m-t2'>{traceProvider(candidate.provider, candidate.providerLabel)}</div>
                      </div>
                      <Badge tone={candidate.kind === 'skipped' ? 'warn' : 'mute'}>
                        {candidate.kind === 'skipped' ? t('被跳过') : t('可用')}
                      </Badge>
                    </div>
                    <p style={{ fontSize: 11, color: 'var(--m-text-3)', lineHeight: 1.7, margin: '4px 0 0' }}>
                      {candidateReason(detail, candidate)}
                    </p>
                  </div>
                ))}
              </Card>
            </div>
          ) : null}

          {/* 策略快照 */}
          {detail.route?.strategy || detail.route?.sticky ? (
            <div className='m-section' style={{ marginTop: 14 }}>
              <SectionHead title={t('当时的策略')} />
              <Card className='m-card'>
                <div className='m-row'>
                  <span className='m-k'>{t('选路策略')}</span>
                  <span className='m-v m-mono'>{detail.route?.strategy || '—'}</span>
                </div>
                <div className='m-row'>
                  <span className='m-k'>{t('会话粘滞')}</span>
                  <span className='m-v m-mono'>{detail.route?.sticky || '—'}</span>
                </div>
                <div className='m-row'>
                  <span className='m-k'>{t('候选 / 跳过')}</span>
                  <span className='m-v m-mono'>
                    {formatInt(detail.route?.orderedTotal ?? candidates.length)} / {formatInt(detail.route?.blockedTotal ?? 0)}
                  </span>
                </div>
              </Card>
            </div>
          ) : null}
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}
