import { useCallback, useEffect, useState } from 'react'
import { Alert, AlertDescription, Button, Card, Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTitle, Switch } from '@ui'
import { Badge, Empty, ErrorNote } from '../components/ui'
import { Icon } from '../components/Icon'
import { serverIdentity } from '../lib/servers'
import { store } from '../state/store'
import { formatStamp } from '../lib/format'
import { t } from '../i18n'
import {
  fetchModelMetadata,
  putModelMetadata,
  refreshModelMetadata,
  sourceLabel,
  type ModelMetadataStatus,
  type RefreshResult,
} from '../api/model-metadata'

/**
 * models.dev 模型元数据。
 *
 * 用来补齐上游没声明的模型能力与思考档位。**内嵌快照始终生效**，这个开关只管
 * 联网刷新 —— 关掉后已装载的索引继续用，不是「关掉就没元数据」。
 *
 * 「立即刷新」的手动间隔是 24 小时：冷却中会返回 `skipped` + `retryAt`，界面要把
 * 这个时刻显示出来，否则用户只会看到「没反应」。刷新接口**永远 2xx**，
 * 成败看 `result.status`。
 */
export function ModelMetadataSheet({ onClose }: { onClose: () => void }) {
  const identity = serverIdentity()
  const [status, setStatus] = useState<ModelMetadataStatus | null>(null)
  const [result, setResult] = useState<RefreshResult | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const next = await fetchModelMetadata()
      if (serverIdentity() !== identity) return
      setStatus(next)
      setError('')
    } catch (cause) {
      if (serverIdentity() === identity) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (serverIdentity() === identity) setLoading(false)
    }
  }, [identity])

  useEffect(() => {
    void load()
  }, [load])

  const toggle = async (next: boolean) => {
    if (busy) return
    const previous = status
    setStatus(current => ({ ...(current || {}), modelsDevEnabled: next }))
    setBusy('switch')
    setError('')
    try {
      const saved = await putModelMetadata(next)
      if (serverIdentity() !== identity) return
      setStatus(saved)
      store.toast(next ? t('已开启联网刷新') : t('已关闭联网刷新'))
    } catch (cause) {
      if (serverIdentity() === identity) {
        setStatus(previous)
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    } finally {
      if (serverIdentity() === identity) setBusy('')
    }
  }

  const refresh = async () => {
    if (busy) return
    setBusy('refresh')
    setError('')
    setResult(null)
    try {
      const response = await refreshModelMetadata()
      if (serverIdentity() !== identity) return
      setResult(response.result || null)
      if (response.status) setStatus(response.status)
      const outcome = response.result
      if (outcome?.status === 'refreshed') store.toast(t('已刷新 {count} 条模型元数据', { count: outcome.count || 0 }))
      else if (outcome?.status === 'skipped') store.toast(t('本次跳过刷新'))
      else if (outcome?.status === 'failed') store.toast(t('刷新失败'))
    } catch (cause) {
      if (serverIdentity() === identity) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (serverIdentity() === identity) setBusy('')
    }
  }

  const enabled = status?.modelsDevEnabled !== false

  return (
    <Sheet open onOpenChange={open => { if (!open) onClose() }}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{t('模型元数据（models.dev）')}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          {error ? <ErrorNote text={error} /> : null}
          {loading ? <Card className='m-card'><Empty text={t('正在读取元数据状态…')} /></Card> : null}

          {!loading ? (
            <>
              <Card className='m-card'>
                <div className='m-row' style={{ alignItems: 'flex-start' }}>
                  <span className='m-logo'>
                    <Icon name='model' />
                  </span>
                  <div className='m-grow'>
                    <div className='m-t1'>{t('联网刷新模型元数据')}</div>
                    <div className='m-t2'>{t('补齐上游没声明的模型能力与思考档位')}</div>
                  </div>
                  <Switch
                    checked={enabled}
                    aria-label={t('联网刷新模型元数据')}
                    onCheckedChange={value => void toggle(value === true)}
                  />
                </div>
              </Card>
              <p style={{ fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.7, padding: '6px 2px 0' }}>
                {t('关掉只停联网刷新：已经装载的元数据继续生效，内嵌快照任何时候都在。')}
              </p>

              <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--m-text-3)', padding: '14px 2px 6px' }}>
                {t('当前索引')}
              </div>
              <Card className='m-card'>
                <div className='m-rows' style={{ borderRadius: 0, border: 0 }}>
                  <div className='m-row'>
                    <span className='m-k'>{t('来历')}</span>
                    <span className='m-v'>{sourceLabel(status?.source, t)}</span>
                  </div>
                  <div className='m-row'>
                    <span className='m-k'>{t('模型条数')}</span>
                    <span className='m-v m-mono'>{status?.count ? String(status.count) : '0'}</span>
                  </div>
                  <div className='m-row'>
                    <span className='m-k'>{t('生成时刻')}</span>
                    <span className='m-v m-mono'>
                      {status?.updatedAt ? formatStamp(status.updatedAt) : t('未知')}
                    </span>
                  </div>
                </div>
              </Card>

              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <Button variant='outline' disabled={Boolean(busy)} onClick={() => void refresh()}>
                  {busy === 'refresh' ? t('刷新中…') : t('立即刷新')}
                </Button>
              </div>
              <p style={{ fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.7, padding: '6px 2px 0' }}>
                {t('手动刷新有 24 小时间隔：冷却中会跳过并给出下次可刷新的时刻。')}
              </p>

              {result ? (
                <Card className='m-card m-card-pad' style={{ marginTop: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <Badge tone={result.status === 'refreshed' ? 'ok' : result.status === 'failed' ? 'bad' : 'warn'}>
                      {result.status === 'refreshed' ? t('已刷新') : result.status === 'failed' ? t('失败') : t('已跳过')}
                    </Badge>
                    {result.providerLabel ? (
                      <span style={{ fontSize: 12, color: 'var(--m-text-2)' }}>{result.providerLabel}</span>
                    ) : null}
                  </div>
                  {typeof result.count === 'number' ? (
                    <div className='m-mono' style={{ fontSize: 12, color: 'var(--m-text-2)' }}>
                      {t('{count} 条', { count: result.count })}
                    </div>
                  ) : null}
                  {result.message ? (
                    <div style={{ fontSize: 12, color: 'var(--m-text-2)', lineHeight: 1.6 }}>{result.message}</div>
                  ) : null}
                  {result.retryAt ? (
                    <div className='m-mono' style={{ fontSize: 11.5, color: 'var(--m-text-3)', marginTop: 4 }}>
                      {t('下次可刷新：{time}', { time: formatStamp(result.retryAt) })}
                    </div>
                  ) : null}
                </Card>
              ) : null}

              <Alert variant='default'>
                <AlertDescription>
                  {t('会上网拉取公开的模型元数据（models.dev）。关掉后刷新接口直接跳过，不发网络请求。')}
                </AlertDescription>
              </Alert>
            </>
          ) : null}
        </SheetBody>
        <SheetFooter>
          <Button variant='outline' onClick={onClose}>{t('关闭')}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
