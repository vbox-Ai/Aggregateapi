import { useCallback, useEffect, useState } from 'react'
import { Alert, AlertDescription, Button, Card, Input, Label, Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTitle, confirmDialog } from '@ui'
import { Empty, ErrorNote } from '../components/ui'
import { serverIdentity } from '../lib/servers'
import { store } from '../state/store'
import { t } from '../i18n'
import {
  RETENTION_FIELDS,
  RETENTION_LIMITS,
  fetchRetention,
  fetchStorage,
  putRetention,
  type RetentionSettings,
  type StorageSnapshot,
} from '../api/storage'

/**
 * 数据与存储。
 *
 * 上半是**只读**的存储快照（`GET /api/storage`，网关没有写路由）；
 * 下半是数据保留策略（`GET/PUT /api/retention`）。
 *
 * ⚠️ 保留策略**保存后会立即裁剪**：超出新上限的历史记录当场删除、不可恢复。
 * 所以保存前必须二次确认，而且文案里要说清删的是什么。
 */
export function DataStorageSheet({ onClose }: { onClose: () => void }) {
  const identity = serverIdentity()
  const [storage, setStorage] = useState<StorageSnapshot | null>(null)
  const [retention, setRetention] = useState<RetentionSettings | null>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const [nextStorage, nextRetention] = await Promise.all([fetchStorage(), fetchRetention()])
      if (serverIdentity() !== identity) return
      setStorage(nextStorage)
      setRetention(nextRetention)
      setDraft(
        Object.fromEntries(
          RETENTION_FIELDS.map(field => [field.key, String(nextRetention[field.key] ?? field.fallback)]),
        ),
      )
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

  const save = async () => {
    if (busy || !retention) return
    const patch: RetentionSettings = {}
    const summary: string[] = []
    for (const field of RETENTION_FIELDS) {
      const raw = (draft[field.key] || '').trim()
      const value = Number(raw)
      const limits = field.kind === 'days' ? RETENTION_LIMITS.days : RETENTION_LIMITS.count
      if (!raw || !Number.isFinite(value) || !Number.isInteger(value)) {
        setError(t('{field} 需要填整数', { field: retentionLabel(field.key) }))
        return
      }
      if (value < limits.min || value > limits.max) {
        setError(t('{field} 需要在 {min}–{max} 之间', { field: retentionLabel(field.key), min: limits.min, max: limits.max }))
        return
      }
      if (value !== retention[field.key]) {
        patch[field.key] = value
        summary.push(`${retentionLabel(field.key)} → ${value}`)
      }
    }
    if (!Object.keys(patch).length) {
      store.toast(t('没有改动'))
      return
    }
    const ok = await confirmDialog(
      t('保存后会立即按新上限裁剪，超出部分的历史记录会被永久删除（不可恢复）：\n{list}', {
        list: summary.join('\n'),
      }),
      { title: t('确认调整保留策略'), confirmText: t('裁剪并保存'), destructive: true },
    )
    if (!ok) return

    setBusy('save')
    setError('')
    try {
      const next = await putRetention(patch)
      if (serverIdentity() !== identity) return
      setRetention(next)
      setDraft(
        Object.fromEntries(
          RETENTION_FIELDS.map(field => [field.key, String(next[field.key] ?? field.fallback)]),
        ),
      )
      store.toast(t('已保存并裁剪'))
      // 裁剪后占用会变，顺手刷新上半部分
      void fetchStorage()
        .then(updated => { if (serverIdentity() === identity) setStorage(updated) })
        .catch(() => undefined)
    } catch (cause) {
      if (serverIdentity() === identity) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (serverIdentity() === identity) setBusy('')
    }
  }

  const db = storage?.database || {}
  const available = db.available !== false

  return (
    <Sheet open onOpenChange={open => { if (!open) onClose() }}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{t('数据与存储')}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          {error ? <ErrorNote text={error} /> : null}
          {loading ? <Card className='m-card'><Empty text={t('正在读取存储信息…')} /></Card> : null}

          {!loading ? (
            <>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--m-text-3)', padding: '2px 2px 6px' }}>
                {t('存储用量')}
              </div>
              <Card className='m-card'>
                <div className='m-rows' style={{ borderRadius: 0, border: 0 }}>
                  <div className='m-row'>
                    <span className='m-k'>{t('占用大小')}</span>
                    <span className='m-v m-mono'>{available ? formatBytes(db.bytes) : t('库不可用')}</span>
                  </div>
                  <div className='m-row'>
                    <span className='m-k'>{t('数据库文件')}</span>
                    <span className='m-v m-mono' style={{ wordBreak: 'break-all' }}>{db.file || t('—')}</span>
                  </div>
                </div>
                <div className='m-kv' style={{ padding: 12 }}>
                  <Cell label={t('账号')} value={number(db.accounts)} />
                  <Cell label={t('事件日志')} value={number(db.logs)} />
                  <Cell label={t('请求记录')} value={number(db.requests)} />
                  <Cell label={t('报表天数')} value={number(db.dailyDays)} />
                  <Cell label={t('上游报文')} value={number(db.upstreamRaw)} />
                  <Cell label={t('下游正文')} value={number(db.downstreamRaw)} />
                </div>
              </Card>

              <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--m-text-3)', padding: '14px 2px 6px' }}>
                {t('数据保留')}
              </div>
              <Card className='m-card m-card-pad'>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {RETENTION_FIELDS.map(field => (
                    <div key={field.key}>
                      <Label htmlFor={`retention-${field.key}`}>{retentionLabel(field.key)}</Label>
                      <Input
                        id={`retention-${field.key}`}
                        inputMode='numeric'
                        value={draft[field.key] || ''}
                        onChange={event => setDraft({ ...draft, [field.key]: event.currentTarget.value })}
                      />
                      <p style={{ fontSize: 11.5, color: 'var(--m-text-3)', marginTop: 4 }}>
                        {field.kind === 'days'
                          ? t('天数，1–{max}；默认 {fallback}', { max: RETENTION_LIMITS.days.max, fallback: field.fallback })
                          : t('条数上限，1–{max}；默认 {fallback}', { max: RETENTION_LIMITS.count.max, fallback: field.fallback })}
                      </p>
                    </div>
                  ))}
                </div>
              </Card>
              <Alert variant='warning'>
                <AlertDescription>
                  {t('保存后网关会立即按新上限裁剪，超出部分当场删除且不可恢复。历史太长的表建议先做一次整库备份。')}
                </AlertDescription>
              </Alert>
            </>
          ) : null}
        </SheetBody>
        <SheetFooter>
          <Button variant='outline' disabled={Boolean(busy)} onClick={onClose}>{t('关闭')}</Button>
          <Button disabled={Boolean(busy) || loading} onClick={() => void save()}>
            {busy === 'save' ? t('保存中…') : t('保存保留策略')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

/** 保留项 → 中文标签 */
function retentionLabel(key: keyof RetentionSettings): string {
  if (key === 'logRetentionDays') return t('事件日志保留天数')
  if (key === 'logRetentionCount') return t('事件日志条数上限')
  if (key === 'requestLogRetentionDays') return t('请求日志保留天数')
  if (key === 'requestLogRetentionCount') return t('请求日志条数上限')
  return t('按天聚合保留天数')
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className='m-kv-cell'>
      <div className='k'>{label}</div>
      <div className='v'>{value}</div>
    </div>
  )
}

function number(value: number | undefined): string {
  return Number.isFinite(value) ? String(value) : '0'
}

/** 字节 → 人类可读（与版本信息抽屉同一口径） */
function formatBytes(bytes: number | undefined): string {
  const value = Number(bytes)
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  if (value < 1024) return `${value} B`
  const kb = value / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(1)} MB`
  return `${(mb / 1024).toFixed(2)} GB`
}
