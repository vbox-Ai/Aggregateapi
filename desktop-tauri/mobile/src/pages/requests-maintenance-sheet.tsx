import { useCallback, useEffect, useState } from 'react'
import { Alert, AlertDescription, Button, Card, FieldLabel, Input, Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@ui'
import { serverIdentity } from '../lib/servers'
import { store } from '../state/store'
import {
  clearRequests, compactRequestsDb, fetchRequestClearPreview, formatDbBytes,
  type RequestClearPreview, type RequestMaintenanceQuery,
} from '../api/request-maintenance'
import { formatStamp } from '../lib/format'
import { t } from '../i18n'

/**
 * 请求记录的维护面板：清理（含预览）+ 压缩。
 *
 * ── 为什么必须先预览再删 ──────────────────────────────────────
 * 清理**不可恢复**。上游为此把「预览」与「执行」拆成两条接口，并要求两者
 * **共用同一份筛选计划**（都走 `checked_filter`）——所以这里把列表当前的筛选
 * 原样传给两边：预览说删 N 条，执行删的就是那 N 条。
 *
 * ── 两处上游护栏照搬，不绕开 ──────────────────────────────────
 *  1. **没有任何筛选时必须显式带 `all=1`**（上游原话：「未指定筛选条件：要清空
 *     全部请求数据请显式带 all=1」）。桌面端同样是 `hasFilters ? 筛选 : all=1`。
 *     我这里的判定**偏向保守**：只要可能算筛选就不加 `all=1` —— 那种情况上游会
 *     400（安全的失败），而不是把整库静默删掉。
 *  2. 两种模式差别写清楚：`raw` 只清报文原文（保留明细与日报）；`all` 连明细一起
 *     删，**无筛选时连日报一起归零**（日报是全量聚合，按剩余明细重算会抹掉此前
 *     已清理请求的历史贡献，所以有筛选时反而不动日报）。
 */
export function RequestsMaintenanceSheet({ query, onClose, onCleared }: {
  query: RequestMaintenanceQuery
  onClose: () => void
  onCleared: () => void
}) {
  const [preview, setPreview] = useState<RequestClearPreview | null>(null)
  const [mode, setMode] = useState<'all' | 'raw'>('all')
  const [phrase, setPhrase] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [result, setResult] = useState('')
  const identity = serverIdentity()
  const expected = t('删除')

  /** 与上游 `RequestQuery::has_filters` 同口径的键（宁可判成有筛选） */
  const filtered = ['model', 'provider', 'client', 'apiKey', 'status', 'productionOnly', 'completedOnly', 'startDate', 'endDate']
    .some(key => {
      const value = query[key]
      return typeof value === 'string' && value.trim() !== ''
    })
  const target: RequestMaintenanceQuery = filtered ? query : { ...query, all: '1' }

  const load = useCallback(async (silent = false) => {
    if (!silent) setBusy('preview')
    try {
      const next = await fetchRequestClearPreview(target)
      if (serverIdentity() !== identity) return
      setPreview(next)
      setError('')
    } catch (failure) {
      if (serverIdentity() === identity) {
        setError(failure instanceof Error ? failure.message : String(failure))
      }
    } finally {
      if (serverIdentity() === identity) setBusy('')
    }
    // target 由当前筛选派生，筛选不变时引用稳定即可；这里按 query 重建
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, JSON.stringify(target)])

  useEffect(() => {
    void load()
  }, [load])

  // 压缩是后台任务：受理之后看预览里的 vacuumRunning / lastVacuum
  useEffect(() => {
    if (!preview?.vacuumRunning) return
    const timer = window.setTimeout(() => void load(true), 2500)
    return () => window.clearTimeout(timer)
  }, [preview?.vacuumRunning, load])

  const run = async () => {
    if (busy || phrase.trim() !== expected) return
    setBusy('clear')
    setError('')
    setResult('')
    try {
      const cleared = await clearRequests(target, mode)
      if (serverIdentity() !== identity) return
      const deleted = Number(cleared?.deleted) || 0
      setResult(mode === 'all'
        ? t('已删除 {n} 条请求明细（报文 {raw} 条）', { n: deleted, raw: Number(cleared?.raw) || 0 })
        : t('已清空 {n} 条记录的报文原文（明细保留）', { n: Number(cleared?.raw) || deleted }))
      setPhrase('')
      store.toast(t('清理完成'))
      onCleared()
      await load(true)
    } catch (failure) {
      if (serverIdentity() === identity) {
        setError(failure instanceof Error ? failure.message : String(failure))
      }
    } finally {
      if (serverIdentity() === identity) setBusy('')
    }
  }

  const compact = async () => {
    if (busy) return
    setBusy('compact')
    setError('')
    try {
      const started = await compactRequestsDb()
      if (serverIdentity() !== identity) return
      if (started?.started !== true) throw new Error(t('压缩未受理，请稍后重试'))
      store.toast(t('已开始压缩数据库'))
      await load(true)
    } catch (failure) {
      if (serverIdentity() === identity) {
        setError(failure instanceof Error ? failure.message : String(failure))
      }
    } finally {
      if (serverIdentity() === identity) setBusy('')
    }
  }

  const deleteCount = Number(mode === 'all' ? preview?.all : preview?.raw) || 0

  return (
    <Sheet open onOpenChange={(open, details) => {
      if (open) return
      if (busy) { details.cancel(); return }
      onClose()
    }}>
      <SheetContent showCloseButton={!busy}>
        <SheetHeader><SheetTitle>{t('清理请求记录')}</SheetTitle></SheetHeader>
        <SheetBody>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 8 }}>
            <Card className='m-card m-card-pad'>
              <div className='m-ck-toolbar'>
                <div className='m-ck-grow'>
                  <div className='m-ck-title'>{filtered ? t('按当前筛选清理') : t('清理全部请求记录')}</div>
                  <div className='m-ck-note'>
                    {filtered
                      ? t('筛选条件与列表一致；改筛选请先关掉这个面板')
                      : t('当前没有任何筛选条件 —— 这是全量清理')}
                  </div>
                </div>
                <Button variant='outline' size='sm' disabled={Boolean(busy)} onClick={() => void load()}>
                  {busy === 'preview' ? t('读取中…') : t('刷新预览')}
                </Button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8, fontSize: 12.5 }}>
                <div>{t('命中请求明细：{n} 条', { n: preview ? String(Number(preview.all) || 0) : '—' })}</div>
                <div>{t('含报文原文：{n} 条（上游 {up} · 下游 {down}）', {
                  n: preview ? String(Number(preview.raw) || 0) : '—',
                  up: preview ? String(Number(preview.upstreamRaw) || 0) : '—',
                  down: preview ? String(Number(preview.downstreamRaw) || 0) : '—',
                })}</div>
                <div style={{ color: 'var(--m-text-3)' }}>
                  {t('数据库占用：{size}（全库，不按筛选计算）', { size: preview ? formatDbBytes(preview.dbBytes) : '—' })}
                </div>
                {preview?.vacuumRunning ? (
                  <div style={{ color: 'var(--m-text-2)' }}>{t('正在压缩数据库…')}</div>
                ) : preview?.lastVacuum ? (
                  <div style={{ color: 'var(--m-text-3)' }}>
                    {t('上次压缩：{time}', { time: formatStamp(preview.lastVacuum) })}
                  </div>
                ) : null}
              </div>
            </Card>

            <div>
              <FieldLabel className='block text-[12px] text-muted-foreground'>{t('清理方式')}</FieldLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
                <Button variant={mode === 'all' ? 'default' : 'outline'} className='h-auto w-full justify-start py-3 text-left'
                  disabled={Boolean(busy)} onClick={() => setMode('all')}>
                  <div>
                    <div className='m-t1'>{t('全部删除')}</div>
                    <div className='m-t2'>{t('明细、报文原文与统计行一起删；无筛选时会连日报一起归零')}</div>
                  </div>
                </Button>
                <Button variant={mode === 'raw' ? 'default' : 'outline'} className='h-auto w-full justify-start py-3 text-left'
                  disabled={Boolean(busy)} onClick={() => setMode('raw')}>
                  <div>
                    <div className='m-t1'>{t('仅清空报文原文')}</div>
                    <div className='m-t2'>{t('保留请求明细与日报，只删两侧正文（省空间最有效）')}</div>
                  </div>
                </Button>
              </div>
            </div>

            <Alert variant='destructive'>
              <AlertDescription>{t('删除后无法恢复。要留证据请先导出或先做整库备份。')}</AlertDescription>
            </Alert>

            <div>
              <FieldLabel className='block text-[12px] text-muted-foreground'>{t('输入「删除」两个字确认')}</FieldLabel>
              <Input value={phrase} onChange={event => setPhrase(event.currentTarget.value)}
                placeholder={expected} className='h-[46px] text-base'
                aria-label={t('确认清理请求记录')} disabled={Boolean(busy)} />
            </div>

            {result ? <p style={{ fontSize: 12, color: 'var(--m-text-2)' }}>{result}</p> : null}
            {error ? <p style={{ fontSize: 12, color: 'var(--m-danger)', whiteSpace: 'pre-wrap' }}>{error}</p> : null}

            <div style={{ borderTop: '1px solid var(--m-line)', paddingTop: 12 }}>
              <div className='m-ck-toolbar'>
                <div className='m-ck-grow'>
                  <div className='m-ck-title'>{t('压缩数据库')}</div>
                  <div className='m-ck-note'>{t('只回收磁盘空间，不删任何数据；在后台执行，可随时关掉这个面板')}</div>
                </div>
                <Button variant='outline' size='sm' disabled={Boolean(busy) || preview?.vacuumRunning === true}
                  onClick={() => void compact()}>
                  {preview?.vacuumRunning ? t('压缩中…') : t('开始压缩')}
                </Button>
              </div>
            </div>
          </div>
        </SheetBody>
        <SheetFooter>
          <Button variant='outline' disabled={Boolean(busy)} onClick={onClose}>{t('取消')}</Button>
          <Button variant='destructive'
            disabled={Boolean(busy) || phrase.trim() !== expected || !preview}
            onClick={() => void run()}>
            {busy === 'clear'
              ? t('清理中…')
              : mode === 'all'
                ? t('永久删除 {n} 条请求记录', { n: deleteCount })
                : t('永久删除 {n} 条记录的报文原文', { n: deleteCount })}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
