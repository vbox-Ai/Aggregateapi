import { useState } from 'react'
import { Alert, AlertDescription, Button, Input, Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@ui'
import { FieldLabel } from '@ui'
import { supervisorFactoryReset } from '../api/supervisor'
import { clearPanelAuth } from '../api/client'
import { store } from '../state/store'
import { t } from '../i18n'

/**
 * 清空整库（重置管理员）。
 *
 * 网关没有「删除全部数据」的接口 —— 账号、配置、日志都躺在同一个库里，
 * 面板管理员的哈希也在里面。所以唯一出路是删库，这件事只有 supervisor
 * 做得到（它持有数据目录），于是走 `POST /factory-reset`。
 *
 * 与登录页那个「忘记管理员密码」是同一个操作，只是入口不同：这里是
 * 「已登录但想把整库重来」的场景。
 */
export function ResetLibrarySheet({ onClose }: { onClose: () => void }) {
  const [phrase, setPhrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const expected = t('重置')

  const run = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await supervisorFactoryReset()
      // 库没了，本地会话也一并清掉，回首次注册
      clearPanelAuth()
      store.setAuthLost('login')
      store.toast(t('整库已清空，请重新注册管理员'))
      onClose()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open onOpenChange={(open, details) => {
      if (open) return
      if (busy) { details.cancel(); return }
      onClose()
    }}>
      <SheetContent showCloseButton={!busy}>
        <SheetHeader><SheetTitle>{t('清空整库')}</SheetTitle></SheetHeader>
        <SheetBody>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 8 }}>
            <Alert variant='destructive'>
              <AlertDescription>
                {t('账号、网关 Key、GitHub 令牌、云同步凭据、日志与全部设置都会被删除，无法恢复。管理员也一并清空，完成后需要重新注册。')}
              </AlertDescription>
            </Alert>
            <p style={{ fontSize: 12, color: 'var(--m-text-2)', lineHeight: 1.6 }}>
              {t('如果还留着账号导出文件或整库备份（.a2ab），清空后可以再导入。建议先做一次备份。')}
            </p>
            <div>
              <FieldLabel className='block text-[12px] text-muted-foreground'>
                {t('输入「重置」两个字确认')}
              </FieldLabel>
              <Input
                value={phrase}
                onChange={event => setPhrase(event.currentTarget.value)}
                placeholder={expected}
                className='h-[46px] text-base'
                aria-label={t('确认清空整库')}
              />
            </div>
            {error ? <p style={{ fontSize: 12, color: 'var(--m-danger)' }}>{error}</p> : null}
          </div>
        </SheetBody>
        <SheetFooter>
          <Button variant='outline' disabled={busy} onClick={onClose}>{t('取消')}</Button>
          <Button variant='destructive' disabled={busy || phrase.trim() !== expected} onClick={() => void run()}>
            {busy ? t('清空中…') : t('清空整库并重置管理员')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
