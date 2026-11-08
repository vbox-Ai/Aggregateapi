import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Input, Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTitle, confirmDialog } from '@ui'
import { Badge, Empty, ErrorNote } from '../components/ui'
import { Icon } from '../components/Icon'
import { serverIdentity } from '../lib/servers'
import { formatDuration } from '../lib/format'
import { t } from '../i18n'
import { clearRoutingSticky, fetchRoutingSticky, stickyHint, stickyLabel, type StickyEntry, type StickyState } from '../api/routing'

/**
 * 会话粘滞：查看与解除。
 *
 * 数据源 `GET /api/routing/sticky?model=`，解除走 `POST /api/routing/sticky/clear`。
 *
 * ── 为什么要补偿时钟差 ───────────────────────────────────────
 * 倒计时按 `expiresAt - now` 算，而 `now` 用的是**网关返回的时间**。手机时钟
 * 与网关差几分钟是常事，直接用 `Date.now()` 会让剩下的时间看起来忽长忽短。
 * 所以这里记一份 `offset = 网关now - 本机now`，之后每秒用 `本机now + offset` 走表。
 *
 * ── 「没有绑定」不等于「坏了」──────────────────────────────
 * 粘性档位是 `turn` / `off` 时，网关本来就不保留跨请求绑定，列表空是**正确状态**。
 * 不提示这一句，用户会以为功能没生效。
 */
export function RoutingStickySheet({ model, onClose }: { model?: string; onClose: () => void }) {
  const identity = serverIdentity()
  const [state, setState] = useState<StickyState | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [offset, setOffset] = useState(0)
  const [now, setNow] = useState(() => Date.now())

  const load = useCallback(async () => {
    try {
      const next = await fetchRoutingSticky(model || undefined)
      if (serverIdentity() !== identity) return
      setState(next)
      // 网关与本机的时钟差：倒计时按网关时间走，避免手机时钟偏了看着忽长忽短
      setOffset((next.now || Date.now()) - Date.now())
      setNow(next.now || Date.now())
      setError('')
    } catch (cause) {
      if (serverIdentity() === identity) setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [identity, model])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now() + offset), 1000)
    return () => window.clearInterval(timer)
  }, [offset])

  const mode = state?.sticky || ''
  const active = (state?.entries || []).filter(entry => entry.expiresAt > now)
  const query = search.trim().toLowerCase()
  const visible = query
    ? active.filter(entry =>
        `${entry.model} ${entry.accountName} ${entry.providerLabel} ${entry.source} ${entry.keyPreview}`
          .toLowerCase()
          .includes(query),
      )
    : active
  const noCrossRequest = mode === 'off' || mode === 'turn'

  const clearAll = async () => {
    if (busy) return
    const ok = await confirmDialog(
      model
        ? t('解除这个模型的全部会话粘滞。不会终止在途请求，之后的请求会重新选路。')
        : t('解除所有模型的全部会话粘滞。不会终止在途请求，之后的请求会重新选路。'),
      { title: t('清除会话粘滞'), confirmText: t('全部解除'), destructive: true },
    )
    if (!ok) return
    setBusy(true)
    try {
      const result = await clearRoutingSticky(model ? { model } : { all: true })
      if (serverIdentity() !== identity) return
      setState(current => (current ? { ...current, entries: [] } : current))
      await load()
    } catch (cause) {
      if (serverIdentity() === identity) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (serverIdentity() === identity) setBusy(false)
    }
  }

  const clearOne = async (entry: StickyEntry) => {
    if (busy) return
    setBusy(true)
    try {
      // id 与 model 一起给：后端按 id 定位，model 用来确定归属
      await clearRoutingSticky({ id: entry.id, model: entry.model })
      if (serverIdentity() !== identity) return
      setState(current => (current ? { ...current, entries: current.entries.filter(item => item.id !== entry.id) } : current))
      await load()
    } catch (cause) {
      if (serverIdentity() === identity) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (serverIdentity() === identity) setBusy(false)
    }
  }

  return (
    <Sheet open onOpenChange={open => { if (!open && !busy) onClose() }}>
      <SheetContent showCloseButton={!busy}>
        <SheetHeader>
          <SheetTitle>{t('会话粘滞')}{model ? ` · ${model}` : ` · ${t('全部模型')}`}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          {error ? <ErrorNote text={error} /> : null}

          <Card className='m-card m-card-pad'>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Badge tone='mute'>{t('粘性：{mode}', { mode: stickyLabel(mode) })}</Badge>
              <span style={{ fontSize: 11.5, color: 'var(--m-text-3)' }}>{t('{n} 条活跃绑定', { n: active.length })}</span>
            </div>
            <p style={{ fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.7, marginTop: 8 }}>
              {t('解除只清除网关的账号绑定，不删除聊天历史、不关闭粘性设置。后续成功请求仍可建立新的绑定；重启网关会清空这些进程本地记录。')}
            </p>
            <p style={{ fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.7, marginTop: 4 }}>
              {stickyHint(mode)}
            </p>
          </Card>

          {noCrossRequest ? (
            <Card className='m-card m-card-pad' style={{ marginTop: 10 }}>
              <p style={{ fontSize: 12, color: 'var(--m-warn)', lineHeight: 1.7, margin: 0 }}>
                {t('当前档位不保留跨请求粘滞，因此没有活跃绑定 —— 这是正常的，不是故障。')}
              </p>
            </Card>
          ) : null}

          <div style={{ marginTop: 12 }}>
            <Input
              value={search}
              placeholder={t('搜索模型、账号或会话来源')}
              onChange={event => setSearch(event.currentTarget.value)}
            />
          </div>

          <div style={{ marginTop: 12 }}>
            {visible.length ? (
              <Card className='m-card'>
                {visible.map((entry, index) => (
                  <div key={entry.id} style={{ padding: '11px 14px', borderTop: index ? '1px solid var(--m-line)' : undefined }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className='m-logo' style={{ flex: 'none' }}><Icon name='link' /></span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className='m-t1' style={{ fontSize: 12.5 }}>{entry.accountName}</div>
                        <div className='m-t2'>{entry.providerLabel} · {entry.model}</div>
                      </div>
                      <div style={{ flex: 'none', textAlign: 'right' }}>
                        <div className='m-mono' style={{ fontSize: 11.5 }}>{formatDuration(entry.expiresAt - now)}</div>
                        <div style={{ fontSize: 10.5, color: 'var(--m-text-3)' }}>{t('后过期')}</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                      <Badge tone='mute'>{entry.source === 'content-hash' ? t('内容哈希') : entry.source}</Badge>
                      <span className='m-mono' style={{ fontSize: 11, color: 'var(--m-text-3)' }}>{entry.keyPreview}</span>
                      <span style={{ fontSize: 11, color: 'var(--m-text-3)' }}>{t('命中 {n} 次', { n: entry.hits })}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
                      <span style={{ fontSize: 10.5, color: 'var(--m-text-3)' }}>
                        {t('最近使用')} {formatStampSafe(entry.lastSeen)}
                      </span>
                      <Button size='sm' variant='ghost' disabled={busy} onClick={() => void clearOne(entry)}>
                        {t('解除')}
                      </Button>
                    </div>
                  </div>
                ))}
              </Card>
            ) : (
              <Card className='m-card'>
                <Empty text={state ? t('没有匹配的活跃绑定。') : t('正在读取会话粘滞…')} />
              </Card>
            )}
          </div>
        </SheetBody>
        <SheetFooter>
          <Button variant='outline' disabled={busy} onClick={() => void load()}>{t('刷新')}</Button>
          <Button variant='destructive' disabled={busy || !active.length} onClick={() => void clearAll()}>
            {model ? t('解除该模型全部') : t('解除全部')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

/** `lastSeen` 是毫秒时间戳；坏值不要抛，原样显示 */
function formatStampSafe(ts: number): string {
  const date = new Date(ts)
  return Number.isNaN(date.getTime()) ? String(ts) : date.toLocaleString()
}
