import { Button, Progress, Switch , Card, Label, Collapsible, CollapsibleTrigger, CollapsibleContent } from '@ui'
import { Badge } from '../../components/ui'
import type { PackSummary, PluginOperation, PluginUpdate, StorePlugin } from '../../api/plugins'
import { pluginErrorMessage } from '../../api/plugins'
import { t } from '../../i18n'
import { PluginSettingsButton } from '../../../../ui-shared/plugins-store'
import { usePluginLoadStatus, requestPluginDiagnostics } from '../../../../ui-shared/plugin-startup-view'
import { pluginFailed, pluginPhaseLabel } from '../../../../ui-shared/plugin-startup'

function PluginProgress({ operation }: { operation?: PluginOperation }) {
  if (!operation) return null
  const stage = operation.stage === 'downloading' ? t('网关正在下载…')
    : operation.stage === 'verifying' ? t('网关正在校验…')
    : operation.stage === 'waiting' ? t('等待当前任务结束，插件继续服务…')
    : operation.stage === 'loading' ? t('正在加载新插件…')
    : operation.stage === 'restoring' ? t('正在恢复旧版本插件…') : t('网关正在安装…')
  return <>
    {operation.active ? <div className='my-3' aria-live='polite'>
      <p className='m-ck-note'>{operation.required ? `${t('正在补齐插件…')} · ` : ''}{stage}{operation.stage === 'downloading' && operation.percent != null ? ` ${Math.round(operation.percent)}%` : ''}</p>
      <Progress value={operation.stage === 'downloading' ? operation.percent : null} aria-label={stage} />
    </div> : null}
    {operation.error ? <p className='m-ck-error'>{pluginErrorMessage(operation.error)}</p> : null}
    {operation.hostError ? <p className='m-ck-error'>{operation.hostError}</p> : null}
  </>
}

function Head({ name, version, icon }: { name: string; version?: string | null; icon?: string | null }) {
  return <div className='m-ck-toolbar'>
    <span className='m-logo'>{icon ? <img src={icon} alt='' /> : name.slice(0, 1)}</span>
    <div className='m-ck-grow'>
      <div className='m-ck-title'>{t(name)}</div>
      <div className='m-ck-note'>{version ? `v${version}` : t('暂未发布')}</div>
    </div>
  </div>
}

export function StorePluginCard({ item, target, busy, operation, onInstall }: {
  item: StorePlugin
  target: string
  busy: boolean
  operation?: PluginOperation
  onInstall: () => void
}) {
  const asset = item.platforms?.find(platform => platform.target === target)
  return <Card render={<article />} className='m-card m-card-pad'>
    <Head name={item.name || item.id} version={item.version} icon={item.icon} />
    <p className='m-ck-note'>{t(item.description)}</p>
    {item.reason ? <p className={item.error ? 'm-ck-error' : 'm-ck-note'}>{pluginErrorMessage(item.reason)}</p> : null}
    <PluginProgress operation={operation} />
    {!operation?.active ? <div className='m-ck-actions'>
      <Button size='sm' disabled={busy || !asset || !item.version || item.error} onClick={onInstall}>{t('在网关下载并安装')}</Button>
    </div> : null}
    {!asset ? <p className='m-ck-note'>{t('当前网关平台暂无插件包')}</p> : null}
  </Card>
}

export function PluginCard({ pack, target, busy, update, operation, onEnabled, onProvider, onUpdate, onRemove, onSettings }: {
  pack: PackSummary
  target: string
  busy: boolean
  update?: PluginUpdate
  operation?: PluginOperation
  onEnabled: (enabled: boolean) => void
  onProvider: (id: string, enabled: boolean) => void
  onUpdate: () => void
  onRemove: () => void
  /** 打开「插件包设置」抽屉（运行态 / 助手 / 诊断）。 */
  onSettings: () => void
}) {
  const required = pack.updateRequired === true
  const locked = busy || operation?.active === true
  // 插件的加载阶段（启动中 / 就绪 / 失败）。有实时状态就用实时值，
  // 拿不到时退回 payload 里带的快照 —— 断线时卡片不该整块空白。
  const startup = usePluginLoadStatus(pack.id, pack.startup)
  return <Card render={<article />} className='m-card m-card-pad'>
    <Head name={pack.name || pack.id} version={pack.version} icon={pack.icon} />
    <div className='m-ck-actions'>
      <Badge tone='mute'>{t('社区插件')}</Badge>
      <Badge tone={pack.enabled ? 'ok' : 'mute'}>{pack.enabled ? t('已启用') : t('已停用')}</Badge>
      <Badge tone={pack.signed ? 'ok' : 'warn'}>{pack.signed ? t('已签名') : t('未签名')}</Badge>
      {required ? <Badge tone='warn'>{t('接口不兼容')}</Badge> : null}
      <Badge tone={pluginFailed(startup) ? 'warn' : startup?.phase === 'ready' ? 'ok' : 'mute'}>{pluginPhaseLabel(startup, t)}</Badge>
      <Button size='sm' variant='ghost' disabled={locked} onClick={() => requestPluginDiagnostics(pack.id)}>{t('加载诊断')}</Button>
      <Badge tone={pack.providers?.some(provider => provider.loaded) ? 'ok' : 'warn'}>{t('已加载 {n} 家', { n: pack.providers?.filter(provider => provider.loaded).length || 0 })}</Badge>
    </div>
    {pack.description ? <p className='m-ck-note'>{t(pack.description)}</p> : null}
    {required ? <div className='mt-3 rounded-md border border-destructive/30 px-3 py-2' aria-live='polite'>
      {/* 优先显示网关给的不兼容原因；没有才用通用说明 */}
      <p className='m-ck-error'>{pack.compatibilityError || t('插件与当前网关的公共接口不兼容，暂未加载。')}</p>
      <p className='m-ck-note'>{t('请根据不兼容原因更新插件或网关；不会要求两者版本号一致。')}</p>
      {update?.reason ? <p className={update.error ? 'm-ck-error' : 'm-ck-note'}>{pluginErrorMessage(update.reason)}</p> : null}
      {update?.retryAt && update.retryAt > Date.now() ? <p className='m-ck-note'>
        {t('下次自动重试：{time}', { time: new Date(update.retryAt).toLocaleString() })}
      </p> : null}
    </div> : null}
    {!pack.entryPresent ? <p className='m-ck-error'>{t('插件文件缺失，请重新安装插件包')}</p> : null}
    {pack.host?.lastError ? <p className='m-ck-error'>{pack.host.lastError}</p> : null}
    {update?.reason && !required ? <p className={update.error ? 'm-ck-error' : 'm-ck-note'}>{pluginErrorMessage(update.reason)}</p> : null}
    <PluginProgress operation={operation} />
    <div className='m-ck-actions'>
      <Label className='m-ck-toolbar m-ck-note'>
        {t('启用')}<Switch checked={pack.enabled} disabled={locked} aria-label={t('启用插件 {name}', { name: pack.name })}
          onCheckedChange={onEnabled} />
      </Label>
      <PluginSettingsButton name={pack.name || pack.id} t={t} onClick={onSettings} />
      <Button size='sm' variant='outline' disabled={locked} onClick={onRemove}>{t('卸载')}</Button>
      {required ? <Button size='sm' disabled={locked || update?.repairing === true} onClick={onUpdate}>
        {update?.repairing ? t('正在补齐插件…') : t('补齐插件')}
      </Button> : update?.available ? <Button size='sm' disabled={locked || update.error || !update.asset || update.asset.target !== target} onClick={onUpdate}>
        {t('更新到 v{version}', { version: update.latest || '' })}
      </Button> : null}
    </div>
    <Collapsible className='mt-3 border-t border-hairline pt-3'>
      <CollapsibleTrigger className='m-ck-title'>{t('提供商启停')}</CollapsibleTrigger><CollapsibleContent keepMounted>
      {pack.providers?.map(provider => <Label className='m-ck-toolbar py-2' key={provider.id}>
        {/* 被其他插件接管的提供商：开关置灰并显示原因 —— 这里改了也不会生效，
            不说明的话用户会以为是自己没打开 */}
        <Switch checked={provider.enabled && !provider.overriddenBy}
          disabled={locked || !pack.enabled || Boolean(provider.overriddenBy)}
          aria-label={t(provider.label)} onCheckedChange={enabled => onProvider(provider.id, enabled)} />
        <span className='m-ck-note m-ck-grow'>{t(provider.label)}</span>
        {provider.overriddenBy ? <Badge tone='mute'>{t('由其他插件接管')}</Badge>
          : provider.enabled && !provider.loaded
            ? <Badge tone={pluginFailed(startup) ? 'warn' : 'mute'}>{pluginPhaseLabel(startup, t)}</Badge>
            : null}
      </Label>)}
    </CollapsibleContent></Collapsible>
  </Card>
}
