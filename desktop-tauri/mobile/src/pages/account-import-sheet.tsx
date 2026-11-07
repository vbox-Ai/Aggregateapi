import { useMemo, useState } from 'react'
import { Alert, AlertDescription, Button, Input, Label, Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTitle, Textarea } from '@ui'
import { providerLabel } from '../lib/providers'
import { serverIdentity } from '../lib/servers'
import { store } from '../state/store'
import { addAccountByFile } from '../api/gateway'
import { t } from '../i18n'

const PRESET_NOTES: Record<string, string> = {
  raccoon: t('粘贴小浣熊客户端登录态文件内容，或包含 token / refreshToken 的 JSON。'),
  'deepseek-web': t('粘贴网页访问令牌 JSON，例如 {"accessToken":"…","cookie":"…"}。'),
  doubaowork: t('粘贴豆包工作网页 Cookie，或包含 cookie 的 JSON。'),
  tabbit: t('粘贴 Tabbit 网页 Cookie / JWT，或包含 cookie / token 的 JSON。'),
  codearts: t('粘贴 CodeArts 凭据 JSON（access_key_id / secret_access_key / security_token，建议连 refresh_token）。'),
}

/** 粘贴凭证导入：不依赖 provider 的动态登录声明（501 也可用）。 */
export function AccountImportSheet({
  providers,
  onClose,
  onImported,
}: {
  providers: Array<{ id?: string; label?: string }>
  onClose: () => void
  onImported: () => void
}) {
  const [provider, setProvider] = useState('')
  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const identity = serverIdentity()

  const note = useMemo(() => PRESET_NOTES[provider] || t('粘贴该提供商客户端导出的登录态 / 凭证 JSON 或文本。'), [provider])

  const save = async () => {
    if (busy) return
    const trimmed = content.trim()
    if (!trimmed) {
      setError(t('请粘贴凭证内容'))
      return
    }
    if (!provider) {
      setError(t('请选择提供商'))
      return
    }
    setBusy(true)
    setError('')
    try {
      await addAccountByFile({ provider, authFileContent: trimmed, name: name.trim() || undefined })
      if (serverIdentity() !== identity) return
      store.toast(t('账号已导入'))
      onImported()
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
        <SheetHeader>
          <SheetTitle>{t('导入账号凭证')}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 8 }}>
            <Alert variant='default'>
              <AlertDescription>
                {t('粘贴该提供商客户端的登录态 / 凭证内容，网关直接保存，不需要动态登录方式；适合未声明移动登录的提供商。')}
              </AlertDescription>
            </Alert>
            <div>
              <Label htmlFor='import-provider'>{t('提供商')}</Label>
              <select
                id='import-provider'
                value={provider}
                onChange={event => setProvider(event.currentTarget.value)}
                style={{
                  width: '100%',
                  height: 36,
                  borderRadius: 9,
                  border: '1px solid var(--m-line)',
                  background: 'var(--m-surface)',
                  color: 'var(--m-text)',
                  fontSize: 13,
                  padding: '0 10px',
                }}
              >
                <option value=''>{t('选择提供商…')}</option>
                {providers.filter(item => item.id).map(item => (
                  <option key={item.id} value={item.id}>{providerLabel(item.id as string, item.label)}</option>
                ))}
              </select>
            </div>
            {note ? <p style={{ fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.6 }}>{note}</p> : null}
            <div>
              <Label htmlFor='import-name'>{t('备注名（可选）')}</Label>
              <Input id='import-name' type='text' maxLength={100} placeholder={t('可选，留空则用凭证里的账号名')} value={name} onChange={event => setName(event.currentTarget.value)} />
            </div>
            <div>
              <Label htmlFor='import-content'>{t('凭证内容')}</Label>
              <Textarea
                id='import-content'
                rows={8}
                placeholder={'{\n  "token": "…",\n  "refreshToken": "…"\n}'}
                value={content}
                onChange={event => setContent(event.currentTarget.value)}
              />
            </div>
            {error ? <p style={{ fontSize: 12, color: 'var(--m-danger)' }}>{error}</p> : null}
          </div>
        </SheetBody>
        <SheetFooter>
          <Button variant='outline' disabled={busy} onClick={onClose}>{t('取消')}</Button>
          <Button disabled={busy} onClick={() => void save()}>{busy ? t('导入中…') : t('导入账号')}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
