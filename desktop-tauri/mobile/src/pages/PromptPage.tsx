import { useCallback, useEffect, useMemo, useState } from 'react'
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
  Textarea,
} from '@ui'
import { PageHead, SectionHead, ErrorNote, Empty, Badge } from '../components/ui'
import { Icon } from '../components/Icon'
import { usePullToRefresh, PullIndicator } from '../components/PullToRefresh'
import { serverIdentity } from '../lib/servers'
import { store } from '../state/store'
import { t } from '../i18n'
import {
  GATEWAY_PLACEHOLDERS,
  GATEWAY_SEGMENTS,
  fetchPrompt,
  gatewayBlocksOf,
  gatewayEnabled,
  promptModeLabel,
  promptSourceLabel,
  putPrompt,
  type GatewayBlocks,
  type GatewaySegment,
  type PromptMode,
  type PromptProviderEntry,
  type PromptProviderOption,
  type PromptSettings,
} from '../api/prompt'

/**
 * 系统提示词。
 *
 * 三层结构（与网关一致）：
 *  ① **全局**：模式（透传 / 自定义 / 追加）+ 正文；
 *  ② **分提供商覆盖**：某家单独设模式与正文，或「跟随默认」把这家删掉；
 *  ③ **网关自带提示词**：某些提供商（ZCode 等）在转发时会装配网关自己那段提示词，
 *     可以按家关闭装配，或改写它的三段（身份句 / 稳定段 / 动态段）。
 *
 * 手机端**不编辑提示词文件路径**：那是桌面端指向本地文件的能力，手机上没有对应概念；
 * 这里只读展示当前生效来源（`promptSource`），以及文件读不到时的原因（`promptFileError`）。
 */
export function PromptPage() {
  const identity = serverIdentity()
  const [settings, setSettings] = useState<PromptSettings | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [loading, setLoading] = useState(true)

  // 全局草稿
  const [mode, setMode] = useState<PromptMode>('passthrough')
  const [text, setText] = useState('')
  // 编辑器抽屉
  const [editingProvider, setEditingProvider] = useState<PromptProviderOption | null>(null)
  const [editingGateway, setEditingGateway] = useState<PromptProviderOption | null>(null)
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    try {
      const next = await fetchPrompt()
      if (serverIdentity() !== identity) return
      setSettings(next)
      setMode(next.promptMode || 'passthrough')
      setText(next.promptText || '')
      setError('')
    } catch (cause) {
      if (serverIdentity() === identity) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (serverIdentity() === identity) setLoading(false)
    }
  }, [identity])

  useEffect(() => {
    void load()
  }, [load])

  const pull = usePullToRefresh({ onRefresh: () => load() })

  const options = settings?.promptProviderOptions || []
  const configured = settings?.promptProviders || {}

  /** 注册表里可添加的家：还没配过、且注册表知道它的存在 */
  const addableOptions = useMemo(
    () => options.filter(option => !Object.prototype.hasOwnProperty.call(configured, option.id)),
    [options, configured],
  )

  /** 已配过的家：注册表里可能没有（插件临时卸载），单独补一条 */
  const configuredRows = useMemo(() => {
    return Object.keys(configured)
      .map(id => {
        const option = options.find(item => item.id === id)
        return { option: option || { id, label: id }, entry: configured[id] }
      })
      .sort((a, b) => a.option.label.localeCompare(b.option.label))
  }, [configured, options])

  /** 有网关装配的家 */
  const gatewayRows = useMemo(
    () => options.filter(option => option.gatewayBlocks && Object.keys(option.gatewayBlocks).length > 0),
    [options],
  )

  const run = async (section: string, body: Parameters<typeof putPrompt>[0], done: string) => {
    if (busy) return
    setBusy(section)
    setError('')
    try {
      const next = await putPrompt(body)
      if (serverIdentity() !== identity) return
      setSettings(next)
      setMode(next.promptMode || 'passthrough')
      setText(next.promptText || '')
      store.toast(done)
    } catch (cause) {
      if (serverIdentity() === identity) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (serverIdentity() === identity) setBusy('')
    }
  }

  const saveGlobal = async () => {
    if (!settings) return
    const patch: Parameters<typeof putPrompt>[0] = {}
    if (mode !== (settings.promptMode || 'passthrough')) patch.promptMode = mode
    // 空串是「清除界面正文」，不是「不改」—— 用户清空就是要清掉
    if (text !== (settings.promptText || '')) patch.promptText = text
    if (!Object.keys(patch).length) {
      store.toast(t('没有改动'))
      return
    }
    await run('global', patch, t('已保存，下一个请求生效'))
  }

  const modeOptions = (['passthrough', 'custom', 'append'] as PromptMode[]).map(value => ({
    value,
    label: promptModeLabel(value, t),
  }))

  const degrade = settings?.degradeActive === true

  return (
    <div className='m-page' ref={pull.bindRef}>
      <PullIndicator pull={pull.pull} refreshing={pull.refreshing} />
      <PageHead title={t('系统提示词')} subtitle={t('模式 · 正文 · 分提供商 · 网关装配')} />

      <div className='m-section' style={{ marginTop: 0 }}>
        {error ? <ErrorNote text={error} /> : null}
        {degrade ? (
          <Alert variant='warning'>
            <AlertDescription>
              {t('当前处于内容拦截降级期（{until}）。降级期间网关用内置兜底提示词，自定义提示词不生效。', {
                until: settings?.degradeUntilText || '',
              })}
            </AlertDescription>
          </Alert>
        ) : null}
        {loading ? (
          <Card className='m-card'>
            <Empty text={t('正在读取提示词设置…')} />
          </Card>
        ) : null}
      </div>

      {degrade ? (
        <div className='m-section'>
          <Button variant='outline' disabled={Boolean(busy)} onClick={() => void run('degrade', { clearDegrade: true }, t('已解除降级期'))}>
            {t('立即解除降级期')}
          </Button>
        </div>
      ) : null}

      {settings ? (
        <>
          {/* ① 全局 */}
          <div className='m-section'>
            <SectionHead
              title={t('全局')}
              action={{ label: busy === 'global' ? t('保存中…') : t('保存'), onClick: () => void saveGlobal() }}
            />
            <Card className='m-card m-card-pad'>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <Label>{t('模式')}</Label>
                  <SegmentedControl
                    options={modeOptions}
                    value={mode}
                    aria-label={t('提示词模式')}
                    onValueChange={value => setMode(value as PromptMode)}
                  />
                  <p style={{ fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.6, marginTop: 6 }}>
                    {mode === 'passthrough'
                      ? t('透传：不改客户端自带的提示词，网关不注入任何内容。')
                      : mode === 'append'
                        ? t('追加：保留客户端提示词，在其后追加下面的正文。')
                        : t('自定义：用下面的正文替换客户端提示词。')}
                  </p>
                </div>

                <div>
                  <Label htmlFor='prompt-text'>{t('提示词正文')}</Label>
                  <Textarea
                    id='prompt-text'
                    rows={10}
                    className='m-mono'
                    placeholder={t('留空表示不注入正文')}
                    value={text}
                    onChange={event => setText(event.currentTarget.value)}
                  />
                  <p style={{ fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.6, marginTop: 4 }}>
                    {t('清空正文并保存 = 清除界面正文；只有「自定义」与「追加」模式才生效。')}
                  </p>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                  <Badge tone='mute'>{t('生效来源')}</Badge>
                  <span style={{ fontSize: 12 }}>{promptSourceLabel(settings.promptSource, t)}</span>
                  {typeof settings.promptLines === 'number' ? (
                    <span className='m-mono' style={{ fontSize: 11.5, color: 'var(--m-text-3)' }}>
                      {t('{count} 行', { count: settings.promptLines })}
                    </span>
                  ) : null}
                </div>

                {settings.promptFile ? (
                  <div className='m-rows'>
                    <div className='m-row'>
                      <span className='m-k'>{t('提示词文件')}</span>
                      <span className='m-v m-mono'>{settings.promptFile}</span>
                    </div>
                  </div>
                ) : null}
                {settings.promptFileError ? (
                  <p style={{ fontSize: 12, color: 'var(--m-danger)', lineHeight: 1.6 }}>
                    {t('文件读不到，已回落内置提示词：{reason}', { reason: settings.promptFileError })}
                  </p>
                ) : null}
                <p style={{ fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.6 }}>
                  {t('提示词文件路径只能在桌面端设置；手机端只展示当前生效来源。')}
                </p>
              </div>
            </Card>
          </div>

          {/* ② 分提供商覆盖 */}
          <div className='m-section'>
            <SectionHead
              title={t('分提供商覆盖')}
              action={addableOptions.length ? { label: t('添加'), onClick: () => setAdding(true) } : undefined}
            />
            <Card className='m-card'>
              {configuredRows.length ? (
                configuredRows.map(({ option, entry }) => (
                  <Button
                    key={option.id}
                    size='default'
                    variant='ghost'
                    type='button'
                    className='m-row h-auto min-h-[52px] w-full justify-start rounded-none border-0 px-3.5 py-3 text-left'
                    onClick={() => setEditingProvider(option)}
                  >
                    <span className='m-logo'>
                      <Icon name='spark' />
                    </span>
                    <div className='m-grow'>
                      <div className='m-t1'>{option.label}</div>
                      <div className='m-t2'>
                        {t('{mode} · {source}', {
                          mode: promptModeLabel(entry.promptMode || 'passthrough', t),
                          source: promptSourceLabel(entry.promptSource, t),
                        })}
                        {typeof entry.promptLines === 'number' && entry.promptLines > 0
                          ? t(' · {lines} 行', { lines: entry.promptLines })
                          : ''}
                      </div>
                    </div>
                    <span className='m-chev'>
                      <Icon name='chev' />
                    </span>
                  </Button>
                ))
              ) : (
                <Empty text={t('还没有单独配置的提供商，全部沿用全局设置。')} />
              )}
            </Card>
            <Card className='m-card m-card-pad' style={{ fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.7 }}>
              {t('覆盖用于「某一家要另说一套」的场景；点进去可以改成跟随默认（等于删掉这家的覆盖）。')}
            </Card>
          </div>

          {/* ③ 网关自带提示词 */}
          <div className='m-section'>
            <SectionHead title={t('网关自带提示词')} />
            <Card className='m-card'>
              {gatewayRows.length ? (
                gatewayRows.map(option => {
                  const on = gatewayEnabled(settings, option.id)
                  const { edited } = gatewayBlocksOf(settings, option)
                  return (
                    <div key={option.id} className='m-row' style={{ alignItems: 'flex-start' }}>
                      <span className='m-logo'>
                        <Icon name='shield' />
                      </span>
                      <div className='m-grow'>
                        <div className='m-t1'>
                          {option.label}
                          {edited ? <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--m-primary)' }}>{t('已改')}</span> : null}
                        </div>
                        <div className='m-t2'>
                          {option.gatewayNote || t('转发时由网关装配这段提示词')}
                          {typeof option.gatewayChars === 'number' && option.gatewayChars > 0
                            ? t('（{chars} 字）', { chars: option.gatewayChars })
                            : ''}
                        </div>
                        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                          <Button size='sm' variant='outline' type='button' onClick={() => setEditingGateway(option)}>
                            {t('编辑三段')}
                          </Button>
                        </div>
                      </div>
                      <Switch
                        checked={on}
                        aria-label={t('装配 {name} 的网关提示词', { name: option.label })}
                        onCheckedChange={value => void run('gateway', { promptGateway: { [option.id]: value === true } }, value === true ? t('已开启装配') : t('已关闭装配'))}
                      />
                    </div>
                  )
                })
              ) : (
                <Empty text={t('当前网关没有自带提示词装配（装上有装配的插件后会出现）。')} />
              )}
            </Card>
          </div>
        </>
      ) : null}

      {/* 添加覆盖 */}
      {adding ? (
        <ProviderPickerSheet
          options={addableOptions}
          onClose={() => setAdding(false)}
          onPick={option => {
            setAdding(false)
            setEditingProvider(option)
          }}
        />
      ) : null}

      {/* 编辑某一家的覆盖 */}
      {editingProvider ? (
        <ProviderPromptSheet
          option={editingProvider}
          entry={configured[editingProvider.id] || { promptMode: settings?.promptMode || 'passthrough' }}
          onClose={() => setEditingProvider(null)}
          onSaved={next => {
            setSettings(next)
            setMode(next.promptMode || 'passthrough')
            setText(next.promptText || '')
          }}
          onError={setError}
        />
      ) : null}

      {/* 编辑网关三段 */}
      {editingGateway ? (
        <GatewayTextSheet
          option={editingGateway}
          blocks={gatewayBlocksOf(settings || {}, editingGateway).text}
          onClose={() => setEditingGateway(null)}
          onSaved={setSettings}
          onError={setError}
        />
      ) : null}
    </div>
  )
}

/** 选一家未配置的提供商 */
function ProviderPickerSheet({
  options,
  onClose,
  onPick,
}: {
  options: PromptProviderOption[]
  onClose: () => void
  onPick: (option: PromptProviderOption) => void
}) {
  const [query, setQuery] = useState('')
  const filtered = options.filter(option =>
    (option.label || option.id).toLowerCase().includes(query.trim().toLowerCase()),
  )
  return (
    <Sheet open onOpenChange={open => { if (!open) onClose() }}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{t('添加分提供商覆盖')}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          <Input placeholder={t('搜索提供商')} value={query} onChange={event => setQuery(event.currentTarget.value)} />
          <div className='m-rows' style={{ marginTop: 10 }}>
            {filtered.length ? (
              filtered.map(option => (
                <Button
                  key={option.id}
                  size='default'
                  variant='ghost'
                  type='button'
                  className='m-row h-auto min-h-[46px] w-full justify-start rounded-none border-0 px-3 py-2.5 text-left'
                  onClick={() => onPick(option)}
                >
                  <div className='m-grow'>
                    <div className='m-t1'>{option.label}</div>
                    <div className='m-t2 m-mono' style={{ fontSize: 11 }}>{option.id}</div>
                  </div>
                  <span className='m-chev'>
                    <Icon name='chev' />
                  </span>
                </Button>
              ))
            ) : (
              <Empty text={t('没有可添加的提供商。')} />
            )}
          </div>
        </SheetBody>
        <SheetFooter>
          <Button variant='outline' onClick={onClose}>{t('取消')}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

/** 编辑某一家的模式与正文；「跟随默认」= 发 null 删掉这家 */
function ProviderPromptSheet({
  option,
  entry,
  onClose,
  onSaved,
  onError,
}: {
  option: PromptProviderOption
  entry: PromptProviderEntry
  onClose: () => void
  onSaved: (next: PromptSettings) => void
  onError: (message: string) => void
}) {
  const [mode, setMode] = useState<PromptMode>(entry.promptMode || 'passthrough')
  const [text, setText] = useState(entry.promptText || '')
  const [busy, setBusy] = useState(false)

  const submit = async (body: Parameters<typeof putPrompt>[0], done: string) => {
    if (busy) return
    setBusy(true)
    try {
      const next = await putPrompt(body)
      onSaved(next)
      store.toast(done)
      onClose()
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
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
          <SheetTitle>{t('{name} 的提示词', { name: option.label })}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <Label>{t('模式')}</Label>
              <SegmentedControl
                options={(['passthrough', 'custom', 'append'] as PromptMode[]).map(value => ({
                  value,
                  label: promptModeLabel(value, t),
                }))}
                value={mode}
                aria-label={t('模式')}
                onValueChange={value => setMode(value as PromptMode)}
              />
            </div>
            <div>
              <Label htmlFor='provider-prompt-text'>{t('提示词正文')}</Label>
              <Textarea
                id='provider-prompt-text'
                rows={9}
                className='m-mono'
                placeholder={t('留空表示这家不注入正文')}
                value={text}
                onChange={event => setText(event.currentTarget.value)}
              />
            </div>
            <p style={{ fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.6 }}>
              {t('保存后只影响 {name} 这一家；其它提供商仍走全局设置。', { name: option.label })}
            </p>
          </div>
        </SheetBody>
        <SheetFooter>
          <Button variant='outline' disabled={busy} onClick={onClose}>{t('取消')}</Button>
          <Button
            variant='outline'
            disabled={busy}
            onClick={() => void submit({ promptProviders: { [option.id]: null } }, t('已改为跟随默认'))}
          >
            {t('跟随默认')}
          </Button>
          <Button
            disabled={busy}
            onClick={() => void submit(
              { promptProviders: { [option.id]: { promptMode: mode, promptText: text } } },
              t('已保存，下一个请求生效'),
            )}
          >
            {busy ? t('保存中…') : t('保存')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

/** 编辑网关自带提示词的三段；「恢复官方原文」= 发 null */
function GatewayTextSheet({
  option,
  blocks,
  onClose,
  onSaved,
  onError,
}: {
  option: PromptProviderOption
  blocks: GatewayBlocks
  onClose: () => void
  onSaved: (next: PromptSettings) => void
  onError: (message: string) => void
}) {
  const [draft, setDraft] = useState<Record<GatewaySegment, string>>({
    identity: blocks.identity || '',
    stable: blocks.stable || '',
    dynamic: blocks.dynamic || '',
  })
  const [busy, setBusy] = useState(false)

  const submit = async (body: Parameters<typeof putPrompt>[0], done: string) => {
    if (busy) return
    setBusy(true)
    try {
      const next = await putPrompt(body)
      onSaved(next)
      store.toast(done)
      onClose()
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
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
          <SheetTitle>{t('网关自带提示词 · {name}', { name: option.label })}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.7 }}>
              {t('三段必须各自成块（上游按结构校验）。动态段支持占位符，发请求时才换真值：')}
              <span className='m-mono'> {GATEWAY_PLACEHOLDERS.join(' ')}</span>
            </p>
            {GATEWAY_SEGMENTS.map(segment => (
              <div key={segment}>
                <Label htmlFor={`gateway-${segment}`}>
                  {segment === 'identity' ? t('身份句') : segment === 'stable' ? t('稳定段') : t('动态段')}
                </Label>
                <Textarea
                  id={`gateway-${segment}`}
                  rows={segment === 'dynamic' ? 5 : 4}
                  className='m-mono'
                  value={draft[segment]}
                  onChange={event => setDraft({ ...draft, [segment]: event.currentTarget.value })}
                />
              </div>
            ))}
          </div>
        </SheetBody>
        <SheetFooter>
          <Button variant='outline' disabled={busy} onClick={onClose}>{t('取消')}</Button>
          <Button
            variant='outline'
            disabled={busy}
            onClick={() => void submit({ promptGatewayText: { [option.id]: null } }, t('已恢复官方原文'))}
          >
            {t('恢复官方原文')}
          </Button>
          <Button
            disabled={busy}
            onClick={() => void submit(
              { promptGatewayText: { [option.id]: { ...draft } } },
              t('已保存，下一个请求生效'),
            )}
          >
            {busy ? t('保存中…') : t('保存')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
