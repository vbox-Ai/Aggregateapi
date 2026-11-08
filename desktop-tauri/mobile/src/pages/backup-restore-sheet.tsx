import { useEffect, useRef, useState } from 'react'
import { Alert, AlertDescription, Button, Input, Label, Progress as UiProgress, Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTitle, Switch } from '@ui'
import { serverIdentity } from '../lib/servers'
import { store } from '../state/store'
import {
  downloadBackup,
  fetchRestoreProgress,
  uploadBackup,
  validateExportPassword,
  validateRestorePassword,
  type RestoreProgress,
} from '../api/backup'
import { clearPanelAuth } from '../api/client'
import { t } from '../i18n'

/**
 * 整库备份 / 恢复。
 *
 * ── 与网关契约对齐的三件事 ────────────────────────────────────
 *  1. **恢复进度**：恢复要读文件、解密、在暂存库跑 SQL、拍安全备份、覆盖主库、
 *     重载内存态，30 秒到几分钟；接口在结束时才返回。网关把阶段文案与百分比
 *     放在 `GET /api/backup/restore/progress` 里，这里 500ms 轮询显示 ——
 *     不轮询就只有一个转圈按钮，用户既看不到进展也不知道要等多久。
 *  2. **恢复后必须重新登录**：恢复会整体替换数据库（内含面板管理员的会话表），
 *     当前令牌随之失效。这里主动清掉本地会话并弹回登录页，而不是等下一个
 *     请求撞 401。
 *  3. **密码规则与 `archive::validate_password` 一致**：备份要 ≥12 字；
 *     恢复只看非空（旧 .sql 备份本来就没有密码）；两者都封顶 1024 字节。
 */
export function BackupRestoreSheet({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [includeLogs, setIncludeLogs] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [progress, setProgress] = useState<RestoreProgress | null>(null)
  const [restoreName, setRestoreName] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const identity = serverIdentity()

  // 恢复进行中：500ms 轮询进度（与网关的 /api/update/progress 同一套节奏）
  useEffect(() => {
    if (busy !== 'restore') return
    let cancelled = false
    const tick = async () => {
      try {
        const next = await fetchRestoreProgress()
        if (!cancelled) setProgress(next)
      } catch {
        /* 进度读不到不影响恢复本身；界面保持上一次读数 */
      }
    }
    void tick()
    const timer = window.setInterval(() => void tick(), 500)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [busy])

  const doBackup = async () => {
    if (busy) return
    const invalid = validateExportPassword(password)
    if (invalid) { setError(invalid); return }
    if (password !== confirm) { setError(t('两次输入的备份密码不一致')); return }
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
    const isSql = file.name.toLowerCase().endsWith('.sql')
    const invalid = validateRestorePassword(password, isSql)
    if (invalid) { setError(invalid); return }
    if (password && password !== confirm) { setError(t('两次输入的备份密码不一致')); return }
    setBusy('restore')
    setError('')
    setProgress(null)
    setRestoreName(file.name)
    try {
      await uploadBackup(file, password)
      if (serverIdentity() !== identity) return
      // 库被整体替换了：当前会话已失效，主动回登录页而不是等下一个请求 401
      clearPanelAuth()
      store.setAuthLost('login')
      store.toast(t('已恢复整库备份，请用该备份里的管理员账号重新登录'))
      onChanged()
      onClose()
    } catch (failure) {
      if (serverIdentity() === identity) setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      if (serverIdentity() === identity) setBusy('')
    }
  }

  const percent = Math.max(0, Math.min(100, Number(progress?.percent) || 0))

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
              <Input id='backup-password' type='password' autoComplete='new-password'
                placeholder={t('备份至少 12 位；恢复旧 SQL 备份可留空')}
                value={password} onChange={event => setPassword(event.currentTarget.value)} />
            </div>
            <div>
              <Label htmlFor='backup-confirm'>{t('确认备份密码')}</Label>
              <Input id='backup-confirm' type='password' autoComplete='new-password'
                placeholder={t('恢复时可以只填一次')}
                value={confirm} onChange={event => setConfirm(event.currentTarget.value)} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Switch id='backup-logs' checked={includeLogs} onCheckedChange={value => setIncludeLogs(value === true)} />
              <Label htmlFor='backup-logs'>{t('包含日志与调试报文')}</Label>
            </div>
            <p style={{ fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.6 }}>
              {t('取消勾选后只备份业务数据（账号、配置与余额记录），文件明显变小。插件程序与库外文件不在整库备份范围内。')}
            </p>

            <Button variant='outline' disabled={Boolean(busy)} onClick={() => void doBackup()}>
              {busy === 'backup' ? t('备份中…') : t('备份整库')}
            </Button>

            <div style={{ borderTop: '1px solid var(--m-line)', paddingTop: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{t('恢复整库')}</div>
              <p style={{ fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.6, marginBottom: 8 }}>
                {t('选择 .a2ab 加密备份（或旧 .sql 备份）。恢复会整体替换账号、配置、日志与设置；网关在覆盖主库前会自动留一份安全备份，完成后需要用备份里的管理员账号重新登录。')}
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

            {/* 恢复进度：阶段文案来自后端（步骤顺序的唯一权威），这里只显示 */}
            {busy === 'restore' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {restoreName ? (
                  <p className='m-mono' style={{ fontSize: 11, color: 'var(--m-text-3)', wordBreak: 'break-all' }}>
                    {restoreName}
                  </p>
                ) : null}
                <UiProgress value={percent} />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--m-text-2)' }}>
                  <span>{progress?.phase || t('正在提交备份文件…')}</span>
                  <span className='m-mono' style={{ color: 'var(--m-text-3)' }}>{percent}%</span>
                </div>
                <p style={{ fontSize: 11, color: 'var(--m-text-3)', lineHeight: 1.6 }}>
                  {t('整个过程通常 30 秒到几分钟，期间请不要退出 App。')}
                </p>
              </div>
            ) : null}

            {progress?.failed && progress.error ? (
              <p style={{ fontSize: 12, color: 'var(--m-danger)', whiteSpace: 'pre-wrap' }}>
                {t('恢复失败：{reason}', { reason: progress.error })}
              </p>
            ) : null}

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
