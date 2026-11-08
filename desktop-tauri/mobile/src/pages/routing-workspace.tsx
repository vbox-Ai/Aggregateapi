import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Label, SegmentedControl, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@ui'
import { Badge, Empty, ErrorNote, SectionHead } from '../components/ui'
import { usePullToRefresh, PullIndicator } from '../components/PullToRefresh'
import { serverIdentity } from '../lib/servers'
import { formatExpiry, formatInt, formatDuration, formatPercent } from '../lib/format'
import { providerLabel } from '../lib/providers'
import { t } from '../i18n'
import { apiCall } from '../api/client'
import type { RoutingSettings } from '../api/routing'

/**
 * 工作空间：此刻的路由状态（只读）。
 *
 * 数据源 `GET /api/routing/workspace?model=`（**不传 model = 全局**）。
 * 这一屏回答三个问题：谁在参与、谁被限额、现在队列打头的是谁。
 *
 * ── 参与度判据是照抄的，不是自创的 ────────────────────────────
 * 桌面端 `routing-config-panel.tsx` 里那两行：
 *   全局（未选模型）：账号自己 `enabled !== false` 就算参与；
 *   按模型：提供商要在范围内（`providerScope === 'all'` 或列在 `providers` 里，
 *           且不在 `disabledProviders` 里），并且账号不在 `excludedAccounts` 里。
 * 这两条**必须逐字对齐** —— 判据一旦分叉，手机说「参与」而网关不选它，用户会以为坏了。
 */

type WorkspaceProvider = {
  id: string
  label?: string
  accountCount?: number
  custom?: boolean
  available?: boolean
}

type WorkspaceAccount = {
  id: string
  provider?: string
  name?: string
  nickname?: string
  priority?: number
  enabled?: boolean
  available?: boolean
  hasCredentials?: boolean
  needsRelogin?: boolean
  needsReloginReason?: string
  isGuest?: boolean
  editionLabel?: string
}

type WorkspaceProfile = {
  providerScope?: 'all' | 'selected'
  providers?: string[]
  disabledProviders?: string[]
  accountOrder?: Record<string, string[]>
  excludedAccounts?: string[]
  strategy?: string
  sticky?: string
}

type WorkspaceQueueEntry = {
  id: string
  name?: string
  provider?: string
  providerLabel?: string
  state?: string
  reason?: string
  resetAt?: number | null
  priority?: number
}

type Workspace = {
  model: string | null
  customized?: boolean
  globalCustomized?: boolean
  globalAccountControl?: boolean
  legacyGlobalParticipation?: unknown
  configuredModels?: string[]
  models?: string[]
  profile?: WorkspaceProfile
  providers?: WorkspaceProvider[]
  accounts?: WorkspaceAccount[]
  queue?: { strategy?: string; sticky?: string; pickedId?: string; ordered?: WorkspaceQueueEntry[]; blocked?: WorkspaceQueueEntry[] }
  settings?: RoutingSettings
  globalSettings?: RoutingSettings
  accountStates?: Record<string, { model?: string; resetAt?: number; limitedModels?: number }>
  metrics?: {
    available?: boolean
    running?: number
    todayRequests?: number
    todaySuccessRate?: number | null
    averageDurationMs?: number | null
    accountRunning?: Record<string, number>
    accountConnections?: Record<string, number>
  }
  gateway?: { port?: number; host?: string }
  stickyCount?: number
  updatedAt?: number
}

const fetchWorkspace = (model?: string) =>
  apiCall<Workspace>(`/api/routing/workspace${model ? `?model=${encodeURIComponent(model)}` : ''}`)

export function RoutingWorkspaceView() {
  const identity = serverIdentity()
  const [scope, setScope] = useState('')          // '' = 全局
  const [data, setData] = useState<Workspace | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const next = await fetchWorkspace(scope || undefined)
      if (serverIdentity() !== identity) return
      if (!next || !Array.isArray(next.accounts)) throw new Error(t('路由接口返回了不完整的数据'))
      setData(next)
      setError('')
    } catch (cause) {
      if (serverIdentity() === identity) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (serverIdentity() === identity) setLoading(false)
    }
  }, [identity, scope])

  useEffect(() => { void load() }, [load])

  const pull = usePullToRefresh({ onRefresh: () => { void load() } })

  const accounts = data?.accounts || []
  const providers = data?.providers || []
  const profile = data?.profile || {}
  const globalMode = !scope
  const enabledProviders = new Set(accounts.filter(a => a.enabled !== false).map(a => a.provider || ''))

  /** 与桌面端 `routing-config-panel.tsx` 同一判据 */
  const providerIncluded = (id: string) =>
    globalMode
      ? enabledProviders.has(id)
      : (profile.providerScope === 'all' || (profile.providers || []).includes(id)) &&
        !(profile.disabledProviders || []).includes(id)

  const accountJoined = (account: WorkspaceAccount) =>
    globalMode
      ? account.enabled !== false
      : providerIncluded(account.provider || '') && !(profile.excludedAccounts || []).includes(account.id)

  const participants = accounts.filter(accountJoined)
  const grouped = new Map<string, WorkspaceAccount[]>()
  for (const account of accounts) {
    const id = account.provider || ''
    grouped.set(id, [...(grouped.get(id) || []), account])
  }

  const metrics = data?.metrics || {}
  const states = data?.accountStates || {}
  const limited = Object.entries(states).filter(([, value]) => (value?.limitedModels || 0) > 0)
  const runningCount = (id: string) => (metrics.accountRunning?.[id] || 0) + (metrics.accountConnections?.[id] || 0)
  const strategy = data?.settings?.routingStrategy || '—'
  const sticky = data?.settings?.routingSticky || '—'
  const globallyBlocked = globalMode && (!data?.globalAccountControl || Boolean(data?.legacyGlobalParticipation))

  return (
    <div ref={pull.bindRef}>
      <PullIndicator pull={pull.pull} refreshing={pull.refreshing} />

      <Card className='m-card m-card-pad' style={{ marginTop: 12 }}>
        <Label htmlFor='ws-scope'>{t('作用范围')}</Label>
        <Select value={scope || '__global__'} onValueChange={value => setScope(!value || value === '__global__' ? '' : value)}>
          <SelectTrigger id='ws-scope' className='w-full' aria-label={t('作用范围')}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value='__global__'>{t('全局默认')}</SelectItem>
            {(data?.models || data?.configuredModels || []).map(item => (
              <SelectItem key={item} value={item}>{item}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p style={{ fontSize: 11, color: 'var(--m-text-3)', lineHeight: 1.7, marginTop: 6 }}>
          {globalMode
            ? t('看的是全局默认：账号启停立即生效，路由配置保存后生效。')
            : t('看的是这个模型的独立配置：保存后才会影响真实请求。')}
        </p>
      </Card>

      {error ? <div style={{ marginTop: 10 }}><ErrorNote text={error} /></div> : null}
      {!data && loading ? <Card className='m-card' style={{ marginTop: 10 }}><Empty text={t('正在读取工作空间…')} /></Card> : null}

      {data ? (
        <>
          {globallyBlocked ? (
            <Card className='m-card m-card-pad' style={{ marginTop: 10 }}>
              <p style={{ fontSize: 12, color: 'var(--m-warn)', lineHeight: 1.7, margin: 0 }}>
                {t('当前网关尚不支持全局账号启停，请更新网关后重新读取。')}
              </p>
            </Card>
          ) : null}

          {/* 概览 */}
          <div className='m-section' style={{ marginTop: 14 }}>
            <SectionHead title={t('概览')} />
            <Card className='m-card'>
              <div className='m-row'>
                <span className='m-k'>{t('选路策略')}</span>
                <span className='m-v m-mono'>{strategy}</span>
              </div>
              <div className='m-row'>
                <span className='m-k'>{t('会话粘滞')}</span>
                <span className='m-v m-mono'>{sticky}</span>
              </div>
              <div className='m-row'>
                <span className='m-k'>{t('参与账号')}</span>
                <span className='m-v m-mono'>{formatInt(participants.length)} / {formatInt(accounts.length)}</span>
              </div>
              <div className='m-row'>
                <span className='m-k'>{t('粘滞绑定')}</span>
                <span className='m-v m-mono'>{formatInt(data.stickyCount || 0)}</span>
              </div>
              <div className='m-row'>
                <span className='m-k'>{t('在途请求')}</span>
                <span className='m-v m-mono'>{formatInt(metrics.running || 0)}</span>
              </div>
              <div className='m-row'>
                <span className='m-k'>{t('今日请求')}</span>
                <span className='m-v m-mono'>{formatInt(metrics.todayRequests || 0)}</span>
              </div>
              <div className='m-row'>
                <span className='m-k'>{t('今日成功率')}</span>
                <span className='m-v m-mono'>
                  {metrics.todaySuccessRate == null ? t('未记录') : formatPercent(metrics.todaySuccessRate, 1, true)}
                </span>
              </div>
              <div className='m-row'>
                <span className='m-k'>{t('平均耗时')}</span>
                <span className='m-v m-mono'>
                  {metrics.averageDurationMs == null ? t('未记录') : formatDuration(metrics.averageDurationMs)}
                </span>
              </div>
            </Card>
            {metrics.available === false ? (
              <p style={{ fontSize: 11, color: 'var(--m-text-3)', marginTop: 6 }}>
                {t('网关没有提供实时指标（可能是旧版），上面几项按 0 显示。')}
              </p>
            ) : null}
          </div>

          {/* 被限额 */}
          {limited.length ? (
            <div className='m-section' style={{ marginTop: 14 }}>
              <SectionHead title={t('限额中（{n}）', { n: limited.length })} />
              <Card className='m-card'>
                {limited.map(([id, value], index) => {
                  const account = accounts.find(item => item.id === id)
                  return (
                    <div key={id} className='m-row' style={index ? { borderTop: '1px solid var(--m-line)' } : undefined}>
                      <span className='m-logo'><Badge tone='warn'>{t('限流')}</Badge></span>
                      <div className='m-grow'>
                        <div className='m-t1'>{account?.name || account?.nickname || id}</div>
                        <div className='m-t2'>
                          {providerLabel(account?.provider || '', account?.provider)}
                          {value?.model ? ` · ${value.model}` : ''}
                        </div>
                      </div>
                      <div style={{ flex: 'none', textAlign: 'right', fontSize: 11.5 }}>
                        <div className='m-mono'>{t('{n} 个模型', { n: formatInt(value?.limitedModels || 0) })}</div>
                        <div style={{ color: 'var(--m-text-3)' }}>
                          {value?.resetAt ? t('{time} 重置', { time: formatExpiry(value.resetAt) }) : t('重置时间未记录')}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </Card>
            </div>
          ) : null}

          {/* 此刻队列 */}
          {data.queue?.ordered?.length || data.queue?.blocked?.length ? (
            <div className='m-section' style={{ marginTop: 14 }}>
              <SectionHead title={t('此刻队列')} />
              <Card className='m-card m-card-pad'>
                {data.queue?.pickedId ? (
                  <div style={{ fontSize: 12, marginBottom: 8 }}>
                    <Badge tone='ok'>{t('下一条请求打头')}</Badge>
                    <span className='m-mono' style={{ marginLeft: 8 }}>#{data.queue.pickedId}</span>
                  </div>
                ) : (
                  <p style={{ fontSize: 12, color: 'var(--m-warn)', margin: '0 0 8px' }}>
                    {t('没有可用账号：先处理凭证、限额或参与范围。')}
                  </p>
                )}
                {(data.queue?.ordered || []).map((entry, index) => (
                  <div key={`${entry.id}-${index}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
                    <span className='m-mono' style={{ width: 24, flex: 'none', fontSize: 11, color: 'var(--m-text-3)' }}>#{entry.id}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className='m-t1' style={{ fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {entry.name || entry.id}
                      </div>
                      <div className='m-t2'>{providerLabel(entry.provider || '', entry.providerLabel)}</div>
                    </div>
                    {entry.state ? <Badge tone='mute'>{entry.state}</Badge> : null}
                  </div>
                ))}
                {(data.queue?.blocked || []).length ? (
                  <>
                    <div style={{ fontSize: 12, fontWeight: 600, marginTop: 10, marginBottom: 4 }}>{t('被跳过')}</div>
                    {(data.queue?.blocked || []).map((entry, index) => (
                      <div key={`${entry.id}-b-${index}`} style={{ padding: '6px 0' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span className='m-mono' style={{ width: 24, flex: 'none', fontSize: 11, color: 'var(--m-text-3)' }}>#{entry.id}</span>
                          <span className='m-t1' style={{ flex: 1, fontSize: 12.5 }}>{entry.name || entry.id}</span>
                          {entry.resetAt ? (
                            <span style={{ fontSize: 10.5, color: 'var(--m-text-3)' }}>{formatExpiry(entry.resetAt)}</span>
                          ) : null}
                        </div>
                        {entry.reason ? (
                          <p style={{ fontSize: 11, color: 'var(--m-warn)', lineHeight: 1.7, margin: '2px 0 0 32px' }}>
                            {entry.reason}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </>
                ) : null}
              </Card>
            </div>
          ) : null}

          {/* 账号参与度 */}
          <div className='m-section' style={{ marginTop: 14 }}>
            <SectionHead title={t('账号参与度')} />
            {[...grouped.entries()].map(([providerId, rows]) => {
              const joinedHere = rows.filter(accountJoined).length
              const provider = providers.find(item => item.id === providerId)
              return (
                <Card key={providerId} className='m-card' style={{ marginBottom: 10 }}>
                  <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className='m-t1' style={{ fontSize: 13 }}>{provider?.label || providerLabel(providerId, providerId)}</div>
                      <div className='m-t2'>
                        {globalMode
                          ? t('{selected} / {total} 个账号启用', { selected: joinedHere, total: rows.length })
                          : t('{selected} / {total} 个账号参与', { selected: joinedHere, total: rows.length })}
                        {provider?.available === false ? ` · ${t('模型绑定不可用')}` : ''}
                      </div>
                    </div>
                  </div>
                  {rows.map((account, index) => {
                    const joined = accountJoined(account)
                    const state = states[account.id]
                    const running = runningCount(account.id)
                    return (
                      <div key={account.id} style={{ padding: '10px 14px', borderTop: '1px solid var(--m-line)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className='m-t1' style={{ fontSize: 12.5, opacity: joined ? 1 : 0.55 }}>
                              {account.name || account.nickname || account.id}
                            </div>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 3 }}>
                              <Badge tone={joined ? 'ok' : 'mute'}>{joined ? t('参与') : t('未参与')}</Badge>
                              {account.enabled === false ? <Badge tone='mute'>{t('账号已禁用')}</Badge> : null}
                              {account.hasCredentials === false ? <Badge tone='warn'>{t('未配置凭证')}</Badge> : null}
                              {account.needsRelogin ? <Badge tone='bad'>{t('需重新登录')}</Badge> : null}
                              {account.isGuest ? <Badge tone='mute'>{t('访客')}</Badge> : null}
                              {account.available === false ? <Badge tone='warn'>{t('不可用')}</Badge> : null}
                            </div>
                          </div>
                          <div style={{ flex: 'none', textAlign: 'right', fontSize: 11 }}>
                            {running ? <div className='m-mono'>{t('{n} 在途', { n: running })}</div> : null}
                            {state?.limitedModels ? (
                              <div style={{ color: 'var(--m-warn)' }}>{t('限 {n} 模型', { n: state.limitedModels })}</div>
                            ) : null}
                          </div>
                        </div>
                        {account.needsRelogin && account.needsReloginReason ? (
                          <p style={{ fontSize: 11, color: 'var(--m-text-3)', lineHeight: 1.7, margin: '4px 0 0' }}>
                            {account.needsReloginReason}
                          </p>
                        ) : null}
                      </div>
                    )
                  })}
                </Card>
              )
            })}
            {!grouped.size ? <Card className='m-card'><Empty text={t('还没有账号。')} /></Card> : null}
          </div>

          <p style={{ fontSize: 11, color: 'var(--m-text-3)', lineHeight: 1.7, marginTop: 10 }}>
            {t('这一屏是只读的：账号的启用开关在「账号」页改，路由的参与范围在「策略与预演」里保存后生效。')}
          </p>
        </>
      ) : null}
    </div>
  )
}
