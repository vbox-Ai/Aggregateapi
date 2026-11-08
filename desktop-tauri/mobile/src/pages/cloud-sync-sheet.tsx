import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  Input,
  Label,
  SegmentedControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
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
import {
  CLOUD_SYNC_DEFAULTS,
  matchS3Preset,
  matchWebdavPreset,
  S3_PRESETS,
  WEBDAV_PRESETS,
} from '../lib/cloud-sync-presets'

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
    // 与桌面端 emptyForm() 一致：这两个不是空串，空串会被当成「根目录 / 无档案名」
    remoteRoot: CLOUD_SYNC_DEFAULTS.remoteRoot,
    profile: CLOUD_SYNC_DEFAULTS.profile,
  })
  /** 有未保存改动时拦住上传/下载：那两个动作走的是**已保存**的配置，不是屏幕上这份 */
  const [dirty, setDirty] = useState(false)
  // 单独存「导入密钥」用的密码，避免与同步密码混在一起
  const [keyPassword, setKeyPassword] = useState('')

  const patch = (changes: Partial<CloudSyncForm>) => {
    setForm(current => ({ ...current, ...changes }))
    setDirty(true)
  }

  const applySettings = useCallback((next: CloudSyncSettings) => {
    setSettings(next)
    setDirty(false)
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
      remoteRoot: next.remoteRoot || CLOUD_SYNC_DEFAULTS.remoteRoot,
      profile: next.profile || CLOUD_SYNC_DEFAULTS.profile,
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
    if (dirty) {
      setError(t('请先保存设置再同步：上传用的是已保存的配置，不是屏幕上这份。'))
      return
    }
    const ok = await confirmDialog(
      t('会把本机的账号与网关配置同步到云端，覆盖远端那一份。确定吗？'),
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
    if (dirty) {
      setError(t('请先保存设置再同步：恢复用的是已保存的配置，不是屏幕上这份。'))
      return
    }
    const ok = await confirmDialog(
      t('会用云端那一份**整体替换**本机的账号与网关配置（网关会先把当前数据备份到 backups/）。本机现有的账号会被覆盖。事件日志、请求明细、调试报文与面板登录态保持不变。确定恢复吗？'),
      { title: t('从云端恢复'), confirmText: t('替换并恢复'), destructive: true },
    )
    if (!ok) return
    void run('download', async () => {
      try {
        const result = await downloadCloudSync()
        void load()
        // 安全备份的位置要说出来：用户想知道「万一覆盖错了还能不能回去」
        const note = result.safetyBackup
          ? t('，替换前的数据已备份为 {name}', { name: result.safetyBackup })
          : ''
        return result.deviceName
          ? t('已恢复来自「{device}」的快照{note}', { device: result.deviceName, note })
          : t('已从云端恢复{note}', { note })
      } catch (cause) {
        // 409 = 远端带了另一把账号密钥而本机没有。这里刻意把「怎么办」写全 ——
        // 笼统提示「需要密钥」会让用户在本机反复试同步密码，而密钥根本不在这边。
        const status = (cause as { status?: number })?.status
        if (status === 409) {
          throw new Error(
            t('远端快照用了另一把账号密钥，且没有携带密钥文件，本机无法解密。请回到原来那台机器重新上传一次（在那边开启密钥随快照上传），或在本机用「导入密钥」填入那份同步密码。'),
          )
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
  const webdavPreset = matchWebdavPreset(form.webdavBaseUrl)
  const s3Preset = matchS3Preset(form.s3Region)

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
              <Alert variant='default'>
                <AlertDescription>
                  {t('同步的是账号、网关配置、自定义提供商、Agent 配置、代理池 / 订阅、签到与余额记录；事件日志、请求明细、调试报文与面板登录态不在范围内（它们是本机的运行痕迹）。上传的账号凭证仍是加密形态，解密用的密钥由「同步密码」单独加密后一并上传——同步密码不会存到云端，换机下载时要重新输入。')}
                </AlertDescription>
              </Alert>
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
                    onCheckedChange={value => patch({ enabled: value === true })}
                  />
                </div>
                <div className='m-row'>
                  <div className='m-grow'>
                    <div className='m-t1'>{t('自动同步')}</div>
                    <div className="m-t2">
                      {t('本地账号、配置、签到与余额记录变化后自动上传（合并 1 秒内的连续改动，最长 10 秒传一次；内容没变时不发请求）。')}
                    </div>
                  </div>
                  <Switch
                    checked={form.autoSync}
                    aria-label={t('自动同步')}
                    onCheckedChange={value => patch({ autoSync: value === true })}
                  />
                </div>
                {!form.enabled ? (
                  <p style={{ fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.7, padding: '0 14px 12px' }}>
                    {t('关闭总开关后，手动上传 / 下载也会被拒绝。')}
                  </p>
                ) : null}
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
                  onValueChange={value => patch({ provider: value as CloudProvider })}
                />

                {form.provider === 'webdav' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
                    <div>
                      <Label htmlFor='cs-webdav-preset'>{t('预设')}</Label>
                      <Select
                        value={webdavPreset.id}
                        onValueChange={value => {
                          const preset = WEBDAV_PRESETS.find(item => item.id === value)
                          // 预设只做一件事：把地址填成模板，之后用户自己改
                          if (preset?.baseUrl) patch({ webdavBaseUrl: preset.baseUrl })
                        }}
                      >
                        <SelectTrigger id='cs-webdav-preset' aria-label={t('预设')}>
                          <SelectValue>{webdavPreset.label}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {WEBDAV_PRESETS.map(item => (
                            <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Field id='cs-webdav-url' label={t('服务器地址')} value={form.webdavBaseUrl}
                      placeholder='https://dav.example.com/dav/'
                      onChange={value => patch({ webdavBaseUrl: value })} />
                    <Field id='cs-webdav-user' label={t('用户名')} value={form.webdavUsername}
                      onChange={value => patch({ webdavUsername: value })} />
                    <Field id='cs-webdav-pass' label={t('密码')} value={form.webdavPassword} type='password'
                      placeholder={settings?.webdav?.hasPassword ? t('留空 = 沿用已保存的密码') : t('第三方应用密码')}
                      onChange={value => patch({ webdavPassword: value })} />
                    <Field id='cs-webdav-ua' label={t('自定义 User-Agent（可选）')} value={form.webdavUserAgent}
                      onChange={value => patch({ webdavUserAgent: value })} />
                    {webdavPreset.hint ? <PresetHint text={webdavPreset.hint} /> : null}
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
                    <div>
                      <Label htmlFor='cs-s3-preset'>{t('预设')}</Label>
                      <Select
                        value={s3Preset.id}
                        onValueChange={value => {
                          const preset = S3_PRESETS.find(item => item.id === value)
                          if (preset) patch({ s3Region: preset.regionPlaceholder })
                        }}
                      >
                        <SelectTrigger id='cs-s3-preset' aria-label={t('预设')}>
                          <SelectValue>{s3Preset.label}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {S3_PRESETS.map(item => (
                            <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Field id='cs-s3-region' label={t('区域（Region）')} value={form.s3Region}
                      placeholder={s3Preset.regionPlaceholder}
                      onChange={value => patch({ s3Region: value })} />
                    <Field id='cs-s3-bucket' label={t('存储桶（Bucket）')} value={form.s3Bucket}
                      onChange={value => patch({ s3Bucket: value })} />
                    <Field id='cs-s3-key' label={t('Access Key ID')} value={form.s3AccessKeyId}
                      onChange={value => patch({ s3AccessKeyId: value })} />
                    <Field id='cs-s3-secret' label={t('Secret Access Key')} value={form.s3SecretAccessKey} type='password'
                      placeholder={settings?.s3?.hasSecretKey ? t('留空 = 沿用已保存的密钥') : t('还没设置')}
                      onChange={value => patch({ s3SecretAccessKey: value })} />
                    <Field id='cs-s3-endpoint' label={t('Endpoint（可选）')} value={form.s3Endpoint}
                      placeholder={t('自建 / 兼容服务才需要')}
                      onChange={value => patch({ s3Endpoint: value })} />
                    <Field id='cs-s3-ua' label={t('自定义 User-Agent（可选）')} value={form.s3UserAgent}
                      onChange={value => patch({ s3UserAgent: value })} />
                    {s3Preset.hint ? <PresetHint text={s3Preset.hint} /> : null}
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
                    onChange={value => patch({ remoteRoot: value })} />
                  <Field id='cs-profile' label={t('档案')} value={form.profile}
                    placeholder={t('多套配置用不同档案名区分')}
                    onChange={value => patch({ profile: value })} />
                  <Field id='cs-syncpass' label={t('同步密码')} value={form.syncPassword} type='password'
                    placeholder={settings?.hasSyncPassword ? t('留空 = 沿用已保存的密码') : t('至少 8 位，换机下载时需要')}
                    onChange={value => patch({ syncPassword: value })} />
                </div>
                <p style={{ fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.7, marginTop: 6 }}>
                  {t('密码框留空保存 = 沿用库里那一份，不会清掉。远端存的是密文，解密密钥留在本机；换机下载时要重新输入这份同步密码。')}
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
                    {settings.remotePath ? (
                      <div className='m-card-pad' style={{ borderTop: '1px solid var(--m-line)' }}>
                        <div className='m-t2' style={{ marginBottom: 2 }}>{t('远端路径')}</div>
                        <div className='m-mono' style={{ fontSize: 11.5, wordBreak: 'break-all' }}>
                          {settings.remotePath}
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
                      {manifest.createdAt ? (
                        <div className='m-row'>
                          <span className='m-k'>{t('生成时间')}</span>
                          <span className='m-v'>{manifest.createdAt}</span>
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
                  {t('上传内容含加密后的账号凭证与网关配置，会覆盖远端同一路径下的旧快照；事件日志、请求明细与调试报文不会上传。远端该路径下还没有快照时，本次就是首次上传。')}
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

/** 预设自带的说明（坚果云要第三方应用密码、群晖要先开 WebDAV 服务这类） */
function PresetHint({ text }: { text: string }) {
  return (
    <p style={{ fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.7, margin: 0 }}>
      {text}
    </p>
  )
}
