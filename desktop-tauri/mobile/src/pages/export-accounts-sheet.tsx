import { useState } from 'react'
import { Button, Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@ui'
import { ProviderLogo } from '../components/ProviderLogo'
import { Icon } from '../components/Icon'
import { exportAccountFile, exportAccounts } from '../api/gateway'
import { downloadJson, dateStamp } from '../lib/download'
import { store } from '../state/store'
import { t } from '../i18n'

/**
 * 导出账号 —— 可选范围。
 *
 * 原来账号页那颗「导出」一点就**全量导出**（`GET /api/accounts/export`），想只要某一家
 * 或只要勾选的那几条时没有选择余地。网关侧其实早就有按范围的接口：
 * `POST /api/accounts/export-files`，选择器是 `{ id }` 或 `{ provider }`，
 * **两个都传以 id 为准**（见 accounts_export.rs）。所以这里把三条路都摆出来：
 *
 *   · 全部：仍走 `/api/accounts/export`（含自定义提供商定义，是完整的备份形态）；
 *   · 按提供商：只导这一家的全部账号；
 *   · 仅勾选的：逐条请求后**合并成一个文件**（接口一次只收一个选择器，不能一次给一批 id）。
 *
 * 响应形状是 `{ total, files, failed }` —— `failed` 会一并提示，不静默丢掉。
 */
type Group = { provider: string; label: string; count: number }

type FilesReply = { total?: number; files?: unknown[]; failed?: unknown[] }

export function ExportAccountsSheet({ groups, selectedIds, total, onClose }: {
  groups: Group[]
  selectedIds: string[]
  total: number
  onClose: () => void
}) {
  const [busy, setBusy] = useState('')
  const [scope, setScope] = useState<'root' | 'provider'>('root')

  const stamp = `agent2api-accounts-${dateStamp()}.json`

  async function run(key: string, job: () => Promise<void>) {
    if (busy) return
    setBusy(key)
    try {
      await job()
      onClose()
    } catch (failure) {
      store.toast(failure instanceof Error ? failure.message : String(failure), 'err')
    } finally {
      setBusy('')
    }
  }

  /** 合并多个 `{ files }` 响应：接口一次只收一个选择器，多条就逐条取再合并 */
  function mergeFiles(replies: FilesReply[]): FilesReply {
    return {
      total: replies.reduce((sum, item) => sum + (item.files?.length || 0), 0),
      files: replies.flatMap(item => item.files || []),
      failed: replies.flatMap(item => item.failed || []),
    }
  }

  function reportFailed(reply: FilesReply) {
    const failed = reply.failed?.length || 0
    if (failed) store.toast(t('有 {n} 个账号导出失败，已跳过', { n: failed }), 'warn')
  }

  return (
    <Sheet open onOpenChange={open => { if (!open && !busy) onClose() }}>
      <SheetContent showCloseButton={!busy}>
        <SheetHeader>
          <SheetTitle>{scope === 'root' ? t('导出账号') : t('选择提供商')}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          {scope === 'root' ? (
            <>
              <p style={{ fontSize: 12, color: 'var(--m-text-2)', lineHeight: 1.6, marginBottom: 10 }}>
                {t('选择导出范围：全部账号（含自定义提供商定义）、某一家提供商的全部账号，或只导出勾选的账号。')}
              </p>

              <Button variant='outline' style={{ width: '100%', justifyContent: 'flex-start' }}
                disabled={Boolean(busy) || total === 0}
                onClick={() => void run('all', async () => {
                  const data = await exportAccounts()
                  await downloadJson(data, stamp)
                  store.toast(t('已导出 {n} 个账号', { n: total }))
                })}>
                <Icon name='download' style={{ marginRight: 8 }} />
                {busy === 'all' ? t('导出中…') : t('全部账号（{n} 个）', { n: total })}
              </Button>

              <Button variant='outline' style={{ width: '100%', justifyContent: 'flex-start', marginTop: 8 }}
                disabled={Boolean(busy) || groups.length === 0}
                onClick={() => setScope('provider')}>
                <Icon name='doc' style={{ marginRight: 8 }} />
                {t('按提供商导出…')}
              </Button>

              {selectedIds.length > 0 ? (
                <Button variant='outline' style={{ width: '100%', justifyContent: 'flex-start', marginTop: 8 }}
                  disabled={Boolean(busy)}
                  onClick={() => void run('selected', async () => {
                    // 逐条取再合并：接口一次只收一个选择器（{id} 或 {provider}）
                    const replies: FilesReply[] = []
                    for (const id of selectedIds) {
                      replies.push(await exportAccountFile({ id }) as FilesReply)
                    }
                    const merged = mergeFiles(replies)
                    await downloadJson(merged, `agent2api-accounts-selected-${dateStamp()}.json`)
                    reportFailed(merged)
                    store.toast(t('已导出 {n} 个账号', { n: merged.total || selectedIds.length }))
                  })}>
                  <Icon name='check' style={{ marginRight: 8 }} />
                  {busy === 'selected' ? t('导出中…') : t('仅勾选的账号（{n} 个）', { n: selectedIds.length })}
                </Button>
              ) : (
                <p style={{ fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.6, marginTop: 10 }}>
                  {t('想只导几条？先点「批量」勾选账号，这里会多出「仅勾选的账号」。')}
                </p>
              )}
            </>
          ) : (
            <>
              <Button size='sm' variant='outline' className='self-start' onClick={() => setScope('root')}>
                {t('返回')}
              </Button>
              {groups.map(group => (
                <button key={group.provider} type='button' disabled={Boolean(busy)}
                  onClick={() => void run(group.provider, async () => {
                    const reply = await exportAccountFile({ provider: group.provider }) as FilesReply
                    await downloadJson(reply, `agent2api-${group.provider}-${dateStamp()}.json`)
                    reportFailed(reply)
                    store.toast(t('已导出 {n} 个账号', { n: reply.total ?? group.count }))
                  })}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                    padding: '10px 4px', background: 'none', border: 0,
                    borderBottom: '1px solid var(--m-line)', textAlign: 'left',
                    color: 'inherit', opacity: busy && busy !== group.provider ? 0.5 : 1,
                  }}>
                  <ProviderLogo id={group.provider} label={group.label} />
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600 }}>{group.label}</span>
                  <span style={{ fontSize: 11.5, color: 'var(--m-text-3)' }}>
                    {busy === group.provider ? t('导出中…') : t('{n} 个账号', { n: group.count })}
                  </span>
                </button>
              ))}
              {groups.length === 0 ? (
                <p style={{ fontSize: 12, color: 'var(--m-text-3)' }}>{t('当前筛选下没有账号。')}</p>
              ) : null}
            </>
          )}
        </SheetBody>
        <SheetFooter>
          <Button variant='outline' disabled={Boolean(busy)} onClick={onClose}>{t('取消')}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
