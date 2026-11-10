import { useEffect, useState } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetBody, SheetFooter, SheetTitle , Input, Button } from '@ui'
import { Icon } from '../components/Icon'
import { ProviderLogo } from '../components/ProviderLogo'
import { Badge } from '../components/ui'
import { store } from '../state/store'
import {
  clearAccountRateLimits,
  deleteAccount,
  exportAccountFile,
  fetchAccountUsage,
  fetchUsageSnapshot,
  promoteAccount,
  refreshAccount,
  renameAccount,
  setAccountEnabled,
  type Account,
  type UsageRow,
} from '../api/gateway'
import { AccountImportSheet } from './account-import-sheet'
import { AccountLimiterSheet } from './account-limiter-sheet'
import { groupsOf, type LimiterAccountFields } from '../lib/limiter'
import { downloadJson, dateStamp, safeFileName } from '../lib/download'
import { accountName, activeLimits, formatExpiry, formatRelative, formatStamp, isRateLimited } from '../lib/format'
import { expiryOf, hasExpiry, isLongLivedCredential, supportsUsage } from '../lib/providerFacts'
import { mergeUsageRow, usageIndex, usageText } from '../lib/usage'
import { useAccountUsage } from '../hooks/useAccountUsage'
import { useDisplayClock } from '../../../ui-shared/use-display-clock'
import { credentialExpiryRowsOf, credentialExpiryText } from '../../../ui-shared/credential-expiry'
import { upstreamCooldownOf, upstreamSuspendedReasonOf } from '../../../ui-shared/account-upstream-state'
import { providerLabel } from '../lib/providers'
import { serverIdentity } from '../lib/servers'
import { t } from '../i18n'
import { confirmDialog } from '@ui'
import { MetricGrid, MetricCard } from '@ui'

/**
 * 账号详情抽屉。
 *
 * 手机上不做「编辑表单」：账号的凭证、代理、限流规则都是多字段表单，窄屏填
 * 起来痛苦且容易出错。这一层只给**查看 + 几个高频动作**（启停、刷新凭证、
 * 查询余额、设为首选、清除限流、删除），编辑仍回桌面端。
 */
export function AccountSheet({
  account,
  onClose,
  onChanged,
}: {
  account: Account | null
  onClose: () => void
  onChanged: () => void
}) {
  const now = useDisplayClock()
  const [busy, setBusy] = useState('')
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [reimportOpen, setReimportOpen] = useState(false)
  const [limiterOpen, setLimiterOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const open = Boolean(account)
  const accountId = account?.id || ''
  const identity = serverIdentity()
  /**
   * 任务式余额查询。
   *
   * ── 为什么从「同步查一次」换成它 ──────────────────────────────
   * 同步接口 `GET /api/accounts/usage?id=` 在新网关上仍然存在（所以不是坏掉），
   * 但它要**等上游把整批查完**才返回：上游慢的时候按钮一直转，用户既看不到进度
   * 也没法取消。任务式是 `/usage/start` 立刻拿任务号、`/usage/snapshot` 轮询进度，
   * 于是「启动中…／重新查询／取消查询」和进度文案都有了着落。
   */
  const usage = useAccountUsage(accountId, Boolean(account && supportsUsage(account)))

  // 凭证过期这类结论要**回灌给列表**（抽屉里显示的还是旧的启用状态）。
  // 只在结论真的变了时触发，避免轮询把它变成反复刷新。
  useEffect(() => {
    if (usage.row?.code === 'refresh_token_expired') onChanged()
  }, [usage.row?.code, usage.row?.requestId])

  // 换账号（或关掉抽屉）时重置：编辑态不能带到下一个账号上。
  // 余额走快照而不是逐个查询 —— 快照只读记录表，不触发上游，打开抽屉不会变慢。
  useEffect(() => {
    setEditingName(false)
    setNameDraft('')
  }, [accountId])

  const run = async (kind: string, task: () => Promise<unknown>, success: string): Promise<boolean> => {
    if (serverIdentity() !== identity) return false
    setBusy(kind)
    try {
      await task()
      if (serverIdentity() !== identity) return false
      store.toast(success)
      onChanged()
      return true
    } catch (error) {
      if (serverIdentity() === identity) store.toast(error instanceof Error ? error.message : String(error), 'err')
      return false
    } finally {
      if (serverIdentity() === identity) setBusy('')
    }
  }

  const remove = async () => {
    if (!account) return
    const name = accountName(account)
    // 删除不可恢复：手机上用两次确认（第一次进二次确认态）
    if (!await confirmDialog(t('确定删除账号「{name}」？这个操作不可恢复。', { name }))) return
    if (await run('delete', () => deleteAccount(account.id), t('已删除账号'))) onClose()
  }

  const saveName = async () => {
    if (!account || serverIdentity() !== identity) return
    const next = nameDraft.trim()
    if (!next) {
      store.toast(t('备注名不能为空'), 'err')
      return
    }
    setBusy('name')
    try {
      await renameAccount(account.id, next)
      if (serverIdentity() !== identity) return
      store.toast(t('备注名已更新'))
      setEditingName(false)
      onChanged()
    } catch (error) {
      if (serverIdentity() === identity) store.toast(error instanceof Error ? error.message : String(error), 'err')
    } finally {
      if (serverIdentity() === identity) setBusy('')
    }
  }

  /** 不传 model 时同时清除账号冷却和全部模型限流。 */
  const clearLimit = async (model?: string) => {
    if (!account) return
    const question = model
      ? t('确定清除模型「{model}」的限流标记？', { model })
      : t('确定清除该账号的冷却与全部模型限流标记？')
    if (!await confirmDialog(question)) return
    await run('clear', () => clearAccountRateLimits(account.id, model), t('限流已清除'))
  }

  const promote = async () => {
    if (!account) return
    await run('promote', () => promoteAccount(account.id), t('已设为首选'))
  }

  /**
   * 限流规则的一句话摘要。
   *
   * 规则可能来自新格式 `limiterGroups`，也可能是旧记录的 `limiters` ——
   * `groupsOf` 会把后者换算成同一形状（与桌面端同一套换算），所以这里不关心
   * 它来自哪种。没有规则时说"未设置"，而不是显示 0 组（0 组和没读过是两回事）。
   */
  const limiterGroups = account ? groupsOf(account as Account & LimiterAccountFields, (account as Account & LimiterAccountFields).limiters || []) : []
  const enabledGroups = limiterGroups.filter(group => group.enabled)
  const limiterSummary = !account
    ? ''
    : enabledGroups.length === 0
      ? t('未设置（点开可添加）')
      : t('{n} 组生效中的规则', { n: enabledGroups.length })

  /** 导出这个账号的凭证文件（.json），可在原客户端或另一台网关上再导入 */
  const exportThis = async () => {
    if (!account || exporting || serverIdentity() !== identity) return
    setExporting(true)
    try {
      const data = await exportAccountFile({ id: account.id })
      if (serverIdentity() !== identity) return
      const name = safeFileName(accountName(account), account.id)
      await downloadJson(data, `${name}-${dateStamp()}.json`)
      store.toast(t('已导出账号文件'))
    } catch (error) {
      if (serverIdentity() === identity) store.toast(error instanceof Error ? error.message : String(error), 'err')
    } finally {
      if (serverIdentity() === identity) setExporting(false)
    }
  }

  const limits = account ? activeLimits(account) : []
  const cooldown = upstreamCooldownOf(account)
  const suspendedReason = upstreamSuspendedReasonOf(account)
  const expiresAt = account ? expiryOf(account) : 0
  const credentialRows = account ? credentialExpiryRowsOf(account, expiresAt) : []
  const usageView = usageText(usage.row as UsageRow | undefined, now)
  const usageColor =
    usageView.kind === 'bad'
      ? 'var(--m-danger)'
      : usageView.kind === 'warn'
        ? 'var(--m-warn)'
        : 'var(--m-text)'
  const isPrimary = (store.get().session?.routedAccountId || store.get().session?.accounts?.currentAccountId) === account?.id
  const sortActive = (store.get().session?.accounts?.sorting?.rules[String(account?.provider || '')] || []).some(rule => rule.on)
  const canQueryUsage = Boolean(account && supportsUsage(account))
  const canRefresh = Boolean(account && account.desktop !== true && (account.canRefresh === true || account.hasRefreshToken === true))

  return (
    <Sheet open={open} onOpenChange={next => { if (!next) onClose() }}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{t('账号详情')}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          {account ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <ProviderLogo id={account.provider} size='lg' />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {accountName(account)}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--m-text-3)', marginTop: 3 }}>
                    {providerLabel(account.provider, account.editionLabel)}
                    {account.priority !== undefined ? ` · #${account.priority}` : ''}
                  </div>
                </div>
                <Badge tone={statusTone(account)} dot>
                  {statusText(account)}
                </Badge>
              </div>

              {/* 备注名就地编辑：手机上没有表单页，改一个字段不该跳走 */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  minHeight: 38,
                  padding: '6px 10px',
                  borderRadius: 11,
                  background: 'var(--m-surface-2)',
                  border: '1px solid var(--m-line)',
                }}
              >
                {editingName ? (
                  <>
                    <Input
                      value={nameDraft}
                      autoFocus
                      onChange={event => setNameDraft(event.target.value)}
                      placeholder={t('备注名')}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        border: 0,
                        outline: 'none',
                        background: 'transparent',
                        color: 'var(--m-text)',
                        // 16px 以下 iOS Safari 聚焦时会自动放大页面
                        fontSize: 16,
                      }}
                    />
                    <Button size='touch-sm' variant='default'
                      type='button'
                      className='m-btn m-sm'
                      disabled={busy === 'name'}
                      onClick={() => void saveName()}
                    >
                      {t('保存')}
                    </Button>
                    <Button size='touch-sm' variant='outline'
                      type='button'
                      className='m-btn m-ghost m-sm'
                      disabled={busy === 'name'}
                      onClick={() => {
                        setEditingName(false)
                        setNameDraft('')
                      }}
                    >
                      {t('取消')}
                    </Button>
                  </>
                ) : (
                  <Button size='default' variant='ghost'
                    type='button'
                    onClick={() => {
                      setNameDraft(account.name || '')
                      setEditingName(true)
                    }}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: 0,
                      border: 0,
                      background: 'none',
                      textAlign: 'left',
                      color: account.name ? 'var(--m-text)' : 'var(--m-text-3)',
                      fontSize: 13,
                    }}
                  >
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {account.name || t('未设备注名')}
                    </span>
                    <Icon name='edit' style={{ width: 15, height: 15, flex: 'none', color: 'var(--m-text-3)' }} />
                  </Button>
                )}
              </div>

              <MetricGrid className='m-kv'>
                {credentialRows.length || hasExpiry(account.provider) ? (
                  <MetricCard className='m-kv-cell'>
                    <div className='k'>{t('有效期')}</div>
                    {credentialRows.length ? <div className='flex flex-col gap-1.5'>
                      {credentialRows.map(row => <div key={row.label} className='flex items-center justify-between gap-2 text-xs'
                        title={row.expiresAt === null ? undefined : formatStamp(row.expiresAt)}>
                        <span className='text-subtle' translate='no'>{row.label}</span>
                        <span className={row.expiresAt !== null && row.expiresAt <= Date.now() ? 'text-destructive' : undefined}>
                          {credentialExpiryText(row, t)}
                        </span>
                      </div>)}
                    </div> : <div className='v'>
                      {isLongLivedCredential(account.provider) ? t('长期有效') : formatExpiry(expiresAt)}
                    </div>}
                  </MetricCard>
                ) : null}
                <MetricCard className='m-kv-cell'>
                  <div className='k'>{t('余额')}</div>
                  <div className='v' title={canQueryUsage ? usageView.detail : undefined}
                    style={{ color: usageView.failureStatus ? 'var(--m-text)' : usageColor }}>
                    {canQueryUsage ? usageView.text : t('未接入查询')}
                  </div>
                  {canQueryUsage && usageView.expiry ? (
                    <div className='text-xs text-warning mt-1 whitespace-normal leading-snug'>
                      <div>{usageView.expiry.summary}</div>
                      {usageView.expiry.today ? <div>{usageView.expiry.today}</div> : null}
                    </div>
                  ) : null}
                  {canQueryUsage && usageView.failureStatus ? (
                    <div className='text-xs text-destructive mt-1 whitespace-normal leading-snug' title={usageView.failureDetail}>
                      {usageView.failureStatus}
                    </div>
                  ) : null}
                </MetricCard>
                <MetricCard className='m-kv-cell'>
                  <div className='k'>{t('凭证')}</div>
                  <div className='v'>{account.hasCredentials === false ? t('缺失') : t('完整')}</div>
                </MetricCard>
                <MetricCard className='m-kv-cell'>
                  <div className='k'>{t('限流模型')}</div>
                  <div className='v'>{limits.length}</div>
                </MetricCard>
                <MetricCard className='m-kv-cell'>
                  <div className='k'>{t('最近更新')}</div>
                  <div className='v m-mono' style={{ fontSize: 12 }}>
                    {formatStamp(account.updatedAt as number)}
                  </div>
                </MetricCard>
              </MetricGrid>

              {/* 首选是队列位次，不是账号属性：给它一个整行按钮，别混进删除那一排 */}
              <Button size='touch' variant='outline'
                type='button'
                className='m-btn m-ghost w-full'
                disabled={isPrimary || Boolean(busy) || sortActive}
                title={sortActive ? t('自动消耗排序已启用，请先关闭规则再手动调整') : undefined}
                onClick={() => void promote()}
                style={{ flexDirection: 'column', gap: 2, height: 'auto', padding: '10px 16px' }}
              >
                <span>{isPrimary ? t('已是首选') : t('设为首选')}</span>
                <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--m-text-3)' }}>
                  {t('调整到全局队列第一位')}
                </span>
              </Button>

              <Button size='touch' variant='outline'
                type='button'
                className='m-btn m-ghost w-full'
                disabled={Boolean(busy)}
                onClick={() => setLimiterOpen(true)}
                style={{ flexDirection: 'column', gap: 2, height: 'auto', padding: '10px 16px' }}
              >
                <span>{t('限流规则')}</span>
                <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--m-text-3)' }}>
                  {limiterSummary}
                </span>
              </Button>

              <div className='m-rows'>
                <div className='m-row'>
                  <span className='m-k'>{t('账号 ID')}</span>
                  <span className='m-v m-mono' style={{ fontSize: 11 }}>
                    {account.id}
                  </span>
                </div>
                {account.email ? (
                  <div className='m-row'>
                    <span className='m-k'>{t('邮箱')}</span>
                    <span className='m-v'>{account.email}</span>
                  </div>
                ) : null}
                <div className='m-row'>
                  <span className='m-k'>{t('启用')}</span>
                  <span className='m-v'>{account.enabled ? t('是') : t('否')}</span>
                </div>
                {/* 读数之外还有话要说时才占一行（部分失败、钱包明细） */}
                {canQueryUsage && usageView.detail && usageView.detail !== usageView.text ? (
                  <div className='m-row' style={{ alignItems: 'flex-start' }}>
                    <span className='m-k' style={{ flex: 'none' }}>{t('余额详情')}</span>
                    <span
                      className='m-v'
                      style={{ flex: 1, minWidth: 0, textAlign: 'right', lineHeight: 1.5, wordBreak: 'break-word' }}
                    >
                      {usageView.detail}
                    </span>
                  </div>
                ) : null}
                {suspendedReason ? (
                  <div className='m-row' style={{ alignItems: 'flex-start' }}>
                    <span className='m-k'>{t('上游限制 · 已禁用')}</span>
                    <span className='m-v' style={{ color: 'var(--m-danger)', whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: 1.5 }}>
                      {suspendedReason}
                    </span>
                  </div>
                ) : null}
                {account.needsRelogin ? (
                  <div className='m-row' style={{ alignItems: 'flex-start' }}>
                    <span className='m-k'>{t('需要重新登录')}</span>
                    <span className='m-v' style={{ color: 'var(--m-danger)', whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: 1.5 }}>
                      {account.needsReloginReason || t('登录授权已失效，请重新登录；自动续期无法恢复已过期或已撤销的刷新令牌。')}
                    </span>
                  </div>
                ) : null}
              </div>

              {limits.length || cooldown ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 2px' }}>
                    <span style={{ flex: 1, fontSize: 12, color: 'var(--m-text-3)' }}>{t('限流明细')}</span>
                    <Button size='touch-sm' variant='outline'
                      type='button'
                      className='m-btn m-ghost m-sm'
                      disabled={busy === 'clear'}
                      onClick={() => void clearLimit()}
                    >
                      {t('全部清除')}
                    </Button>
                  </div>
                  <div className='m-rows'>
                    {cooldown ? (
                      <div className='m-row' style={{ alignItems: 'flex-start' }}>
                        <span className='m-k'>{t('账号冷却')}</span>
                        <div className='m-v' style={{ whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: 1.5 }}>
                          <div title={formatStamp(cooldown.resetAt)}>{t('{time} 恢复', { time: formatRelative(cooldown.resetAt) })}</div>
                          <div>{t('账号全部模型暂时停止转发 · 到恢复时间自动解除')}</div>
                          {cooldown.message ? <div>{cooldown.message}</div> : null}
                        </div>
                      </div>
                    ) : null}
                    {limits.map(({ model, resetAt }) => (
                      <div key={model} className='m-row'>
                        <span className='m-k m-mono' style={{ fontSize: 11 }}>
                          {model}
                        </span>
                        <span className='m-v'>
                          {t('{time} 恢复', { time: formatRelative(resetAt) })}
                        </span>
                        <Button size='touch-sm' variant='outline'
                          type='button'
                          className='m-btn m-ghost m-sm'
                          style={{ flex: 'none', marginLeft: 8 }}
                          disabled={busy === 'clear'}
                          onClick={() => void clearLimit(model)}
                        >
                          {t('清除')}
                        </Button>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
            </>
          ) : null}
        </SheetBody>
        <SheetFooter style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
          {canQueryUsage ? <Button size='touch' variant='outline'
            type='button'
            className='m-btn m-ghost w-full'
            disabled={usage.starting || Boolean(busy) || !account}
            onClick={() => void usage.query()}
          >
            <Icon name='wallet' />
            {usage.starting ? t('启动中…') : usage.task?.status === 'running' ? t('重新查询') : t('查询余额')}
          </Button> : null}
          {/* 进度文案由钩子给出，空则不占位 */}
          {canQueryUsage && usage.status ? <p className='text-xs text-subtle' role='status'>{usage.status}</p> : null}
          {/* 快照里的结论是上一次配置下测出来的：提示一句，免得被当成当前结论 */}
          {canQueryUsage && usage.row?.stale ? <p className='text-xs text-subtle'>{t('历史余额，尚未按新配置验证')}</p> : null}
          {canQueryUsage && usage.task?.status === 'running' ? <Button variant='outline'
            type='button' className='m-btn m-ghost w-full' onClick={() => void usage.cancel()}>
            {t('取消查询')}
          </Button> : null}
          {canRefresh ? <Button size='touch' variant='default'
            type='button'
            className='m-btn w-full'
            disabled={Boolean(busy) || !account || account.needsRelogin === true}
            title={account?.needsRelogin ? account.needsReloginReason : undefined}
            onClick={() => account && void run('refresh', () => refreshAccount(account.id), t('凭证已刷新'))}
          >
            <Icon name='refresh' />
            {busy === 'refresh' ? t('刷新中…') : t('刷新凭证')}
          </Button> : account ? <p className='text-xs text-subtle'>{t('未声明可手动续期；本机引用请在原客户端处理登录态。')}</p> : null}
          <div className='m-btn-row'>
            <Button size='touch' variant='outline'
              type='button'
              className='m-btn m-ghost w-full'
              style={{ flex: 1 }}
              disabled={exporting || !account}
              onClick={() => void exportThis()}
            >
              <Icon name='download' />
              {exporting ? t('导出中…') : t('导出账号')}
            </Button>
            <Button size='touch' variant='outline'
              type='button'
              className='m-btn m-ghost w-full'
              style={{ flex: 1 }}
              disabled={Boolean(busy) || !account}
              onClick={() => setReimportOpen(true)}
            >
              <Icon name='edit' />
              {t('重新粘贴凭证')}
            </Button>
          </div>
          <div className='m-btn-row'>
            <Button size='touch' variant='outline'
              type='button'
              className='m-btn m-ghost w-full'
              style={{ flex: 1 }}
              disabled={busy === 'toggle' || !account}
              onClick={() =>
                account &&
                void run(
                  'toggle',
                  () => setAccountEnabled(account.id, !account.enabled),
                  account.enabled ? t('已禁用') : t('已启用'),
                )
              }
            >
              <Icon name={account?.enabled ? 'pause' : 'play'} />
              {account?.enabled ? t('禁用') : t('启用')}
            </Button>
            <Button size='touch' variant='destructive'
              type='button'
              className='m-btn m-danger w-full'
              style={{ flex: 1 }}
              disabled={busy === 'delete' || !account}
              onClick={() => void remove()}
            >
              <Icon name='trash' />
              {busy === 'delete' ? t('删除中…') : t('删除')}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
      {reimportOpen && account ? (
        <AccountImportSheet
          providers={store.get().session?.accounts?.providers || []}
          initialProvider={account.provider}
          onClose={() => setReimportOpen(false)}
          onImported={() => {
            setReimportOpen(false)
            onChanged()
            onClose()
          }}
        />
      ) : null}
      {limiterOpen && account ? (
        <AccountLimiterSheet
          account={account}
          onClose={() => setLimiterOpen(false)}
          onChanged={onChanged}
        />
      ) : null}
    </Sheet>
  )
}

function statusTone(account: Account): 'ok' | 'warn' | 'bad' | 'mute' {
  if (account.needsRelogin || upstreamSuspendedReasonOf(account)) return 'bad'
  if (!account.enabled) return 'mute'
  if (isRateLimited(account)) return 'warn'
  const expiresAt = expiryOf(account)
  if (expiresAt > 0 && expiresAt <= Date.now()) return 'bad'
  return 'ok'
}

function statusText(account: Account): string {
  if (account.needsRelogin) return t('需重登')
  if (upstreamSuspendedReasonOf(account)) return t('上游限制 · 已禁用')
  if (!account.enabled) return t('已禁用')
  if (upstreamCooldownOf(account)) return t('账号冷却')
  if (isRateLimited(account)) return t('限流中')
  const expiresAt = expiryOf(account)
  if (expiresAt > 0 && expiresAt <= Date.now()) return t('已过期')
  return t('正常')
}
