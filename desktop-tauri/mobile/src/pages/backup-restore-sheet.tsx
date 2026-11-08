import { useRef, useState } from 'react'
import { Alert, AlertDescription, Button, Input, Label, Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTitle, Switch } from '@ui'
import { serverIdentity } from '../lib/servers'
import { store } from '../state/store'
import { downloadBackup, uploadBackup } from '../api/backup'
import { t } from '../i18n'

/**
 * 整库备份 / 恢复。
 *
 * 备份：输入密码 → POST /api/backup/download 取 .a2ab → 触发浏览器下载。
 * 恢复：选择 .a2ab 文件 → 输入密码 → multipart 上传 → 网关整体替换后需要重新登录。
 */
export function BackupRestoreSheet({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [includeLogs, setIncludeLogs] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const identity = serverIdentity()

  const doBackup = async () => {
    if (busy) return
    if (!password) { setError(t('请设置备份密码')); return }
    if (password.length < 12) { setError(t('备份密码至少需要 12 位')); return }
    setBusy('backup')
    setError('')
    try {
      const stamp = new Date().toISOString().slice(0, 10)
      const name = `agent2api-backup-${stamp}.a2ab`
      // 原生壳由 App 自己取包并落盘（弹分享面板）；浏览器里走 <a download>
      await downloadBackup({ password, includeLogs }, name)
      if (serverIdentity() !== identity) return
      store.toast(t('备份已生成，请保存到「文件」'))
    } catch (failure) {
      if (serverIdentity() === identity) setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      if (serverIdentity() === identity) setBusy('')
    }
  }

  const doRestore = async (file: File) => {
    if (busy) return
    if (password !== confirm) { setError(t('两次输入的备份密码不一致')); return }
    setBusy('restore')
    setError('')
    try {
      await uploadBackup(file, password)
      if (serverIdentity() !== identity) return
      store.toast(t('已恢复整库备份，请重新登录管理面板'))
      onChanged()
      onClose()
    } catch (failure) {
      if (serverIdentity() === identity) setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      if (serverIdentity() === identity) setBusy('')
    }
  }

  return (
    <Sheet open onOpenChange={(open, details) => {
      if (open) return
      if (busy) { details.cancel(); return }
      onClose()
    }}>
      <SheetContent showCloseButton={!busy}>
        <SheetHeader><SheetTitle>{t('整库备份 / 恢复')}</SheetTitle></SheetHeader>
        <SheetBody>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 8 }}>
            <Alert variant='warning'>
              <AlertDescription>
                {t('备份包含账号凭证、网关 Key、GitHub 令牌与云同步凭据的恢复密钥，整个文件受备份密码保护。请分开保管文件与密码；忘记密码无法恢复。')}
              </AlertDescription>
            </Alert>

            <div>
              <Label htmlFor='backup-password'>{t('备份密码')}</Label>
              <Input id='backup-password' type='password' autoComplete='new-password' placeholder={t('至少 12 位')} value={password} onChange={event => setPassword(event.currentTarget.value)} />
            </div>
            <div>
              <Label htmlFor='backup-confirm'>{t('确认备份密码')}</Label>
              <Input id='backup-confirm' type='password' autoComplete='new-password' value={confirm} onChange={event => setConfirm(event.currentTarget.value)} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Switch id='backup-logs' checked={includeLogs} onCheckedChange={value => setIncludeLogs(value === true)} />
              <Label htmlFor='backup-logs'>{t('包含日志与调试报文')}</Label>
            </div>

            <Button variant='outline' disabled={Boolean(busy)} onClick={() => void doBackup()}>
              {busy === 'backup' ? t('备份中…') : t('备份整库')}
            </Button>

            <div style={{ borderTop: '1px solid var(--m-line)', paddingTop: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{t('恢复整库')}</div>
              <p style={{ fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.6, marginBottom: 8 }}>
                {t('选择 .a2ab 加密备份（或旧 .sql 备份）。恢复会整体替换账号、配置、日志与设置；恢复前网关会自动保留安全备份，完成后需要重新登录。')}
              </p>
              <input
                ref={fileRef}
                type='file'
                accept='.a2ab,.sql'
                style={{ display: 'none' }}
                onChange={event => {
                  const file = event.currentTarget.files?.[0]
                  event.currentTarget.value = ''
                  if (file) void doRestore(file)
                }}
              />
              <Button variant='destructive' disabled={Boolean(busy)} onClick={() => fileRef.current?.click()}>
                {busy === 'restore' ? t('恢复中…') : t('选择备份文件恢复')}
              </Button>
            </div>

            {error ? <p style={{ fontSize: 12, color: 'var(--m-danger)' }}>{error}</p> : null}
          </div>
        </SheetBody>
        <SheetFooter>
          <Button variant='outline' disabled={Boolean(busy)} onClick={onClose}>{t('关闭')}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
