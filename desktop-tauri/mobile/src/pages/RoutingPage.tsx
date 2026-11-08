import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@ui'
import { PageHead, Empty, ErrorNote, SectionHead } from '../components/ui'
import { Icon } from '../components/Icon'
import { usePullToRefresh, PullIndicator } from '../components/PullToRefresh'
import { serverIdentity } from '../lib/servers'
import { store } from '../state/store'
import { t } from '../i18n'
import { fetchRouting, fetchRoutingQueue, putRouting, type RoutingSettings, type RoutingQueue } from '../api/routing'
import { providerLabel } from '../lib/providers'

/**
 * 路由配置。
 *
 * 上游契约（`api/routing_api.rs`）：
 * - `GET  /api/routing`     → 生效的全量路由设置
 * - `PUT  /api/routing`     → 部分字段 patch（不给 = 不动），保存后下个请求立即生效
 * - `GET  /api/routing/queue?model=` → 队列可见化：按当前策略，这个模型的候选怎么排、
 *   谁被跳过、为什么（排序实现与转发选路是同一个函数）
 *
 * 手机上不做路由组 / 工作空间：那两层是桌面 Tauri 壳的事务（`saveRoutingProfile`），
 * 网关没有给它们 HTTP 入口。这里只做**全局策略 + 队列预演**——日常最需要的两块。
 */
export function RoutingPage() {
  const identity = serverIdentity()
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
    if (busy || !draft) return
    setBusy('save')
    setError('')
    try {
      const next = await putRouting({
        strategy: draft.strategy,
        sticky: draft.sticky,
        failoverBackoff: draft.failoverBackoff,
      })
      if (serverIdentity() !== identity) return
      setSettings(next)
      setDraft(next)
      store.toast(t('路由设置已保存，下一个请求生效'))
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
        subtitle={t('候选顺序 · 粘性 · 失败后退避')}
        actions={<Button variant='outline' size='sm' disabled={Boolean(busy)} onClick={() => void save()}>
          {busy === 'save' ? t('保存中…') : t('保存')}
        </Button>}
      />

      <div className='m-section' style={{ marginTop: 0 }}>
        <SectionHead title={t('全局策略')} />
        {error ? <ErrorNote text={error} /> : null}
        {!settings ? <Card className='m-card'><Empty text={t('正在读取路由设置…')} /></Card> : null}
        {settings && draft ? <Card className='m-card m-card-pad'>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <Label htmlFor='routing-strategy'>{t('选路策略')}</Label>
              <Select value={draft.strategy} onValueChange={value => setDraft({ ...draft, strategy: value as RoutingSettings['strategy'] })}>
                <SelectTrigger className='w-full' aria-label={t('选路策略')}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value='order'>{t('固定顺序（按队列顺序逐个尝试）')}</SelectItem>
                  <SelectItem value='rotate'>{t('轮转（每个请求换下一位）')}</SelectItem>
                  <SelectItem value='provider'>{t('按提供商（同一家优先）')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor='routing-sticky'>{t('会话粘滞')}</Label>
              <Select value={draft.sticky} onValueChange={value => setDraft({ ...draft, sticky: value as RoutingSettings['sticky'] })}>
                <SelectTrigger className='w-full' aria-label={t('会话粘滞')}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value='off'>{t('关闭')}</SelectItem>
                  <SelectItem value='on'>{t('开启（同一会话优先用同一个账号）')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor='routing-backoff'>{t('失败后退避（毫秒）')}</Label>
              <Input id='routing-backoff' type='number' min={0} step={100}
                value={String(draft.failoverBackoff)}
                onChange={event => setDraft({ ...draft, failoverBackoff: Number(event.currentTarget.value) || 0 })} />
            </div>
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
    </div>
  )
}
