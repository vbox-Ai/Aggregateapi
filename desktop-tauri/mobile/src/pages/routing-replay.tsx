import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Input, Label, SegmentedControl, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@ui'
import { Badge, Empty, ErrorNote } from '../components/ui'
import { Icon } from '../components/Icon'
import { usePullToRefresh, PullIndicator } from '../components/PullToRefresh'
import { serverIdentity } from '../lib/servers'
import { formatClock } from '../lib/format'
import { t } from '../i18n'
import { fetchRoutingFlow, type FlowModels, type FlowRow, type FlowScope } from '../api/routing-flow'
import { isTraceRunning, isTraceSuccess, requestKey, requestModel, tracePhase, traceProvider } from '../lib/routing-trace'
import { RoutingTraceSheet } from './routing-trace-sheet'

const PAGE_SIZE = 30
const WINDOWS = [5, 10, 30, 60] as const

/**
 * 请求回放：最近请求列表 → 点开看单次请求的每次尝试。
 *
 * 数据源是 `GET /api/routing/flow` 加 `detail=requests`（**不是** `/api/routing/replays`，
 * 见 `api/routing-flow.ts` 的说明）；模型候选走同一个端点加 `detail=models`。
 *
 * 与桌面端的差别只在呈现：桌面是「左列表 + 右详情」两栏 + 画布，手机是一屏列表
 * 加一个详情抽屉。筛选维度也收到四个（时间窗 / 范围 / 模型 / 搜索）—— 桌面那套
 * 还有客户端、提供商、账号、会话、活动状态七八个维度，那是给大屏做交叉分析用的，
 * 挤进手机只会让任何一个都用不上。
 */
export function RoutingReplayView() {
  const identity = serverIdentity()
  const [minutes, setMinutes] = useState<number>(10)
  const [scope, setScope] = useState<FlowScope>('window')
  const [model, setModel] = useState('')
  const [search, setSearch] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [rows, setRows] = useState<FlowRow[]>([])
  const [matched, setMatched] = useState(0)
  const [offset, setOffset] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [opened, setOpened] = useState<FlowRow | null>(null)

  const loadModels = useCallback(async () => {
    try {
      const next = (await fetchRoutingFlow({ minutes, scope, detail: 'models' })) as FlowModels
      if (serverIdentity() === identity) setModels(next.available === false ? [] : next.models || [])
    } catch {
      // 候选清单失败不影响列表：保留上一次结果，不额外报错（与桌面端一致）
    }
  }, [identity, minutes, scope])

  const loadRows = useCallback(async (targetOffset: number) => {
    setLoading(true)
    try {
      const next = await fetchRoutingFlow({
        minutes,
        scope,
        detail: 'requests',
        offset: targetOffset,
        limit: PAGE_SIZE,
        model: model || undefined,
        search: search || undefined,
      })
      if (serverIdentity() !== identity) return
      if (next.available === false) throw new Error(t('请求记录数据库不可用'))
      const entries = (next.entries || []).filter(entry => !('latest' in entry)) as FlowRow[]
      // 窗口滑走后原来那页可能已越界：回到最后一页，而不是显示空列表
      const lastOffset = Math.max(0, Math.ceil((next.matched || 0) / PAGE_SIZE) - 1) * PAGE_SIZE
      if (targetOffset > lastOffset) {
        setOffset(lastOffset)
        return
      }
      setRows(current => (targetOffset === 0 ? entries : [...current, ...entries]))
      setMatched(next.matched || 0)
      setOffset(targetOffset)
      setError('')
    } catch (cause) {
      if (serverIdentity() === identity) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (serverIdentity() === identity) setLoading(false)
    }
  }, [identity, minutes, model, scope, search])

  useEffect(() => { void loadModels() }, [loadModels])
  // 筛选变了就回到第一页并清空，否则会看到「新条件 + 旧结果」拼在一起的列表
  useEffect(() => {
    setRows([])
    setOffset(0)
    void loadRows(0)
  }, [loadRows])

  const pull = usePullToRefresh({
    onRefresh: () => { void loadModels(); void loadRows(0) },
  })

  const statusOf = (row: FlowRow) => {
    const running = isTraceRunning(row), success = isTraceSuccess(row)
    return running
      ? { tone: 'warn' as const, text: tracePhase(row.phase) }
      : success
        ? { tone: 'ok' as const, text: String(row.status) }
        : { tone: 'bad' as const, text: row.status ? `${row.status} · ${t('失败')}` : t('失败') }
  }

  const hasMore = rows.length < matched

  return (
    <div ref={pull.bindRef}>
      <PullIndicator pull={pull.pull} refreshing={pull.refreshing} />

      {/* 筛选 */}
      <Card className='m-card m-card-pad' style={{ marginTop: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <Label>{t('时间窗')}</Label>
            <SegmentedControl
              options={WINDOWS.map(value => ({ value: String(value), label: t('{n} 分钟', { n: value }) }))}
              value={String(minutes)}
              aria-label={t('时间窗')}
              onValueChange={value => setMinutes(Number(value) || 10)}
            />
          </div>
          <div>
            <Label>{t('范围')}</Label>
            <SegmentedControl
              options={[
                { value: 'window', label: t('窗口内全部') },
                { value: 'running', label: t('仅进行中') },
              ]}
              value={scope}
              aria-label={t('范围')}
              onValueChange={value => setScope(value as FlowScope)}
            />
          </div>
          <div>
            <Label htmlFor='replay-model'>{t('模型')}</Label>
            <Select value={model || '__all__'} onValueChange={value => setModel(!value || value === '__all__' ? '' : value)}>
              <SelectTrigger id='replay-model' className='w-full' aria-label={t('模型')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='__all__'>{t('全部模型')}</SelectItem>
                {models.map(item => (
                  <SelectItem key={item} value={item}>{item}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!models.length ? (
              <p style={{ fontSize: 11, color: 'var(--m-text-3)', marginTop: 4 }}>
                {t('这个时间窗里还没有请求过的模型，所以候选是空的。')}
              </p>
            ) : null}
          </div>
          <div>
            <Label htmlFor='replay-search'>{t('搜索')}</Label>
            <Input
              id='replay-search'
              value={search}
              placeholder={t('账号名 / 请求 id / 错误关键字')}
              onChange={event => setSearch(event.currentTarget.value)}
            />
          </div>
        </div>
      </Card>

      {error ? <div style={{ marginTop: 10 }}><ErrorNote text={error} /></div> : null}

      {/* 列表 */}
      <div style={{ marginTop: 12, fontSize: 11.5, color: 'var(--m-text-3)', padding: '0 2px 6px' }}>
        {matched ? t('{matched} 条匹配，已加载 {loaded} 条', { matched, loaded: rows.length }) : t('最近请求')}
      </div>

      {rows.length ? (
        <Card className='m-card'>
          {rows.map((row, index) => {
            const status = statusOf(row)
            const switches = Math.max(0, (row.attempts || 1) - 1)
            return (
              <Button
                key={`${requestKey(row)}-${index}`}
                size='default'
                variant='ghost'
                type='button'
                className='m-row h-auto min-h-[56px] w-full justify-start rounded-none border-0 px-3.5 py-3 text-left'
                onClick={() => setOpened(row)}
              >
                <span className='m-logo'>
                  <Icon name={status.tone === 'bad' ? 'alert' : status.tone === 'warn' ? 'clock' : 'check'} />
                </span>
                <div className='m-grow'>
                  <div className='m-t1' style={{ fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {requestModel(row)}
                  </div>
                  <div className='m-t2' style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {traceProvider(row.provider, row.providerLabel)}
                    {row.accountName ? ` · ${row.accountName}` : ''}
                    {switches ? ` · ${t('切换 {n} 次', { n: switches })}` : row.route?.stickyHit ? ` · ${t('粘滞命中')}` : ''}
                  </div>
                </div>
                <div style={{ flex: 'none', textAlign: 'right' }}>
                  <div className='m-mono' style={{ fontSize: 11 }}>{formatClock(row.ts)}</div>
                  <Badge tone={status.tone}>{status.text}</Badge>
                </div>
              </Button>
            )
          })}
        </Card>
      ) : (
        <Card className='m-card'>
          <Empty text={loading ? t('正在读取请求记录…') : t('这个时间窗里没有请求记录。')} />
        </Card>
      )}

      {hasMore ? (
        <div style={{ marginTop: 10 }}>
          <Button
            variant='outline'
            className='m-btn w-full'
            disabled={loading}
            onClick={() => void loadRows(offset + PAGE_SIZE)}
          >
            {loading ? t('加载中…') : t('加载更多（还有 {n} 条）', { n: Math.max(0, matched - rows.length) })}
          </Button>
        </div>
      ) : null}

      <p style={{ fontSize: 11, color: 'var(--m-text-3)', lineHeight: 1.7, marginTop: 10 }}>
        {t('点开一条可以看网关当时试了哪个账号、为什么失败、以及当时的候选队列快照。请求记录只保留网关自己规定的时长，更早的记录不再可查。')}
      </p>

      {opened ? <RoutingTraceSheet row={opened} onClose={() => setOpened(null)} /> : null}
    </div>
  )
}
