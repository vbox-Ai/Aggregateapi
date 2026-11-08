import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Input, Label, SegmentedControl, Switch } from '@ui'
import { PageHead, Empty, ErrorNote, SectionHead } from '../components/ui'
import { Icon } from '../components/Icon'
import { usePullToRefresh, PullIndicator } from '../components/PullToRefresh'
import { serverIdentity } from '../lib/servers'
import { store } from '../state/store'
import { t } from '../i18n'
import { fetchRouting, fetchRoutingQueue, putRouting, stickyHint, strategyHint, ROUTING_LIMITS, type RoutingPatch, type RoutingSettings, type RoutingQueue } from '../api/routing'
import { providerLabel } from '../lib/providers'
import { RoutingReplayView } from './routing-replay'
import { RoutingWorkspaceView } from './routing-workspace'
import { RoutingStickySheet } from './routing-sticky-sheet'

/**
 * 路由配置。
 *
 * 上游契约（`api/routing_api.rs`）：
 * - `GET  /api/routing`     → 生效的全量路由设置
 * - `PUT  /api/routing`     → 部分字段 patch（不给 = 不动），保存后下个请求立即生效
 * - `GET  /api/routing/queue?model=` → 队列可见化：按当前策略，这个模型的候选怎么排、
 *   谁被跳过、为什么（排序实现与转发选路是同一个函数）
 *
 * ⚠️ 这一页目前只做了**全局策略 + 队列预演**，别被下面这句旧的错误判断误导 —— 之前这里
 * 写着「路由组 / 工作空间是桌面壳事务、网关没有给它们 HTTP 入口」，**只对了一半**：
 * 只有「保存路由组」没有 HTTP 路由，而工作空间 / 预演 / 路由档写入 / 粘滞 / 请求回放 /
 * 链路追踪 / 流量图**全都有**（见 `docs/mobile-ui/ROUTING-GAP.md` 的路由表与批次计划）。
 * 判据是网关自己的路由表，不是「桌面端文件多不多」。
 */
export function RoutingPage() {
  const identity = serverIdentity()
  const [stickyOpen, setStickyOpen] = useState(false)
  const [mode, setMode] = useState<'strategy' | 'workspace' | 'replay'>('strategy')
  const [settings, setSettings] = useState<RoutingSettings | null>(null)
  const [queue, setQueue] = useState<RoutingQueue | null>(null)
  const [model, setModel] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [draft, setDraft] = useState<RoutingSettings | null>(null)

  const loadSettings = useCallback(async () => {
    try {
      const next = await fetchRouting()
      if (serverIdentity() === identity) {
        setSettings(next)
        setDraft(next)
      }
    } catch (cause) {
      if (serverIdentity() === identity) setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [identity])

  const loadQueue = useCallback(async (target: string) => {
    try {
      const next = await fetchRoutingQueue(target)
      if (serverIdentity() === identity) setQueue(next)
    } catch (cause) {
      if (serverIdentity() === identity) setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [identity])

  useEffect(() => { void loadSettings() }, [loadSettings])
  useEffect(() => { void loadQueue(model) }, [loadQueue, model])

  // 队列预演的模型框用自由输入：会话里的 provider 摘要不含模型清单，
  // 而「全部模型」走的是服务端自己的口径，硬凑一个下拉只会误导。
  const pull = usePullToRefresh({ onRefresh: () => { void loadSettings(); void loadQueue(model) } })

  const save = async () => {
    if (busy || !draft || !settings) return
    // 只发**变过**的键：后端对不认识的键静默忽略，全量发反而容易掩盖键名写错
    const patch: RoutingPatch = {}
    if (draft.routingStrategy !== settings.routingStrategy) patch.routingStrategy = draft.routingStrategy
    if (draft.routingSticky !== settings.routingSticky) patch.routingSticky = draft.routingSticky
    if (draft.routingFailoverBackoff !== settings.routingFailoverBackoff) patch.routingFailoverBackoff = draft.routingFailoverBackoff
    if (draft.routingSink !== settings.routingSink) patch.routingSink = draft.routingSink
    if (draft.routingBreakerEnabled !== settings.routingBreakerEnabled) patch.routingBreakerEnabled = draft.routingBreakerEnabled
    if (draft.routingBreakerThreshold !== settings.routingBreakerThreshold) patch.routingBreakerThreshold = draft.routingBreakerThreshold
    if (draft.routingBreakerTimeoutSeconds !== settings.routingBreakerTimeoutSeconds) patch.routingBreakerTimeoutSeconds = draft.routingBreakerTimeoutSeconds
    if (draft.routingBreakerSuccessThreshold !== settings.routingBreakerSuccessThreshold) patch.routingBreakerSuccessThreshold = draft.routingBreakerSuccessThreshold
    if (!Object.keys(patch).length) {
      store.toast(t('没有改动'))
      return
    }
    setBusy('save')
    setError('')
    try {
      const next = await putRouting(patch)
      if (serverIdentity() !== identity) return
      setSettings(next)
      setDraft(next)
      // 粘性档位一变，后端会把现有会话绑定全部清掉（`clear_route_sticky`），
      // 所以这句提示得说清「绑定没了」，不能只说「下个请求生效」
      store.toast(
        patch.routingSticky
          ? t('已保存：粘性档位变了，现有会话绑定已被解除')
          : t('路由设置已保存，下一个请求生效'),
      )
      void loadQueue(model)
    } catch (cause) {
      if (serverIdentity() === identity) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (serverIdentity() === identity) setBusy('')
    }
  }

  const queueEntry = (entry: { id: string; name?: string; provider?: string; reason?: string }) => (
    <div key={entry.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
      <span className='m-mono' style={{ width: 22, flex: 'none', fontSize: 11, color: 'var(--m-text-3)' }}>
        #{entry.id}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {entry.name || entry.id}
        </div>
        <div style={{ fontSize: 11, color: 'var(--m-text-3)' }}>{providerLabel(entry.provider || '', entry.provider)}</div>
      </div>
      {entry.reason ? <span style={{ fontSize: 10.5, color: 'var(--m-warn)', flex: 'none', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {entry.reason}
      </span> : null}
    </div>
  )

  return (
    <div className='m-page' ref={pull.bindRef}>
      <PullIndicator pull={pull.pull} refreshing={pull.refreshing} />
      <PageHead
        title={t('路由配置')}
        subtitle={mode === 'strategy' ? t('候选顺序 · 粘性 · 失败后退避') : t('最近请求 · 每次尝试 · 候选快照')}
        actions={mode === 'strategy' ? (
          <Button variant='outline' size='sm' disabled={Boolean(busy)} onClick={() => void save()}>
            {busy === 'save' ? t('保存中…') : t('保存')}
          </Button>
        ) : undefined}
      />

      {/* 与桌面端同一套顶层模式：策略（配置）/ 工作空间（此刻状态）/ 回放（实际发生了什么） */}
      <div className='m-section' style={{ marginTop: 12 }}>
        <SegmentedControl
          options={[
            { value: 'strategy', label: t('策略与预演') },
            { value: 'workspace', label: t('工作空间') },
            { value: 'replay', label: t('请求回放') },
          ]}
          value={mode}
          aria-label={t('路由配置模式')}
          onValueChange={value => setMode(value as 'strategy' | 'workspace' | 'replay')}
        />
      </div>

      {mode === 'replay' ? <RoutingReplayView /> : null}
      {mode === 'workspace' ? <RoutingWorkspaceView /> : null}

      {mode === 'strategy' ? (
        <>
          <div className='m-section' style={{ marginTop: 0 }}>
        <SectionHead title={t('全局策略')} />
        {error ? <ErrorNote text={error} /> : null}
        {!settings ? <Card className='m-card'><Empty text={t('正在读取路由设置…')} /></Card> : null}
        {settings && draft ? <Card className='m-card m-card-pad'>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <Label>{t('路由策略')}</Label>
              <SegmentedControl
                options={[
                  { value: 'order', label: t('顺序优先') },
                  { value: 'rotate', label: t('负载均衡') },
                  { value: 'provider', label: t('家内轮询') },
                ]}
                value={draft.routingStrategy}
                aria-label={t('路由策略')}
                onValueChange={value => setDraft({ ...draft, routingStrategy: value as RoutingSettings['routingStrategy'] })}
              />
              <p className='m-ck-note' style={{ marginTop: 4 }}>{strategyHint(draft.routingStrategy)}</p>
            </div>
            <div>
              <Label>{t('会话粘性')}</Label>
              <SegmentedControl
                options={[
                  { value: 'auto', label: t('自动') },
                  { value: 'session', label: t('会话内') },
                  { value: 'turn', label: t('每轮') },
                  { value: 'off', label: t('关闭') },
                ]}
                value={draft.routingSticky}
                aria-label={t('会话粘性')}
                onValueChange={value => setDraft({ ...draft, routingSticky: value as RoutingSettings['routingSticky'] })}
              />
              <p className='m-ck-note' style={{ marginTop: 4 }}>{stickyHint(draft.routingSticky)}</p>
              {draft.routingSticky !== settings.routingSticky ? (
                <p style={{ fontSize: 11.5, color: 'var(--m-warn)', lineHeight: 1.7, marginTop: 4 }}>
                  {t('改动这一档会解除现有的全部会话绑定（网关会在保存时清空）。')}
                </p>
              ) : null}
            </div>
            <div>
              <span className='m-ck-note' style={{ display: 'block', marginBottom: 6 }}>{t('粘滞绑定')}</span>
              <Button variant='outline' size='sm' onClick={() => setStickyOpen(true)}>
                {t('查看与解除')}
              </Button>
            </div>
          </div>

          <div style={{ marginTop: 16, fontSize: 12, fontWeight: 600 }}>{t('自愈保护')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
            <ProtectionSwitch
              label={t('失败退避')} hint={t('转发失败的账号暂时休息，避免连续请求反复撞到同一故障。')}
              checked={draft.routingFailoverBackoff}
              onChange={value => setDraft({ ...draft, routingFailoverBackoff: value })}
            />
            <ProtectionSwitch
              label={t('限流垫底')} hint={t('曾被限流的账号暂时排到队尾，三十分钟后或转发成功后恢复。')}
              checked={draft.routingSink}
              onChange={value => setDraft({ ...draft, routingSink: value })}
            />
            <ProtectionSwitch
              label={t('熔断保护')} hint={t('连续失败达到阈值时暂时让位，恢复后再重新参与。')}
              checked={draft.routingBreakerEnabled}
              onChange={value => setDraft({ ...draft, routingBreakerEnabled: value })}
            />
            {draft.routingBreakerEnabled ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 2 }}>
                <NumberField
                  id='routing-breaker-threshold' label={t('失败阈值')} value={draft.routingBreakerThreshold}
                  min={ROUTING_LIMITS.breakerThreshold.min} max={ROUTING_LIMITS.breakerThreshold.max}
                  onChange={value => setDraft({ ...draft, routingBreakerThreshold: value })}
                />
                <NumberField
                  id='routing-breaker-timeout' label={t('熔断时长（秒）')} value={draft.routingBreakerTimeoutSeconds}
                  min={ROUTING_LIMITS.breakerTimeoutSeconds.min} max={ROUTING_LIMITS.breakerTimeoutSeconds.max}
                  onChange={value => setDraft({ ...draft, routingBreakerTimeoutSeconds: value })}
                />
                <NumberField
                  id='routing-breaker-success' label={t('恢复阈值')} value={draft.routingBreakerSuccessThreshold}
                  min={ROUTING_LIMITS.breakerSuccessThreshold.min} max={ROUTING_LIMITS.breakerSuccessThreshold.max}
                  onChange={value => setDraft({ ...draft, routingBreakerSuccessThreshold: value })}
                />
              </div>
            ) : null}
          </div>
        </Card> : null}
      </div>

      <div className='m-section'>
        <SectionHead title={t('队列预演')} />
        <p className='m-ck-note'>{t('按当前策略，这个模型的候选账号会怎么排、谁被跳过、为什么。排序与转发选路是同一个函数。')}</p>
        <div className='m-ck-toolbar'>
          <span className='m-ck-title m-ck-grow'>{t('模型（留空 = 全部模型）')}</span>
          <Input
            value={model}
            onChange={event => setModel(event.currentTarget.value)}
            placeholder={t('例如：gpt-4o-mini')}
            style={{ width: 180 }}
          />
        </div>
        {queue ? <Card className='m-card m-card-pad'>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>{t('候选顺序')}</span>
            {queue.pickedId ? <span style={{ fontSize: 10.5, color: 'var(--m-primary)' }}>{t('选中：{name}', { name: queue.pickedId })}</span> : null}
          </div>
          {queue.ordered.length === 0 ? <p className='m-ck-note'>{t('没有可用候选。')}</p> : queue.ordered.map(queueEntry)}
          {queue.blocked.length ? <>
            <div style={{ fontSize: 12, fontWeight: 600, marginTop: 10, marginBottom: 4 }}>{t('被跳过的账号')}</div>
            {queue.blocked.map(queueEntry)}
          </> : null}
        </Card> : <Card className='m-card'><Empty text={t('正在计算队列…')} /></Card>}
      </div>
        </>
      ) : null}

      {stickyOpen ? <RoutingStickySheet model={model || undefined} onClose={() => setStickyOpen(false)} /> : null}
    </div>
  )
}

/** 自愈保护的一个开关（label + 说明 + Switch） */
function ProtectionSwitch({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className='m-t1' style={{ fontSize: 12.5 }}>{label}</div>
        <div className='m-t2' style={{ lineHeight: 1.6 }}>{hint}</div>
      </div>
      <Switch
        checked={checked}
        aria-label={label}
        onCheckedChange={value => onChange(value === true)}
      />
    </div>
  )
}

/**
 * 数值字段。
 *
 * 失焦时才夹到范围内：边输边夹会把「1」这种中间态改成「10」，
 * 用户想输 15 就会打成 105。后端范围见 `api/routing.ts` 的 ROUTING_LIMITS。
 */
function NumberField({
  id,
  label,
  value,
  min,
  max,
  onChange,
}: {
  id: string
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => { setDraft(String(value)) }, [value])
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type='number'
        inputMode='numeric'
        min={min}
        max={max}
        value={draft}
        onChange={event => setDraft(event.currentTarget.value)}
        onBlur={() => {
          const parsed = Number(draft)
          const clamped = Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : value
          setDraft(String(clamped))
          if (clamped !== value) onChange(clamped)
        }}
      />
      <p className='m-ck-note' style={{ marginTop: 2 }}>{t('范围 {min}~{max}', { min, max })}</p>
    </div>
  )
}
