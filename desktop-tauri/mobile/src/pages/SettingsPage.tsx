import { useEffect, useState } from 'react'
import { PageIntro, SectionHead, IconButton } from '../components/ui'
import { Icon } from '../components/Icon'
import { ThemeSwitch } from './MorePage'
import { store, useStore } from '../state/store'
import { locale, localeOptions, setLocale } from '../i18n'
import { storeApiKey } from '../api/client'
import { usePwa } from '../lib/usePwa'
import { applyUpdate, promptInstall } from '../lib/pwa'
import { APP_VERSION } from '../lib/appUpdate'
import { AppUpdatePanel } from '../components/AppUpdatePanel'
import { CommunitySheet } from '../components/CommunitySheet'
import { SystemInfoSheet } from '../components/SystemInfoSheet'
import { ChangePasswordSheet } from './change-password-sheet'
import { BackupRestoreSheet } from './backup-restore-sheet'
import { ResetLibrarySheet } from './reset-library-sheet'
import { ConnectionSecuritySheet } from './connection-security-sheet'
import { DataStorageSheet } from './data-storage-sheet'
import { ModelMetadataSheet } from './model-metadata-sheet'
import { PluginSettingsSheet } from './plugin-settings-sheet'
import { UpdateProxySheet } from './update-proxy-sheet'
import { CloudSyncSheet } from './cloud-sync-sheet'
import { openExternal } from '../lib/community'

/**
 * 桌面端「反馈与需求」分类的三个入口，指向仓库里预设好模板的 GitHub issue 表单。
 * 桌面端用壳命令 `open_release_page` 交给系统浏览器；手机端走 `openExternal`
 * （APK 内同窗跳转、PWA 新标签页，见 lib/community.ts 的说明）。
 */
const FEEDBACK_LINKS = [
  {
    title: t('问题反馈'),
    desc: t('遇到 Bug、报错或异常行为'),
    url: 'https://github.com/aimod-cc/Agent2API/issues/new?template=bug_report.yml',
  },
  {
    title: t('功能建议'),
    desc: t('想要的新功能或改进想法'),
    url: 'https://github.com/aimod-cc/Agent2API/issues/new?template=feature_request.yml',
  },
  {
    title: t('请求提供商 / 模型支持'),
    desc: t('希望接入新的提供商或模型'),
    url: 'https://github.com/aimod-cc/Agent2API/issues/new?template=provider_request.yml',
  },
] as const
import { supervisorSetLan, supervisorStart, supervisorStatus as fetchSupervisorStatus, supervisorStop, type SupervisorStatus } from '../api/supervisor'
import { panelStatus } from '../api/client'
import { apiBase, baseLabel, serverIdentity } from '../lib/servers'
import { usePullToRefresh, PullIndicator } from '../components/PullToRefresh'
import { t } from '../i18n'
import { Card, Button, Badge, BadgeDot, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Sheet, SheetContent, SheetHeader, SheetBody, SheetTitle, Switch } from '@ui'
import { ClientIdentificationPanel } from '../../../ui-shared/client-identification-panel'
import { clientIdentificationApi } from '../api/client-identification'

/**
 * 设置。
 *
 * ── 手机上只放「改了就生效、且不需要复杂表单」的项 ────────────
 * 桌面端设置页有 11 个分类、几十个字段。手机上保留：
 *   · 外观与语言（纯前端偏好）
 *   · 账号凭证（兼容模式的 API Key、退出登录）
 *   · 网关地址（复制给客户端）
 *   · 关于与安装（PWA 安装引导、版本）
 * 端口、路由、重试、超时、数据保留这些需要看文档才能填对的，一律留在桌面端
 * —— 摆出来只会让人误改。
 */
export function SettingsPage() {
  const { session, packaged, server, servers } = useStore()
  const pwa = usePwa()
  const [installing, setInstalling] = useState(false)
  const [community, setCommunity] = useState(false)
  const [systemInfo, setSystemInfo] = useState(false)
  const [clientIdentification, setClientIdentification] = useState(false)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [backupOpen, setBackupOpen] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [connectionOpen, setConnectionOpen] = useState(false)
  const [dataStorageOpen, setDataStorageOpen] = useState(false)
  const [modelMetadataOpen, setModelMetadataOpen] = useState(false)
  const [pluginSettingsOpen, setPluginSettingsOpen] = useState(false)
  const [updateProxyOpen, setUpdateProxyOpen] = useState(false)
  const [cloudSyncOpen, setCloudSyncOpen] = useState(false)
  const [supervisor, setSupervisor] = useState<SupervisorStatus | null>(null)
  const [supervisorBusy, setSupervisorBusy] = useState('')
  const [lanBusy, setLanBusy] = useState(false)
  const currentLocale = locale()
  const options = localeOptions()
  const identity = serverIdentity()

  /** supervisor 状态（网关是否在跑）—— 只读读数，失败不打扰 */
  const loadSupervisor = async () => {
    if (supervisorBusy) return
    try {
      const { status } = await fetchSupervisorStatus()
      if (serverIdentity() === identity) setSupervisor(status)
    } catch {
      /* 读不到就保持上一次的读数；用户可点「刷新状态」重试 */
    }
  }

  const startGateway = async () => {
    if (supervisorBusy) return
    setSupervisorBusy('start')
    try {
      await supervisorStart()
      if (serverIdentity() !== identity) return
      const { status } = await fetchSupervisorStatus()
      if (serverIdentity() === identity) setSupervisor(status)
      store.toast(t('网关已启动'))
      void store.refresh(true)
    } catch (failure) {
      if (serverIdentity() === identity) store.toast(failure instanceof Error ? failure.message : String(failure), 'err')
    } finally {
      if (serverIdentity() === identity) setSupervisorBusy('')
    }
  }

  const stopGateway = async () => {
    if (supervisorBusy) return
    setSupervisorBusy('stop')
    try {
      await supervisorStop()
      if (serverIdentity() !== identity) return
      const { status } = await fetchSupervisorStatus()
      if (serverIdentity() === identity) setSupervisor(status)
      store.toast(t('网关已停止'))
    } catch (failure) {
      if (serverIdentity() === identity) store.toast(failure instanceof Error ? failure.message : String(failure), 'err')
    } finally {
      if (serverIdentity() === identity) setSupervisorBusy('')
    }
  }

  /**
   * 局域网访问开关。
   *
   * **前置条件照抄桌面端**：必须先注册面板管理员 —— 开了之后管理接口就要求
   * 管理员会话或网关 Key，没有管理员等于把管理面敞开。桌面端是拒绝开启 +
   * 提示，这里同样**拒绝**并说明原因。
   *
   * 「一把启用的网关 Key 都没有」**不是**拦截条件而是**后果**：那种情况下
   * `/v1` 会拒绝服务，直到创建第一把（见下方说明文字，与桌面端同一口径）。
   *
   * supervisor 写完会**按新开关重启网关**，面板端口随之变化；原生壳会重新
   * 加载页面（`syncPanelPort`），所以这里的提示会被那次重载带走 —— 正常。
   */
  const toggleLan = async (next: boolean) => {
    if (supervisorBusy || lanBusy) return
    setLanBusy(true)
    try {
      if (next) {
        const status = await panelStatus()
        if (serverIdentity() !== identity) return
        // 两种情形都**拦截**（这个开关是安全相关的，读不到就绝不能放行），
        // 但必须给出不同的原因 —— 否则「读不到状态」会被说成「未注册管理员」，
        // 而用户可能刚注册过，看起来就像功能坏了。
        // 上游 `panel_status()` 的返回形状是 `{ registered: bool }`
        // （`api/panel.rs`），所以 `true` / `false` / 读不到要分开处理。
        if (status.registered !== true) {
          store.toast(
            status.registered === false
              ? t('请先在面板注册管理员，再开启局域网访问')
              : t('读不到面板管理员状态，请刷新面板后重试'),
            'err',
          )
          return
        }
      }
      const updated = await supervisorSetLan(next)
      if (serverIdentity() !== identity) return
      if (updated) setSupervisor(updated)
      // 装包顺序的坑：**新 deb + 旧 App（IPA）**。旧 App 的 `a2aControl` 没有
      // `lan` 这个 op（它的 switch 认不出来的 op 会退化成 GET /status），所以
      // 开关看起来能点、实际什么都没发生 —— 更糟的是它也不会跟着换面板端口。
      // 这里用「要求的状态没生效」把这种情况认出来，明说需要升级 App，
      // 而不是给一句「已开启」让人以为成功了。
      // （反过来「旧 deb + 新 App」不会出错：旧 supervisor 的 /status 不带 `lan`，
      //  界面上这一行根本不会渲染。）
      if (updated && Boolean(updated.lan) !== next) {
        store.toast(t('这个 App 版本还不会应用局域网开关（缺少 a2aControl 的 lan op）：请升级 App 后再试'), 'err')
        return
      }
      store.toast(next ? t('已开启局域网访问，网关正在重启…') : t('已关闭局域网访问，网关正在重启…'))
    } catch (failure) {
      if (serverIdentity() === identity) store.toast(failure instanceof Error ? failure.message : String(failure), 'err')
    } finally {
      if (serverIdentity() === identity) setLanBusy(false)
    }
  }

  // 本页没有自己的列表请求：下拉只需重拉会话（网关状态来自它）
  const pull = usePullToRefresh({ onRefresh: () => store.refresh(true) })

  // supervisor 读数与服务器切换绑定；失败静默，界面里保留上一次的读数
  useEffect(() => {
    if (!packaged) return
    let cancelled = false
    fetchSupervisorStatus()
      .then(({ status }) => { if (!cancelled && serverIdentity() === identity) setSupervisor(status) })
      .catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, packaged])

  const install = async () => {
    setInstalling(true)
    const outcome = await promptInstall()
    setInstalling(false)
    if (outcome === 'accepted') store.toast(t('正在安装…'))
    else if (outcome === 'dismissed') store.toast(t('已取消安装'))
    // 'unavailable'：没有可用事件（iOS 或已安装），界面本来就展示手动指引
  }

  const signOut = async () => {
    const identity = serverIdentity()
    const { logout } = await import('../api/auth')
    const { clearPanelAuth } = await import('../api/client')
    await logout()
    if (serverIdentity() !== identity) return
    clearPanelAuth()
    store.setAuthLost('login')
    store.toast(t('已退出登录'))
  }

  return (
    <div className='m-page' ref={pull.bindRef}>
      <PullIndicator pull={pull.pull} refreshing={pull.refreshing} />
      <PageIntro subtitle={t('外观 · 接入 · 关于')}
        actions={<IconButton name='refresh' label={t('刷新')} onClick={() => void store.refresh(true)} />}
      />

      {/* 服务器：APK 才有（浏览器里地址就是当前 origin，没什么可配的） */}
      {packaged ? (
        <div className='m-section' style={{ marginTop: 0 }}>
          <SectionHead title={t('服务器')} />
          <Card className='m-card'>
            <Button size='default' variant='ghost' type='button' className='m-row h-auto min-h-[52px] w-full justify-start rounded-none border-0 px-3.5 py-3 text-left' onClick={() => store.push('servers')}>
              <span className='m-logo' style={{ background: 'var(--m-primary-soft)', borderColor: 'transparent', color: 'var(--m-primary)' }}>
                <Icon name='server' />
              </span>
              <div className='m-grow'>
                <div className='m-t1'>{server?.name || baseLabel(server?.base || '')}</div>
                <div className='m-t2 m-mono' style={{ fontSize: 11.5 }}>
                  {servers.length > 1
                    ? t('{n} 台可选 · 点此切换', { n: servers.length })
                    : t('点此添加或切换服务器')}
                </div>
              </div>
              <span className='m-chev'>
                <Icon name='chev' />
              </span>
            </Button>
          </Card>
        </div>
      ) : null}

      {/* 网关状态 */}
      <div className='m-section' style={packaged ? undefined : { marginTop: 0 }}>
        <Card className='m-card'>
          <div className='m-row'>
            <span
              className='m-logo'
              style={{ background: 'var(--m-ok-soft)', borderColor: 'transparent', color: 'var(--m-ok)' }}
            >
              <Icon name='bolt' />
            </span>
            <div className='m-grow'>
              <div className='m-t1'>{session?.health?.upstreamConfigured ? t('网关运行中') : t('上游未配置')}</div>
              <div className='m-t2 m-mono' style={{ fontSize: 11.5 }}>
                {baseLabel(apiBase())}
              </div>
            </div>
            <Badge variant={session?.health?.upstreamConfigured ? 'success' : 'warning'} shape='tag'>
              <BadgeDot />{session?.health?.upstreamConfigured ? t('正常') : t('待配置')}
            </Badge>
          </div>
        </Card>
      </div>

      <div className='m-section'>
        <SectionHead title={t('外观')} />
        <Card className='m-card'>
          <div className='m-row'>
            <span className='m-logo'>
              <Icon name='moon' />
            </span>
            <div className='m-grow'>
              <div className='m-t1'>{t('主题')}</div>
              <div className='m-t2'>{t('跟随系统 · 浅色 · 深色')}</div>
            </div>
            <ThemeSwitch />
          </div>
          <div className='m-row'>
            <span className='m-logo'>
              <Icon name='globe' />
            </span>
            <div className='m-grow'>
              <div className='m-t1'>{t('界面语言')}</div>
              <div className='m-t2'>{options.find(item => item.code === currentLocale)?.label || currentLocale}</div>
            </div>
            <Select value={currentLocale} onValueChange={value => setLocale(String(value))}>
              <SelectTrigger aria-label={t('界面语言')} className='w-auto shrink-0'>
                <SelectValue>{options.find(item => item.code === currentLocale)?.label || currentLocale}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {options.map(item => <SelectItem key={item.code} value={item.code}>{item.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </Card>
      </div>

      <div className='m-section'>
        <SectionHead title={t('转发与内容')} />
        <Card className='m-card'>
          <Button size='default' variant='ghost' type='button' className='m-row h-auto min-h-[52px] w-full justify-start rounded-none border-0 px-3.5 py-3 text-left' onClick={() => store.push('forwarding')}>
            <span className='m-logo'><Icon name='bolt' /></span>
            <div className='m-grow'>
              <div className='m-t1'>{t('转发设置')}</div>
              <div className='m-t2'>{t('排队 · 重试 · 超时 · 图片压缩 · 兼容与排障')}</div>
            </div>
            <span className='m-chev'><Icon name='chev' /></span>
          </Button>
          <Button size='default' variant='ghost' type='button' className='m-row h-auto min-h-[52px] w-full justify-start rounded-none border-0 px-3.5 py-3 text-left' onClick={() => store.push('prompt')}>
            <span className='m-logo'><Icon name='spark' /></span>
            <div className='m-grow'>
              <div className='m-t1'>{t('系统提示词')}</div>
              <div className='m-t2'>{t('模式 · 正文 · 分提供商覆盖 · 网关装配')}</div>
            </div>
            <span className='m-chev'><Icon name='chev' /></span>
          </Button>
          <Button size='default' variant='ghost' type='button' className='m-row h-auto min-h-[52px] w-full justify-start rounded-none border-0 px-3.5 py-3 text-left' onClick={() => store.push('sanitize')}>
            <span className='m-logo'><Icon name='shield' /></span>
            <div className='m-grow'>
              <div className='m-t1'>{t('指纹脱敏')}</div>
              <div className='m-t2'>{t('剥离上游审核黑名单指纹 · 词表')}</div>
            </div>
            <span className='m-chev'><Icon name='chev' /></span>
          </Button>
          <Button size='default' variant='ghost' type='button' className='m-row h-auto min-h-[52px] w-full justify-start rounded-none border-0 px-3.5 py-3 text-left' onClick={() => setModelMetadataOpen(true)}>
            <span className='m-logo'><Icon name='model' /></span>
            <div className='m-grow'>
              <div className='m-t1'>{t('模型元数据（models.dev）')}</div>
              <div className='m-t2'>{t('补齐上游没声明的模型能力与思考档位')}</div>
            </div>
            <span className='m-chev'><Icon name='chev' /></span>
          </Button>
        </Card>
      </div>

      <div className='m-section'>
        <SectionHead title={t('安全与数据')} />
        <Card className='m-card'>
          <Button size='default' variant='ghost' type='button' className='m-row h-auto min-h-[52px] w-full justify-start rounded-none border-0 px-3.5 py-3 text-left' onClick={() => setConnectionOpen(true)}>
            <span className='m-logo'><Icon name='globe' /></span>
            <div className='m-grow'>
              <div className='m-t1'>{t('连接与安全')}</div>
              <div className='m-t2'>{t('跨来源调用 · 面板登录人机验证')}</div>
            </div>
            <span className='m-chev'><Icon name='chev' /></span>
          </Button>
          <Button size='default' variant='ghost' type='button' className='m-row h-auto min-h-[52px] w-full justify-start rounded-none border-0 px-3.5 py-3 text-left' onClick={() => setDataStorageOpen(true)}>
            <span className='m-logo'><Icon name='server' /></span>
            <div className='m-grow'>
              <div className='m-t1'>{t('数据与存储')}</div>
              <div className='m-t2'>{t('占用用量 · 日志保留策略')}</div>
            </div>
            <span className='m-chev'><Icon name='chev' /></span>
          </Button>
          <Button size='default' variant='ghost' type='button' className='m-row h-auto min-h-[52px] w-full justify-start rounded-none border-0 px-3.5 py-3 text-left' onClick={() => setCloudSyncOpen(true)}>
            <span className='m-logo'><Icon name='refresh' /></span>
            <div className='m-grow'>
              <div className='m-t1'>{t('云同步')}</div>
              <div className='m-t2'>{t('把账号与网关 Key 同步到 WebDAV / S3')}</div>
            </div>
            <span className='m-chev'><Icon name='chev' /></span>
          </Button>
        </Card>
      </div>

      <div className='m-section'>
        <SectionHead title={t('接入')} />
        <Card className='m-card'>
          <Button size='default' variant='ghost' type='button' className='m-row h-auto min-h-[52px] w-full justify-start rounded-none border-0 px-3.5 py-3 text-left' onClick={() => setClientIdentification(true)}>
            <span className='m-logo'><Icon name='doc' /></span>
            <div className='m-grow'><div className='m-t1'>{t('客户端识别')}</div><div className='m-t2'>{t('内置识别、自定义规则与来源声明')}</div></div>
            <span className='m-chev'><Icon name='chev' /></span>
          </Button>
          <Button size='default' variant='ghost' type='button' className='m-row h-auto min-h-[52px] w-full justify-start rounded-none border-0 px-3.5 py-3 text-left' onClick={() => store.push('plugins')}>
            <span className='m-logo'><Icon name='plugin' /></span>
            <div className='m-grow'>
              <div className='m-t1'>{t('网关插件')}</div>
              <div className='m-t2'>{t('查看、安装和管理所连接网关的插件')}</div>
            </div>
            <span className='m-chev'><Icon name='chev' /></span>
          </Button>
          <Button size='default' variant='ghost' type='button' className='m-row h-auto min-h-[52px] w-full justify-start rounded-none border-0 px-3.5 py-3 text-left' onClick={() => setPluginSettingsOpen(true)}>
            <span className='m-logo'><Icon name='bolt' /></span>
            <div className='m-grow'>
              <div className='m-t1'>{t('插件出站设置')}</div>
              <div className='m-t2'>{t('ZCode 版本号 · 验证码池 · Cline 伪装头')}</div>
            </div>
            <span className='m-chev'><Icon name='chev' /></span>
          </Button>
          <Button size='default' variant='ghost' type='button' className='m-row h-auto min-h-[52px] w-full justify-start rounded-none border-0 px-3.5 py-3 text-left' onClick={() => store.push('docs')}>
            <span className='m-logo'>
              <Icon name='doc' />
            </span>
            <div className='m-grow'>
              <div className='m-t1'>{t('接口地址')}</div>
              <div className='m-t2 m-mono' style={{ fontSize: 11.5 }}>
                {apiBase()}/v1
              </div>
            </div>
            <span className='m-chev'>
              <Icon name='chev' />
            </span>
          </Button>
          <Button size='default' variant='ghost' type='button' className='m-row h-auto min-h-[52px] w-full justify-start rounded-none border-0 px-3.5 py-3 text-left' onClick={() => store.push('keys')}>
            <span className='m-logo'>
              <Icon name='key' />
            </span>
            <div className='m-grow'>
              <div className='m-t1'>{t('网关 Key')}</div>
              <div className='m-t2'>{t('复制给客户端')}</div>
            </div>
            <span className='m-chev'>
              <Icon name='chev' />
            </span>
          </Button>
        </Card>
      </div>

      <div className='m-section'>
        <SectionHead title={t('账号')} />
        <Card className='m-card'>
          {/* APK 有真正的登录态，给「退出登录」；浏览器端只有 API Key 可清 */}
          {packaged ? (<>
            <Button size='default' variant='ghost' type='button' className='m-row h-auto min-h-[52px] w-full justify-start rounded-none border-0 px-3.5 py-3 text-left' onClick={() => setPasswordOpen(true)}>
              <span className='m-logo'>
                <Icon name='shield' />
              </span>
              <div className='m-grow'>
                <div className='m-t1'>{t('修改密码')}</div>
                <div className='m-t2'>{t('需要当前密码；其他设备会话会失效')}</div>
              </div>
              <span className='m-chev'>
                <Icon name='chev' />
              </span>
            </Button>
            <Button size='default' variant='ghost' type='button' className='m-row h-auto min-h-[52px] w-full justify-start rounded-none border-0 px-3.5 py-3 text-left' onClick={() => void signOut()}>
              <span className='m-logo'>
                <Icon name='logout' />
              </span>
              <div className='m-grow'>
                <div className='m-t1'>{t('退出登录')}</div>
                <div className='m-t2'>{t('退出这台服务器的登录，不影响其他服务器')}</div>
              </div>
              <span className='m-chev'>
                <Icon name='chev' />
              </span>
            </Button>
          </>) : (
            <Button size='default' variant='ghost'
              type='button'
              className='m-row h-auto min-h-[52px] w-full justify-start rounded-none border-0 px-3.5 py-3 text-left'
              onClick={() => {
                storeApiKey('')
                store.setAuthLost(null)
                store.toast(t('已清除本机保存的 API Key'))
                void store.refresh(true)
              }}
            >
              <span className='m-logo'>
                <Icon name='logout' />
              </span>
              <div className='m-grow'>
                <div className='m-t1'>{t('清除本机凭证')}</div>
                <div className='m-t2'>{t('只清掉这个浏览器存的 Key，不影响网关')}</div>
              </div>
              <span className='m-chev'>
                <Icon name='chev' />
              </span>
            </Button>
          )}
        </Card>
      </div>

      <div className='m-section'>
        <SectionHead title={t('服务')} />
        <Card className='m-card'>
          <div className='m-row'>
            <span className='m-logo'>
              <Icon name='bolt' />
            </span>
            <div className='m-grow'>
              <div className='m-t1'>{t('网关服务')}</div>
              <div className='m-t2 m-mono' style={{ fontSize: 11.5 }}>
                {supervisor
                  ? supervisor.gateway === 'running' ? t('运行中') : t('已停止')
                  : t('读取中…')}
              </div>
            </div>
            {supervisor ? (
              <Badge variant={supervisor.gateway === 'running' ? 'success' : 'secondary'} shape='tag'>
                <BadgeDot />
                {supervisor.gateway === 'running' ? t('运行中') : t('已停止')}
              </Badge>
            ) : null}
          </div>
          {supervisor && supervisor.port ? (
            <div className='m-row'>
              <span className='m-k'>{t('控制端口')}</span>
              <span className='m-v m-mono' style={{ fontSize: 11.5 }}>{supervisor.port}</span>
            </div>
          ) : null}
          {supervisor && supervisor.lan && supervisor.panelPort ? (
            <div className='m-row'>
              <span className='m-k'>{t('面板端口')}</span>
              <span className='m-v m-mono' style={{ fontSize: 11.5 }}>{supervisor.panelPort}</span>
            </div>
          ) : null}
          {/* 能力探测：只有 supervisor 真的报了 `lan` 字段才显示这一行。
              老版 daemon、以及控制桥没实现 `lan` op 的形态（例如某些 APK 壳）
              会自动隐藏 —— 不摆一个按下去必然报错的开关。
              另外 `packaged` 之外（浏览器 / PWA）没有 supervisor，也不显示。 */}
          {packaged && supervisor && supervisor.lan !== undefined ? (
            <div className='m-row'>
              <span className='m-logo'>
                <Icon name='globe' />
              </span>
              <div className='m-grow'>
                <div className='m-t1'>{t('局域网访问')}</div>
                <div className='m-t2'>
                  {supervisor.lan ? t('已开启 · 网关监听所有网卡') : t('已关闭 · 只监听 127.0.0.1')}
                </div>
              </div>
              <Switch
                checked={Boolean(supervisor.lan)}
                disabled={lanBusy || supervisorBusy !== ''}
                aria-label={t('局域网访问')}
                onCheckedChange={next => void toggleLan(next === true)}
              />
            </div>
          ) : null}
          {packaged && supervisor && supervisor.lan !== undefined ? (
            <p className='m-ck-note'>
              {t('默认只监听 127.0.0.1，只有本机能访问。开启后网关改听所有网卡，同一局域网内的设备可以把 API 地址指向本机 IP 一起使用。出于安全考虑，开启前必须先注册一个面板管理员：管理接口从此要求管理员会话或网关 Key。管理面板仍留在本机（搬到一个只听回环的独立端口），局域网只看到网关。一把启用的网关 Key 都没有时，转发接口会拒绝服务，直到创建第一把。改动会重启网关生效。')}
            </p>
          ) : null}
          {packaged && supervisor?.lan ? (
            <p className='m-ck-note'>
              {t('注意：局域网里只有网关可见；面板搬到独立端口后，若你用的是「网关 Key」方式登录本面板，需要重新填一次 Key。')}
            </p>
          ) : null}
          <div className='m-ck-actions'>
            <Button size='sm' variant='outline' disabled={Boolean(supervisorBusy) || supervisor?.gateway !== 'stopped'}
              onClick={() => void startGateway()}>
              {supervisorBusy === 'start' ? t('启动中…') : t('启动网关')}
            </Button>
            <Button size='sm' variant='outline' disabled={Boolean(supervisorBusy) || supervisor?.gateway !== 'running'}
              onClick={() => void stopGateway()}>
              {supervisorBusy === 'stop' ? t('停止中…') : t('停止网关')}
            </Button>
            <Button size='sm' variant='ghost' disabled={Boolean(supervisorBusy)} onClick={() => void loadSupervisor()}>{t('刷新状态')}</Button>
          </div>
        </Card>
      </div>

      <div className='m-section'>
        <SectionHead title={t('数据')} />
        <Card className='m-card'>
          <Button size='default' variant='ghost' type='button' className='m-row h-auto min-h-[52px] w-full justify-start rounded-none border-0 px-3.5 py-3 text-left' onClick={() => setBackupOpen(true)}>
            <span className='m-logo'>
              <Icon name='download' />
            </span>
            <div className='m-grow'>
              <div className='m-t1'>{t('整库备份 / 恢复')}</div>
              <div className='m-t2'>{t('密码加密的 .a2ab 备份，可跨机器恢复')}</div>
            </div>
            <span className='m-chev'>
              <Icon name='chev' />
            </span>
          </Button>
          <Button size='default' variant='ghost' type='button' className='m-row h-auto min-h-[52px] w-full justify-start rounded-none border-0 px-3.5 py-3 text-left' onClick={() => store.push('logs')}>
            <span className='m-logo'>
              <Icon name='log' />
            </span>
            <div className='m-grow'>
              <div className='m-t1'>{t('导出运行日志')}</div>
              <div className='m-t2'>{t('在运行日志页可导出本页记录、复制原始文本')}</div>
            </div>
            <span className='m-chev'>
              <Icon name='chev' />
            </span>
          </Button>
          {packaged ? (
            <Button size='default' variant='ghost' type='button' className='m-row h-auto min-h-[52px] w-full justify-start rounded-none border-0 px-3.5 py-3 text-left' onClick={() => setResetOpen(true)}>
              <span className='m-logo' style={{ color: 'var(--m-danger)' }}>
                <Icon name='trash' />
              </span>
              <div className='m-grow'>
                <div className='m-t1' style={{ color: 'var(--m-danger)' }}>{t('清空整库')}</div>
                <div className='m-t2'>{t('删除账号 / Key / 日志与设置，并重置管理员')}</div>
              </div>
              <span className='m-chev'>
                <Icon name='chev' />
              </span>
            </Button>
          ) : null}
        </Card>
      </div>

      {/* APK 不需要装到桌面（本身就是 App），这一段只给浏览器形态 */}
      {packaged ? null : (
      <div className='m-section'>
        <SectionHead title={t('安装到桌面')} />
        <Card className='m-card'>
          <div className='m-row'>
            <span className='m-logo'>
              <Icon name='install' />
            </span>
            <div className='m-grow'>
              <div className='m-t1'>{t('当前形态')}</div>
              <div className='m-t2'>
                {pwa.standalone ? t('已作为独立应用运行') : t('浏览器标签页')}
              </div>
            </div>
            <Badge variant={pwa.standalone ? 'success' : 'secondary'} shape='tag'>
              {pwa.standalone ? t('已安装') : t('未安装')}
            </Badge>
          </div>

          {pwa.standalone ? (
            <div className='m-card-pad' style={{ borderTop: '1px solid var(--m-line)', fontSize: 12.5, lineHeight: 1.7, color: 'var(--m-text-2)' }}>
              {t('从桌面图标启动，全屏、无地址栏。想卸载：长按图标删除，或清除浏览器站点数据。')}
            </div>
          ) : pwa.canInstall ? (
            <div style={{ borderTop: '1px solid var(--m-line)', padding: '12px 15px 14px' }}>
              <div style={{ fontSize: 12.5, lineHeight: 1.7, color: 'var(--m-text-2)' }}>
                {t('装成 App 后从桌面图标直接进入：全屏打开、没有地址栏。')}
              </div>
              <Button size='touch' variant='default'
                type='button'
                className='m-btn w-full'
                style={{ marginTop: 10, height: 40 }}
                disabled={installing}
                onClick={() => void install()}
              >
                <Icon name='download' />
                {installing ? t('正在安装…') : t('安装到主屏幕')}
              </Button>
            </div>
          ) : (
            <div style={{ borderTop: '1px solid var(--m-line)', padding: '12px 15px 14px' }}>
              <div style={{ fontSize: 12.5, lineHeight: 1.75, color: 'var(--m-text-2)' }}>
                {pwa.showIosHint
                  ? t('Safari 没有安装按钮：点底部的「分享」，选「添加到主屏幕」，再点「添加」。')
                  : t('用浏览器菜单里的「添加到主屏幕」把这一页装成 App：全屏打开、没有地址栏，和原生应用一样。')}
              </div>
              {pwa.showIosHint ? (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    marginTop: 10,
                    padding: '9px 11px',
                    borderRadius: 11,
                    background: 'var(--m-surface-2)',
                    fontSize: 12,
                    color: 'var(--m-text-3)',
                  }}
                >
                  <Icon name='share' style={{ width: 16, height: 16, flex: 'none' }} />
                  <span>{t('分享图标在 Safari 底部工具栏中间')}</span>
                </div>
              ) : null}
            </div>
          )}
        </Card>
      </div>
      )}

      {/* 只有真有事时才出现：平时不占版面 */}
      {pwa.updateReady || pwa.swState === 'unsupported' ? (
        <div className='m-section'>
          <SectionHead title={t('应用状态')} />
          <Card className='m-card'>
            {pwa.updateReady ? (
              <div className='m-row'>
                <span className='m-logo' style={{ background: 'var(--m-primary-soft)', borderColor: 'transparent', color: 'var(--m-primary)' }}>
                  <Icon name='up' />
                </span>
                <div className='m-grow'>
                  <div className='m-t1'>{t('有新版本')}</div>
                  <div className='m-t2'>{t('重启后生效，不影响当前操作')}</div>
                </div>
                <Button size='touch-sm' variant='default' type='button' className='m-btn m-sm' onClick={() => void applyUpdate()}>
                  {t('重启更新')}
                </Button>
              </div>
            ) : null}
            {pwa.swState === 'unsupported' ? (
              <div className='m-row'>
                <span className='m-logo'>
                  <Icon name='info' />
                </span>
                <div className='m-grow'>
                  <div className='m-t1'>{t('离线缓存未启用')}</div>
                  <div className='m-t2'>{t('浏览器只在 https 或 localhost 下提供离线缓存；局域网 http 访问不影响正常使用')}</div>
                </div>
              </div>
            ) : null}
          </Card>
        </div>
      ) : null}

      {/*
        APK 的更新走安装包（浏览器里没有这条路径：PWA 的更新是 Service Worker，
        见上面的「应用状态」）。两套互斥，不会同时出现。
      */}
      {packaged ? <AppUpdatePanel /> : null}

      {/* 出网线路：桌面端在「更新设置」对话框里，手机端单独一行 */}
      <div className='m-section'>
        <Card className='m-card'>
          <Button size='default' variant='ghost' type='button' className='m-row h-auto min-h-[52px] w-full justify-start rounded-none border-0 px-3.5 py-3 text-left' onClick={() => setUpdateProxyOpen(true)}>
            <span className='m-logo'><Icon name='globe' /></span>
            <div className='m-grow'>
              <div className='m-t1'>{t('更新出网代理')}</div>
              <div className='m-t2'>{t('检查更新与下载更新包走这个代理')}</div>
            </div>
            <span className='m-chev'><Icon name='chev' /></span>
          </Button>
        </Card>
      </div>

      <div className='m-section'>
        <SectionHead title={t('反馈与需求')} />
        <Card className='m-card'>
          {FEEDBACK_LINKS.map(link => (
            <Button
              key={link.url}
              size='default'
              variant='ghost'
              type='button'
              className='m-row h-auto min-h-[52px] w-full justify-start rounded-none border-0 px-3.5 py-3 text-left'
              onClick={() => openExternal(link.url)}
            >
              <span className='m-logo'>
                <Icon name='link' />
              </span>
              <div className='m-grow'>
                <div className='m-t1'>{link.title}</div>
                <div className='m-t2'>{link.desc}</div>
              </div>
              <span className='m-chev'>
                <Icon name='chev' />
              </span>
            </Button>
          ))}
        </Card>
        <Card className='m-card m-card-pad' style={{ fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.7, marginTop: 10 }}>
          {t('会在系统浏览器里打开 GitHub 的表单（模板已预设好，需要 GitHub 账号）。')}
        </Card>
      </div>

      <div className='m-section' style={{ paddingBottom: 8 }}>
        <Card className='m-card'>
          {/* 「Agent2API 手机端」这一行点开是版本信息抽屉：本机版本 + 所连网关
              的版本 / 形态 / 系统 / 路径（手机端出问题时第一句要问的就是这些，
              而用户手里只有手机，不该被要求跑回电脑前翻设置页）。
              版本号仍常驻在右侧 —— 一眼能读到的那个数最常用。 */}
          <Button size='default' variant='ghost' type='button' className='m-row h-auto min-h-[52px] w-full justify-start rounded-none border-0 px-3.5 py-3 text-left' onClick={() => setSystemInfo(true)}>
            <span className='m-logo'>
              <Icon name='info' />
            </span>
            <div className='m-grow'>
              <div className='m-t1'>{t('Agent2API 手机端')}</div>
              <div className='m-t2'>{t('版本信息 · 所连网关环境')}</div>
            </div>
            {/* 版本号常驻：排查问题时第一句就要问「你装的哪版」 */}
            <span className='m-mono' style={{ flex: 'none', fontSize: 11.5, color: 'var(--m-text-3)' }}>
              v{APP_VERSION}
            </span>
            <span className='m-chev'>
              <Icon name='chev' />
            </span>
          </Button>
          <Button size='default' variant='ghost'
            type='button'
            className='m-row h-auto min-h-[52px] w-full justify-start rounded-none border-0 px-3.5 py-3 text-left'
            style={{ borderTop: '1px solid var(--m-line)' }}
            onClick={() => setCommunity(true)}
          >
            <span className='m-logo'>
              <Icon name='heart' />
            </span>
            <div className='m-grow'>
              <div className='m-t1'>{t('社区与支持')}</div>
              <div className='m-t2'>{t('QQ 群 · Telegram')}</div>
            </div>
            <span className='m-chev'>
              <Icon name='chev' />
            </span>
          </Button>
        </Card>
      </div>

      <Sheet open={clientIdentification} onOpenChange={setClientIdentification}>
        <SheetContent><SheetHeader><SheetTitle>{t('客户端识别')}</SheetTitle></SheetHeader><SheetBody>
          {clientIdentification ? <ClientIdentificationPanel key={serverIdentity()} api={clientIdentificationApi} t={t} /> : null}
        </SheetBody></SheetContent>
      </Sheet>
      <CommunitySheet open={community} onClose={() => setCommunity(false)} />
      <SystemInfoSheet open={systemInfo} onClose={() => setSystemInfo(false)} />
      {passwordOpen ? <ChangePasswordSheet onClose={() => setPasswordOpen(false)} /> : null}
      {backupOpen ? <BackupRestoreSheet onClose={() => setBackupOpen(false)} onChanged={() => store.refresh(true)} /> : null}
      {resetOpen ? <ResetLibrarySheet onClose={() => setResetOpen(false)} /> : null}
      {connectionOpen ? <ConnectionSecuritySheet onClose={() => setConnectionOpen(false)} /> : null}
      {dataStorageOpen ? <DataStorageSheet onClose={() => setDataStorageOpen(false)} /> : null}
      {modelMetadataOpen ? <ModelMetadataSheet onClose={() => setModelMetadataOpen(false)} /> : null}
      {pluginSettingsOpen ? <PluginSettingsSheet onClose={() => setPluginSettingsOpen(false)} /> : null}
      {updateProxyOpen ? <UpdateProxySheet onClose={() => setUpdateProxyOpen(false)} /> : null}
      {cloudSyncOpen ? <CloudSyncSheet onClose={() => setCloudSyncOpen(false)} /> : null}
    </div>
  )
}

