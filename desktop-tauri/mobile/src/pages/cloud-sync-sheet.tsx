import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  Input,
  Label,
  SegmentedControl,
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  Switch,
  confirmDialog,
} from '@ui'
import { Badge, Empty, ErrorNote } from '../components/ui'
import { serverIdentity } from '../lib/servers'
import { store } from '../state/store'
import { formatStamp } from '../lib/format'
import { t } from '../i18n'
import {
  downloadCloudSync,
  fetchCloudSync,
  fetchRemoteManifest,
  importCloudSyncKey,
  putCloudSync,
  remoteReadiness,
  testCloudSync,
  uploadCloudSync,
  type CloudProvider,
  type CloudSyncForm,
  type CloudSyncSettings,
  type RemoteManifest,
} from '../api/cloud-sync'

/**
 * 云同步。
 *
 * 把账号密文与网关 Key 同步到 WebDAV / S3：远端只拿到密文，解密密钥留在本机
 * （所以换机时要「导入密钥」那一步）。与「整库备份」的分工：备份是**全库**快照、
 * 手动换文件；云同步只同步账号与 Key，可自动、可跨设备。
 *
 * 三种操作的风险等级差很多，界面按等级区别对待：
 *  · **测试连接 / 读取远端**：只读 + 出网，随便点；
 *  · **上传到云端**：覆盖远端那一份 → 二次确认；
 *  · **从云端恢复**：**整体替换本机账号与 Key**（替换前网关会自动备份到 `backups/`）
 *    → 强确认；若远端带密钥封装而本机没有，先「导入密钥」。
 */
export function CloudSyncSheet({ onClose }: { onClose: () => void }) {
  const identity = serverIdentity()
  const [settings, setSettings] = useState<CloudSyncSettings | null>(null)
  const [manifest, setManifest] = useState<RemoteManifest | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [loading, setLoading] = useState(true)

  // 表单（密码类字段留空 = 沿用库里那份）
  const [form, setForm] = useState<CloudSyncForm>({
    provider: 'webdav',
    webdavBaseUrl: '',
    webdavUsername: '',
    webdavPassword: '',
    webdavUserAgent: '',
    s3Region: '',
    s3Bucket: '',
    s3AccessKeyId: '',
    s3SecretAccessKey: '',
    s3Endpoint: '',
    s3UserAgent: '',
    syncPassword: '',
    enabled: false,
    autoSync: false,
    remoteRoot: '',
    profile: '',
  })
  // 单独存「导入密钥」用的密码，避免与同步密码混在一起
  const [keyPassword, setKeyPassword] = useState('')

  const applySettings = useCallback((next: CloudSyncSettings) => {
    setSettings(next)
    setForm(current => ({
      ...current,
      provider: next.provider === 's3' ? 's3' : 'webdav',
      webdavBaseUrl: next.webdav?.baseUrl || '',
      webdavUsername: next.webdav?.username || '',
      webdavPassword: '',
      webdavUserAgent: next.webdav?.userAgent || '',
      s3Region: next.s3?.region || '',
      s3Bucket: next.s3?.bucket || '',
      s3AccessKeyId: next.s3?.accessKeyId || '',
      s3SecretAccessKey: '',
      s3Endpoint: next.s3?.endpoint || '',
      s3UserAgent: next.s3?.userAgent || '',
      syncPassword: '',
      enabled: next.enabled === true,
      autoSync: next.autoSync === true,
      remoteRoot: next.remoteRoot || '',
      profile: next.profile || '',
    }))
  }, [])

  const load = useCallback(async () => {
    try {
      const next = await fetchCloudSync()
      if (serverIdentity() !== identity) return
      applySettings(next)
      setError('')
    } catch (cause) {
      if (serverIdentity() === identity) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (serverIdentity() === identity) setLoading(false)
    }
  }, [applySettings, identity])

  useEffect(() => {
    void load()
  }, [load])

  const run = async (section: string, action: () => Promise<string>) => {
    if (busy) return
    setBusy(section)
    setError('')
    try {
      const done = await action()
      if (serverIdentity() !== identity) return
      store.toast(done)
    } catch (cause) {
      if (serverIdentity() === identity) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (serverIdentity() === identity) setBusy('')
    }
  }

  const save = () => run('save', async () => {
    // 首次配置必须有同步密码；已有的话留空表示沿用
    if (!form.syncPassword && !settings?.hasSyncPassword) {
      throw new Error(t('请设置同步密码：它用来保护远端数据，换机时要用同一个密码。'))
    }
    if (form.provider === 'webdav' && (!form.webdavBaseUrl.trim() || !form.webdavUsername.trim())) {
      throw new Error(t('WebDAV 需要填写服务器地址与用户名'))
    }
    if (form.provider === 's3' && (!form.s3Bucket.trim() || !form.s3Region.trim() || !form.s3AccessKeyId.trim())) {
      throw new Error(t('S3 需要填写区域、存储桶与 Access Key ID'))
    }
    const next = await putCloudSync(form)
    applySettings(next)
    return t('已保存云同步设置')
  })

  const test = () => run('test', async () => {
    const result = await testCloudSync(form)
    return result.remotePath ? t('连接成功，远端目录：{path}', { path: result.remotePath }) : t('连接成功')
  })

  const readRemote = () => run('remote', async () => {
    const next = await fetchRemoteManifest()
    setManifest(next)
    if (next.empty) return t('远端还是空的，先上传一次')
    return t('已读取远端清单')
  })

  const upload = async () => {
    const ok = await confirmDialog(
      t('会把本机的账号与网关 Key 上传到云端，覆盖远端那一份。确定吗？'),
      { title: t('上传到云端'), confirmText: t('上传'), destructive: true },
    )
    if (!ok) return
    void run('upload', async () => {
      const result = await uploadCloudSync()
      const count = result.rows ? Object.values(result.rows).reduce((sum, value) => sum + Number(value || 0), 0) : 0
      void load()
      return count ? t('已上传 {count} 条记录', { count }) : t('已上传到云端')
    })
  }

  const download = async () => {
    const ok = await confirmDialog(
      t('会用云端那一份**整体替换**本机的账号与网关 Key（网关会先把当前数据备份到 backups/）。本机现有的账号会被覆盖。确定恢复吗？'),
      { title: t('从云端恢复'), confirmText: t('替换并恢复'), destructive: true },
    )
    if (!ok) return
    void run('download', async () => {
      try {
        const result = await downloadCloudSync()
        void load()
        return result.deviceName
          ? t('已恢复来自「{device}」的快照', { device: result.deviceName })
          : t('已从云端恢复')
      } catch (cause) {
        // 409 = 远端带密钥封装而本机没有 → 引导去导入密钥
        const status = (cause as { status?: number })?.status
        if (status === 409) {
          throw new Error(t('云端那份带了独立密钥，请先在下面「导入密钥」里填入同步密码。'))
        }
        throw cause
      }
    })
  }

  const importKey = () => run('key', async () => {
    if (!keyPassword.trim()) throw new Error(t('请输入同步密码'))
    const result = await importCloudSyncKey(keyPassword.trim())
    setKeyPassword('')
    void load()
    return result.keyFingerprint ? t('已导入密钥：{fp}', { fp: result.keyFingerprint }) : t('已导入密钥')
  })

  const readiness = remoteReadiness(manifest)
  const status = settings?.status || {}

  return (
    <Sheet open onOpenChange={open => { if (!open) onClose() }}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{t('云同步')}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          {error ? <ErrorNote text={error} /> : null}
          {loading ? <Card className='m-card'><Empty text={t('正在读取云同步设置…')} /></Card> : null}

          {!loading ? (
            <>
              {/* 总开关 */}
              <Card className='m-card'>
                <div className='m-row'>
                  <div className='m-grow'>
                    <div className='m-t1'>{t('启用云同步')}</div>
                    <div className='m-t2'>{t('上传与恢复都需要它是打开的')}</div>
                  </div>
                  <Switch
                    checked={form.enabled}
                    aria-label={t('启用云同步')}
                    onCheckedChange={value => setForm({ ...form, enabled: value === true })}
                  />
                </div>
                <div className='m-row'>
                  <div className='m-grow'>
                    <div className='m-t1'>{t('自动同步')}</div>
                    <div className="m-t2">{t('网关按自己的节奏把变更推到云端')}</div>
                  </div>
                  <Switch
                    checked={form.autoSync}
                    aria-label={t('自动同步')}
                    onCheckedChange={value => setForm({ ...form, autoSync: value === true })}
                  />
                </div>
              </Card>

              {/* 服务商 */}
              <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--m-text-3)', padding: '14px 2px 6px' }}>
                {t('服务商')}
              </div>
              <Card className='m-card m-card-pad'>
                <SegmentedControl
                  options={[
                    { value: 'webdav', label: 'WebDAV' },
                    { value: 's3', label: 'S3' },
                  ]}
                  value={form.provider}
                  aria-label={t('服务商')}
                  onValueChange={value => setForm({ ...form, provider: value as CloudProvider })}
                />

                {form.provider === 'webdav' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
                    <Field id='cs-webdav-url' label={t('服务器地址')} value={form.webdavBaseUrl}
                      placeholder='https://dav.example.com/remote.php/dav/files/me'
                      onChange={value => setForm({ ...form, webdavBaseUrl: value })} />
                    <Field id='cs-webdav-user' label={t('用户名')} value={form.webdavUsername}
                      onChange={value => setForm({ ...form, webdavUsername: value })} />
                    <Field id='cs-webdav-pass' label={t('密码')} value={form.webdavPassword} type='password'
                      placeholder={settings?.webdav?.hasPassword ? t('留空 = 沿用已保存的密码') : t('还没设置')}
                      onChange={value => setForm({ ...form, webdavPassword: value })} />
                    <Field id='cs-webdav-ua' label={t('自定义 User-Agent（可选）')} value={form.webdavUserAgent}
                      onChange={value => setForm({ ...form, webdavUserAgent: value })} />
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
                    <Field id='cs-s3-region' label={t('区域（Region）')} value={form.s3Region}
                      onChange={value => setForm({ ...form, s3Region: value })} />
                    <Field id='cs-s3-bucket' label={t('存储桶（Bucket）')} value={form.s3Bucket}
                      onChange={value => setForm({ ...form, s3Bucket: value })} />
                    <Field id='cs-s3-key' label={t('Access Key ID')} value={form.s3AccessKeyId}
                      onChange={value => setForm({ ...form, s3AccessKeyId: value })} />
                    <Field id='cs-s3-secret' label={t('Secret Access Key')} value={form.s3SecretAccessKey} type='password'
                      placeholder={settings?.s3?.hasSecretKey ? t('留空 = 沿用已保存的密钥') : t('还没设置')}
                      onChange={value => setForm({ ...form, s3SecretAccessKey: value })} />
                    <Field id='cs-s3-endpoint' label={t('Endpoint（可选）')} value={form.s3Endpoint}
                      placeholder={t('自建 / 兼容服务才需要')}
                      onChange={value => setForm({ ...form, s3Endpoint: value })} />
                    <Field id='cs-s3-ua' label={t('自定义 User-Agent（可选）')} value={form.s3UserAgent}
                      onChange={value => setForm({ ...form, s3UserAgent: value })} />
                  </div>
                )}
              </Card>

              {/* 远端位置与密钥 */}
              <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--m-text-3)', padding: '14px 2px 6px' }}>
                {t('远端与密钥')}
              </div>
              <Card className='m-card m-card-pad'>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <Field id='cs-root' label={t('远程根目录')} value={form.remoteRoot}
                    placeholder={t('留空 = 根目录')}
                    onChange={value => setForm({ ...form, remoteRoot: value })} />
                  <Field id='cs-profile' label={t('档案')} value={form.profile}
                    placeholder={t('多套配置用不同档案名区分')}
                    onChange={value => setForm({ ...form, profile: value })} />
                  <Field id='cs-syncpass' label={t('同步密码')} value={form.syncPassword} type='password'
                    placeholder={settings?.hasSyncPassword ? t('留空 = 沿用已保存的密码') : t('首次配置必须设置')}
                    onChange={value => setForm({ ...form, syncPassword: value })} />
                </div>
                <p style={{ fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.7, marginTop: 6 }}>
                  {t('密码框留空保存 = 沿用库里那一份，不会清掉。远端存的是密文，解密密钥留在本机。')}
                </p>
              </Card>

              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <Button variant='outline' disabled={Boolean(busy)} onClick={() => void save()}>
                  {busy === 'save' ? t('保存中…') : t('保存设置')}
                </Button>
                <Button variant='outline' disabled={Boolean(busy)} onClick={() => void test()}>
                  {busy === 'test' ? t('测试中…') : t('测试连接')}
                </Button>
                <Button variant='outline' disabled={Boolean(busy)} onClick={() => void readRemote()}>
                  {busy === 'remote' ? t('读取中…') : t('读取远端')}
                </Button>
              </div>

              {/* 状态 */}
              {settings ? (
                <>
                  <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--m-text-3)', padding: '14px 2px 6px' }}>
                    {t('状态')}
                  </div>
                  <Card className='m-card'>
                    <div className='m-rows' style={{ borderRadius: 0, border: 0 }}>
                      <div className='m-row'>
                        <span className='m-k'>{t('上次同步')}</span>
                        <span className='m-v m-mono'>
                          {status.lastSyncAt ? formatStamp(status.lastSyncAt) : t('还没同步过')}
                        </span>
                      </div>
                      {status.lastAction ? (
                        <div className='m-row'>
                          <span className='m-k'>{t('上次动作')}</span>
                          <span className='m-v'>{status.lastAction === 'upload' ? t('上传') : t('恢复')}</span>
                        </div>
                      ) : null}
                      {settings.keyFingerprint ? (
                        <div className='m-row'>
                          <span className='m-k'>{t('密钥指纹')}</span>
                          <span className='m-v m-mono'>{settings.keyFingerprint}</span>
                        </div>
                      ) : null}
                    </div>
                    {status.lastError ? (
                      <div className='m-card-pad' style={{ borderTop: '1px solid var(--m-line)' }}>
                        <Badge tone='bad'>{status.lastErrorSource === 'auto' ? t('自动同步失败') : t('上次失败')}</Badge>
                        <div style={{ fontSize: 12, color: 'var(--m-danger)', lineHeight: 1.6, marginTop: 6 }}>
                          {status.lastError}
                        </div>
                      </div>
                    ) : null}
                  </Card>
                </>
              ) : null}

              {/* 远端清单 */}
              {manifest ? (
                <>
                  <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--m-text-3)', padding: '14px 2px 6px' }}>
                    {t('远端清单')}
                  </div>
                  <Card className='m-card'>
                    <div className='m-rows' style={{ borderRadius: 0, border: 0 }}>
                      <div className='m-row'>
                        <span className='m-k'>{t('可恢复状态')}</span>
                        <span className='m-v'>
                          {readiness === 'empty'
                            ? t('远端为空')
                            : readiness === 'key'
                              ? t('需要先导入密钥')
                              : readiness === 'incompatible'
                                ? t('格式不兼容')
                                : t('可以直接恢复')}
                        </span>
                      </div>
                      {manifest.deviceName ? (
                        <div className='m-row'>
                          <span className='m-k'>{t('来源设备')}</span>
                          <span className='m-v'>{manifest.deviceName}</span>
                        </div>
                      ) : null}
                      {manifest.appVersion ? (
                        <div className='m-row'>
                          <span className='m-k'>{t('快照版本')}</span>
                          <span className='m-v m-mono'>{manifest.appVersion}</span>
                        </div>
                      ) : null}
                      {manifest.incompatibleReason ? (
                        <div className='m-row'>
                          <span className='m-k'>{t('不兼容原因')}</span>
                          <span className='m-v'>{manifest.incompatibleReason}</span>
                        </div>
                      ) : null}
                    </div>
                  </Card>
                </>
              ) : null}

              {/* 上下行 */}
              <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--m-text-3)', padding: '14px 2px 6px' }}>
                {t('上传与恢复')}
              </div>
              <Card className='m-card m-card-pad'>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <Button variant='outline' disabled={Boolean(busy)} onClick={() => void upload()}>
                    {busy === 'upload' ? t('上传中…') : t('上传到云端')}
                  </Button>
                  <Button variant='destructive' disabled={Boolean(busy)} onClick={() => void download()}>
                    {busy === 'download' ? t('恢复中…') : t('从云端恢复')}
                  </Button>
                </div>
                <p style={{ fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.7, marginTop: 6 }}>
                  {t('上传会覆盖远端那一份；恢复会用云端那一份整体替换本机账号与网关 Key（替换前网关会自动留下安全备份）。同步范围只有账号与网关 Key，不含日志与整库设置。')}
                </p>
              </Card>

              {/* 导入密钥 */}
              <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--m-text-3)', padding: '14px 2px 6px' }}>
                {t('导入密钥')}
              </div>
              <Card className='m-card m-card-pad'>
                <Label htmlFor='cs-key-password'>{t('同步密码')}</Label>
                <Input
                  id='cs-key-password'
                  type='password'
                  placeholder={t('换机后用它把远端密钥装到本机')}
                  value={keyPassword}
                  onChange={event => setKeyPassword(event.currentTarget.value)}
                />
                <div style={{ marginTop: 10 }}>
                  <Button variant='outline' disabled={Boolean(busy)} onClick={() => void importKey()}>
                    {busy === 'key' ? t('导入中…') : t('导入密钥')}
                  </Button>
                </div>
              </Card>

              <Alert variant='warning'>
                <AlertDescription>
                  {t('云同步与「整库备份」不是一回事：备份是全库快照、手动换文件；云同步只带账号与网关 Key，可自动、可跨设备。想搬完整环境请用备份。')}
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

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  type,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: string
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type || 'text'}
        className={type ? undefined : 'm-mono'}
        placeholder={placeholder}
        value={value}
        onChange={event => onChange(event.currentTarget.value)}
      />
    </div>
  )
}
