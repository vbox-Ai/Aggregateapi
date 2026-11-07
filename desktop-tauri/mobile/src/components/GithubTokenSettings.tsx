import { useEffect, useState } from 'react'
import { Alert, AlertDescription, Button, Input, Label } from '@ui'
import { store } from '../state/store'
import { serverIdentity } from '../lib/servers'
import { apiCall } from '../api/client'
import { t } from '../i18n'

export type GithubTokenStatus = {
  filled?: boolean
  origin?: string | null
  error?: string | null
}

/** 插件设置里的 GitHub 令牌：填 token 解除 GitHub API 限流。 */
export function GithubTokenSettings() {
  const [status, setStatus] = useState<GithubTokenStatus | null>(null)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const identity = serverIdentity()

  const load = () => {
    apiCall<GithubTokenStatus>('/api/update/token')
      .then(next => { if (serverIdentity() === identity) setStatus(next) })
      .catch(failure => {
        if (serverIdentity() === identity) setError(failure instanceof Error ? failure.message : String(failure))
      })
  }

  useEffect(() => { load() /* eslint-disable-line react-hooks/exhaustive-deps */ }, [identity])

  const save = async () => {
    if (busy) return
    const trimmed = token.trim()
    if (!trimmed) {
      setError(t('请填写 GitHub 令牌'))
      return
    }
    setBusy('save')
    setError('')
    try {
      await apiCall('/api/update/token', { method: 'POST', body: { token: trimmed } })
      if (serverIdentity() !== identity) return
      setToken('')
      store.toast(t('GitHub 访问设置已保存'))
      load()
    } catch (failure) {
      if (serverIdentity() === identity) setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      if (serverIdentity() === identity) setBusy('')
    }
  }

  const remove = async () => {
    if (busy) return
    setBusy('clear')
    setError('')
    try {
      await apiCall('/api/update/token', { method: 'POST', body: { token: null } })
      if (serverIdentity() !== identity) return
      store.toast(t('GitHub 令牌已清除'))
      load()
    } catch (failure) {
      if (serverIdentity() === identity) setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      if (serverIdentity() === identity) setBusy('')
    }
  }

  const filledText = status?.filled
    ? status?.origin === 'env' ? t('已通过环境变量配置') : t('已填写')
    : t('未填写（GitHub API 限流 60 次/小时，插件下载可能失败）')

  return (
    <div className='px-3 py-3' style={{ borderTop: '1px solid var(--m-line)' }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{t('GitHub 令牌')}</div>
      <p className='text-xs text-subtle' style={{ marginBottom: 6 }}>{filledText}</p>
      <Label htmlFor='github-token'>{t('Token（粘贴时自动隐藏）')}</Label>
      <Input
        id='github-token'
        type='password'
        autoComplete='off'
        placeholder='ghp_… / github_pat_…'
        value={token}
        onChange={event => setToken(event.currentTarget.value)}
        style={{ marginBottom: 8 }}
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <Button size='sm' variant='outline' disabled={Boolean(busy)} onClick={() => void save()}>{busy === 'save' ? t('保存中…') : t('保存')}</Button>
        <Button size='sm' variant='ghost' disabled={Boolean(busy) || !status?.filled} onClick={() => void remove()}>{busy === 'clear' ? t('清除中…') : t('清除')}</Button>
      </div>
      {error ? <Alert variant='destructive'><AlertDescription>{error}</AlertDescription></Alert> : null}
    </div>
  )
}
