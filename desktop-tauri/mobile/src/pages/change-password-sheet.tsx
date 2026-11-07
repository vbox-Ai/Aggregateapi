import { useState } from 'react'
import { Button, Input, Label, Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@ui'
import { serverIdentity } from '../lib/servers'
import { store } from '../state/store'
import { apiCall } from '../api/client'
import { t } from '../i18n'

/** 修改面板管理员密码（需要当前会话 + 旧密码；成功后其他会话失效）。 */
export function ChangePasswordSheet({ onClose }: { onClose: () => void }) {
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const identity = serverIdentity()

  const save = async () => {
    if (busy) return
    if (!oldPassword) {
      setError(t('请输入当前密码'))
      return
    }
    if (newPassword.length < 8) {
      setError(t('新密码至少 8 位'))
      return
    }
    if (newPassword === oldPassword) {
      setError(t('新密码不能与当前密码相同'))
      return
    }
    if (newPassword !== confirm) {
      setError(t('两次输入的新密码不一致'))
      return
    }
    setBusy(true)
    setError('')
    try {
      await apiCall('/api/panel/change-password', {
        method: 'POST',
        body: { oldPassword, newPassword },
      })
      if (serverIdentity() !== identity) return
      store.toast(t('密码已修改，其他设备的登录已失效'))
      onClose()
    } catch (failure) {
      if (serverIdentity() === identity) setError(failure instanceof Error ? failure.message : String(failure))
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
        <SheetHeader><SheetTitle>{t('修改密码')}</SheetTitle></SheetHeader>
        <SheetBody>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 8 }}>
            <div>
              <Label htmlFor='old-password'>{t('当前密码')}</Label>
              <Input id='old-password' type='password' autoComplete='current-password' value={oldPassword} onChange={event => setOldPassword(event.currentTarget.value)} />
            </div>
            <div>
              <Label htmlFor='new-password'>{t('新密码')}</Label>
              <Input id='new-password' type='password' autoComplete='new-password' value={newPassword} onChange={event => setNewPassword(event.currentTarget.value)} />
            </div>
            <div>
              <Label htmlFor='confirm-password'>{t('确认新密码')}</Label>
              <Input id='confirm-password' type='password' autoComplete='new-password' value={confirm} onChange={event => setConfirm(event.currentTarget.value)} />
            </div>
            <p style={{ fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.6 }}>
              {t('修改后其他设备已登录的会话会立即失效，当前设备保持登录。')}
            </p>
            {error ? <p style={{ fontSize: 12, color: 'var(--m-danger)' }}>{error}</p> : null}
          </div>
        </SheetBody>
        <SheetFooter>
          <Button variant='outline' disabled={busy} onClick={onClose}>{t('取消')}</Button>
          <Button disabled={busy} onClick={() => void save()}>{busy ? t('保存中…') : t('保存')}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
