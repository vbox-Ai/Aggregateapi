import { useEffect, useState } from 'react'
import { Button, Card, Input, Label, Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@ui'
import { Alert, AlertDescription } from '@ui'
import { Empty, ErrorNote } from '../components/ui'
import { serverIdentity } from '../lib/servers'
import { store } from '../state/store'
import { t } from '../i18n'
import { fetchUpdateProxy, putUpdateProxy, validateProxy } from '../api/update-proxy'

/**
 * 更新出网代理。
 *
 * 只影响「检查更新 / 下载更新包」这条链路，不影响转发上网关调上游 ——
 * 后者是账号级的「出网代理」，在添加账号那里配置。这两处容易混，界面上写清。
 */
export function UpdateProxySheet({ onClose }: { onClose: () => void }) {
  const identity = serverIdentity()
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const run = async () => {
      try {
        const next = await fetchUpdateProxy()
        if (serverIdentity() !== identity) return
        setValue(next.proxy || '')
      } catch (cause) {
        if (serverIdentity() === identity) setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        if (serverIdentity() === identity) setLoading(false)
      }
    }
    void run()
  }, [identity])

  const save = async () => {
    if (busy) return
    const invalid = validateProxy(value, t)
    if (invalid) {
      setError(invalid)
      return
    }
    setBusy(true)
    setError('')
    try {
      const next = await putUpdateProxy(value.trim())
      if (serverIdentity() !== identity) return
      setValue(next.proxy || '')
      store.toast(value.trim() ? t('已保存出网代理') : t('已清除出网代理'))
    } catch (cause) {
      if (serverIdentity() === identity) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (serverIdentity() === identity) setBusy(false)
    }
  }

  return (
    <Sheet open onOpenChange={(open, details) => {
      if (open) return
      if (busy) { details.cancel(); return }
      onClose()
    }}>
      <SheetContent showCloseButton={!busy}>
        <SheetHeader>
          <SheetTitle>{t('更新出网代理')}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          {error ? <ErrorNote text={error} /> : null}
          {loading ? <Card className='m-card'><Empty text={t('正在读取…')} /></Card> : null}

          {!loading ? (
            <>
              <Card className='m-card m-card-pad'>
                <Label htmlFor='update-proxy'>{t('代理地址')}</Label>
                <Input
                  id='update-proxy'
                  className='m-mono'
                  placeholder='http://127.0.0.1:7890'
                  value={value}
                  onChange={event => setValue(event.currentTarget.value)}
                />
                <p style={{ fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.7, marginTop: 4 }}>
                  {t('格式：主机:端口，可带 http:// 或 socks5:// 前缀。留空并保存 = 清除代理，直连。')}
                </p>
              </Card>
              <Alert variant='default'>
                <AlertDescription>
                  {t('只影响「检查更新 / 下载更新包」。网关转发上游走的是账号级的「出网代理」，不在这里。')}
                </AlertDescription>
              </Alert>
            </>
          ) : null}
        </SheetBody>
        <SheetFooter>
          <Button variant='outline' disabled={busy} onClick={onClose}>{t('取消')}</Button>
          <Button disabled={busy || loading} onClick={() => void save()}>
            {busy ? t('保存中…') : t('保存')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
