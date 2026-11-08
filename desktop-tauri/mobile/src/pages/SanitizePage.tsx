import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  Input,
  Label,
  MultiSelect,
  SegmentedControl,
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  Switch,
  Textarea,
  confirmDialog,
} from '@ui'
import { PageHead, SectionHead, ErrorNote, Empty, Badge } from '../components/ui'
import { Icon } from '../components/Icon'
import { usePullToRefresh, PullIndicator } from '../components/PullToRefresh'
import { serverIdentity } from '../lib/servers'
import { store } from '../state/store'
import { t } from '../i18n'
import {
  SANITIZE_LIMITS,
  blankRule,
  fetchSanitize,
  putSanitize,
  roleLabel,
  validateRule,
  type SanitizeRole,
  type SanitizeRule,
  type SanitizeSettings,
} from '../api/sanitize'

/**
 * 出站指纹脱敏。
 *
 * 网关在**发出**请求前改写副本：按词表把模板句 / 表头替换掉，用来绕过上游的
 * 审核黑名单指纹。只改发给上游的副本，库里的会话与下游正文不受影响。
 *
 * 三个设置的语义差别很大，界面上必须说清：
 *  · **开关**：整个功能的总闸；
 *  · **应用提供商**：留空 = 全部（含以后新增的插件与自定义家）；
 *  · **词表**：整表替换 —— 改一条也要把完整数组发回去；可以「恢复默认词表」。
 *
 * ⚠️ 保存时**不要**顺手带上没改的键：`sanitizeFingerprintProviders` 传 `null`
 * 会被归一成空数组，而空数组 = 全部提供商，且会落盘（≠「不改」）。
 */
export function SanitizePage() {
  const identity = serverIdentity()
  const [settings, setSettings] = useState<SanitizeSettings | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [loading, setLoading] = useState(true)

  // 本地草稿：应用提供商（空数组 = 全部）
  const [providers, setProviders] = useState<string[]>([])
  // 词表编辑
  const [editing, setEditing] = useState<SanitizeRule | null>(null)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    try {
      const next = await fetchSanitize()
      if (serverIdentity() !== identity) return
      setSettings(next)
      setProviders(next.sanitizeFingerprintProviders || [])
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

  const rules = useMemo(() => settings?.sanitizeFingerprintRules || [], [settings])
  const providerOptions = useMemo(
    () => (settings?.providerOptions || []).map(option => ({
      value: option.id,
      label: option.count ? `${option.label}（${option.count}）` : option.label,
    })),
    [settings],
  )
  const roleOptions = settings?.roleOptions || (['system', 'developer', 'user', 'assistant', 'tool', 'function'] as SanitizeRole[])
  const limits = settings?.limits || SANITIZE_LIMITS
  const scopeAll = providers.length === 0

  const run = async (section: string, body: Parameters<typeof putSanitize>[0], done: string) => {
    if (busy) return
    setBusy(section)
    setError('')
    try {
      const next = await putSanitize(body)
      if (serverIdentity() !== identity) return
      setSettings(next)
      setProviders(next.sanitizeFingerprintProviders || [])
      store.toast(done)
    } catch (cause) {
      if (serverIdentity() === identity) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (serverIdentity() === identity) setBusy('')
    }
  }

  /** 保存应用提供商：全部 → 显式发空数组（语义就是「全部」） */
  const saveProviders = async (next: string[]) => {
    setProviders(next)
    await run('providers', { sanitizeFingerprintProviders: next }, next.length ? t('已限定应用范围') : t('已改为应用到全部提供商'))
  }

  /** 词表统一入口：整表替换 */
  const saveRules = async (next: SanitizeRule[], done: string) => {
    await run('rules', { sanitizeFingerprintRules: next }, done)
  }

  const upsertRule = (rule: SanitizeRule) => {
    const others = rules.filter(item => item.id !== rule.id)
    const invalid = validateRule(rule, others, limits, t)
    if (invalid) {
      setError(invalid)
      return
    }
    const exists = rules.some(item => item.id === rule.id)
    const next = exists ? rules.map(item => (item.id === rule.id ? rule : item)) : [...rules, rule]
    setEditing(null)
    setCreating(false)
    void saveRules(next, exists ? t('已更新规则') : t('已新增规则'))
  }

  const removeRule = async (rule: SanitizeRule) => {
    const ok = await confirmDialog(
      t('删除规则「{name}」？词表是整表替换，删除会立刻写回网关。', { name: rule.name || rule.id }),
      { title: t('删除脱敏规则'), confirmText: t('删除'), destructive: true },
    )
    if (!ok) return
    void saveRules(rules.filter(item => item.id !== rule.id), t('已删除规则'))
  }

  const enabled = settings?.sanitizeBlacklistFingerprints !== false

  return (
    <div className='m-page' ref={pull.bindRef}>
      <PullIndicator pull={pull.pull} refreshing={pull.refreshing} />
      <PageHead title={t('指纹脱敏')} subtitle={t('开关 · 应用范围 · 脱敏词表')} />

      <div className='m-section' style={{ marginTop: 0 }}>
        {error ? <ErrorNote text={error} /> : null}
        {loading ? (
          <Card className='m-card'>
            <Empty text={t('正在读取脱敏设置…')} />
          </Card>
        ) : null}
      </div>

      {settings ? (
        <>
          <div className='m-section'>
            <SectionHead title={t('总开关')} />
            <Card className='m-card'>
              <div className='m-row'>
                <span className='m-logo'>
                  <Icon name='shield' />
                </span>
                <div className='m-grow'>
                  <div className='m-t1'>{t('剥离上游审核黑名单指纹')}</div>
                  <div className='m-t2'>{t('改写出站请求体里的模板句与表头，只影响发给上游的副本')}</div>
                </div>
                <Switch
                  checked={enabled}
                  aria-label={t('剥离上游审核黑名单指纹')}
                  onCheckedChange={value => void run('switch', { sanitizeBlacklistFingerprints: value === true }, value === true ? t('已开启指纹脱敏') : t('已关闭指纹脱敏'))}
                />
              </div>
            </Card>
          </div>

          <div className='m-section'>
            <SectionHead
              title={t('应用提供商')}
              action={busy === 'providers' ? { label: t('保存中…'), onClick: () => undefined } : undefined}
            />
            <Card className='m-card m-card-pad'>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <SegmentedControl
                  options={[
                    { value: 'all', label: t('全部提供商') },
                    { value: 'pick', label: t('仅指定的') },
                  ]}
                  value={scopeAll ? 'all' : 'pick'}
                  aria-label={t('应用提供商')}
                  onValueChange={value => {
                    if (value === 'all') void saveProviders([])
                    else void saveProviders(providers.length ? providers : providerOptions.slice(0, 1).map(item => item.value))
                  }}
                />
                {!scopeAll ? (
                  <MultiSelect
                    value={providers}
                    onValueChange={next => void saveProviders(next)}
                    options={providerOptions}
                    placeholder={t('选择提供商')}
                    searchPlaceholder={t('搜索提供商')}
                    aria-label={t('应用提供商')}
                  />
                ) : null}
                <p style={{ fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.7 }}>
                  {scopeAll
                    ? t('当前应用到全部提供商，包括以后新增的插件与自定义家。')
                    : t('当前只应用到已选的 {count} 家。', { count: providers.length })}
                </p>
              </div>
            </Card>
          </div>

          <div className='m-section'>
            <SectionHead
              title={t('脱敏词表')}
              action={{ label: t('新增规则'), onClick: () => { setError(''); setCreating(true) } }}
            />
            <Card className='m-card'>
              {rules.length ? (
                rules.map(rule => (
                  <div key={rule.id} className='m-row'>
                    <span className='m-logo'>
                      <Icon name={rule.matchType === 'regex' ? 'filter' : 'edit'} />
                    </span>
                    <div className='m-grow'>
                      <div className='m-t1' style={{ opacity: rule.enabled === false ? 0.55 : 1 }}>
                        {rule.name || rule.id}
                        {rule.matchType === 'regex' ? (
                          <span style={{ marginLeft: 6, fontSize: 10.5, color: 'var(--m-text-3)' }}>正则</span>
                        ) : null}
                        {rule.repeat ? (
                          <span style={{ marginLeft: 6, fontSize: 10.5, color: 'var(--m-text-3)' }}>重复清理</span>
                        ) : null}
                      </div>
                      <div className='m-t2 m-mono' style={{ fontSize: 11, wordBreak: 'break-all' }}>
                        {rule.pattern.length > 48 ? `${rule.pattern.slice(0, 48)}…` : rule.pattern}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flex: 'none' }}>
                      <Button size='sm' variant='outline' type='button' onClick={() => { setError(''); setEditing(rule) }}>
                        {t('编辑')}
                      </Button>
                      <Button size='sm' variant='ghost' type='button' aria-label={t('删除规则')} onClick={() => void removeRule(rule)}>
                        <Icon name='trash' />
                      </Button>
                    </div>
                  </div>
                ))
              ) : (
                <Empty text={t('当前词表为空，不会替换任何内容。')} />
              )}
            </Card>
            <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <Badge tone={settings.customRules ? 'brand' : 'mute'}>
                {settings.customRules ? t('自定义词表') : t('内置词表')}
              </Badge>
              <span className='m-mono' style={{ fontSize: 11.5, color: 'var(--m-text-3)' }}>
                {t('{count} / {max} 条', { count: rules.length, max: limits.maxRules ?? SANITIZE_LIMITS.maxRules })}
              </span>
              <Button
                size='sm'
                variant='outline'
                type='button'
                disabled={Boolean(busy) || !settings.customRules}
                onClick={() => void run('rules', { sanitizeFingerprintRules: null }, t('已恢复默认词表'))}
              >
                {t('恢复默认词表')}
              </Button>
            </div>
            <Card className='m-card m-card-pad' style={{ fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.7, marginTop: 10 }}>
              {t('词表是整表替换：改动一条会把整份词表一起写回。内置词表有 {count} 条，恢复默认会丢掉所有自定义规则。', {
                count: (settings.defaultRules || []).length,
              })}
            </Card>
          </div>
        </>
      ) : null}

      {creating ? (
        <RuleSheet
          rule={blankRule()}
          isNew
          roleOptions={roleOptions}
          limits={limits}
          onClose={() => setCreating(false)}
          onSubmit={upsertRule}
        />
      ) : null}
      {editing ? (
        <RuleSheet
          rule={editing}
          roleOptions={roleOptions}
          limits={limits}
          onClose={() => setEditing(null)}
          onSubmit={upsertRule}
        />
      ) : null}
    </div>
  )
}

/** 规则编辑器（新增 / 编辑共用） */
function RuleSheet({
  rule,
  isNew,
  roleOptions,
  limits,
  onClose,
  onSubmit,
}: {
  rule: SanitizeRule
  isNew?: boolean
  roleOptions: SanitizeRole[]
  limits: { maxRules?: number; maxNameChars?: number; maxPatternChars?: number; maxReplacementChars?: number }
  onClose: () => void
  onSubmit: (rule: SanitizeRule) => void
}) {
  const [draft, setDraft] = useState<SanitizeRule>({
    enabled: true,
    matchType: 'literal',
    replacement: '',
    repeat: false,
    roles: [],
    ...rule,
  })

  const repeatAllowed = draft.matchType === 'regex' && (draft.replacement || '') === ''
  const maxName = limits.maxNameChars ?? SANITIZE_LIMITS.maxNameChars
  const maxPattern = limits.maxPatternChars ?? SANITIZE_LIMITS.maxPatternChars
  const maxReplacement = limits.maxReplacementChars ?? SANITIZE_LIMITS.maxReplacementChars

  return (
    <Sheet open onOpenChange={open => { if (!open) onClose() }}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{isNew ? t('新增脱敏规则') : t('编辑脱敏规则')}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className='m-row' style={{ borderBottom: 0, padding: '0 0 4px' }}>
              <div className='m-grow'>
                <div className='m-t1'>{t('启用规则')}</div>
                <div className='m-t2'>{t('关掉后规则保留在词表里，但不参与替换')}</div>
              </div>
              <Switch
                checked={draft.enabled !== false}
                aria-label={t('启用规则')}
                onCheckedChange={value => setDraft({ ...draft, enabled: value === true })}
              />
            </div>

            <div>
              <Label htmlFor='rule-name'>{t('规则名称')}</Label>
              <Input
                id='rule-name'
                value={draft.name}
                maxLength={maxName}
                placeholder={t('给人看的名字')}
                onChange={event => setDraft({ ...draft, name: event.currentTarget.value })}
              />
            </div>

            <div>
              <Label htmlFor='rule-id'>{t('规则 ID')}</Label>
              <Input
                id='rule-id'
                className='m-mono'
                value={draft.id}
                maxLength={64}
                disabled={!isNew}
                onChange={event => setDraft({ ...draft, id: event.currentTarget.value })}
              />
              <p style={{ fontSize: 11.5, color: 'var(--m-text-3)', marginTop: 4 }}>
                {t('字母、数字、下划线与连字符，词表内唯一；编辑时不可改。')}
              </p>
            </div>

            <div>
              <Label>{t('匹配方式')}</Label>
              <SegmentedControl
                options={[
                  { value: 'literal', label: t('字面量') },
                  { value: 'regex', label: t('正则') },
                ]}
                value={draft.matchType || 'literal'}
                aria-label={t('匹配方式')}
                onValueChange={value => setDraft({
                  ...draft,
                  matchType: value as SanitizeRule['matchType'],
                  repeat: value === 'regex' ? draft.repeat : false,
                })}
              />
            </div>

            <div>
              <Label htmlFor='rule-pattern'>{t('匹配内容')}</Label>
              <Textarea
                id='rule-pattern'
                rows={3}
                className='m-mono'
                value={draft.pattern}
                maxLength={maxPattern}
                onChange={event => setDraft({ ...draft, pattern: event.currentTarget.value })}
              />
            </div>

            <div>
              <Label htmlFor='rule-replacement'>{t('替换内容')}</Label>
              <Textarea
                id='rule-replacement'
                rows={2}
                className='m-mono'
                placeholder={t('留空 = 删除匹配到的内容')}
                value={draft.replacement || ''}
                maxLength={maxReplacement}
                onChange={event => setDraft({
                  ...draft,
                  replacement: event.currentTarget.value,
                  repeat: event.currentTarget.value === '' ? draft.repeat : false,
                })}
              />
              <p style={{ fontSize: 11.5, color: 'var(--m-text-3)', marginTop: 4 }}>
                {t('替换文本不解释 $ 捕获组（正则也按字面量替换）。')}
              </p>
            </div>

            <div className='m-row' style={{ borderBottom: 0, padding: '0 0 4px' }}>
              <div className='m-grow'>
                <div className='m-t1'>{t('重复清理直到不再变化')}</div>
                <div className='m-t2'>
                  {repeatAllowed
                    ? t('只对「正则 + 删除」生效')
                    : t('需要「正则匹配」且「替换内容为空」')}
                </div>
              </div>
              <Switch
                checked={draft.repeat === true}
                disabled={!repeatAllowed}
                aria-label={t('重复清理直到不再变化')}
                onCheckedChange={value => setDraft({ ...draft, repeat: value === true })}
              />
            </div>

            <div>
              <Label htmlFor='rule-roles'>{t('消息角色')}</Label>
              <MultiSelect
                id='rule-roles'
                value={draft.roles || []}
                onValueChange={next => setDraft({ ...draft, roles: next as SanitizeRole[] })}
                options={roleOptions.map(role => ({ value: role, label: roleLabel(role, t) }))}
                placeholder={t('留空 = 全部角色')}
                searchPlaceholder={t('搜索角色')}
              />
              <p style={{ fontSize: 11.5, color: 'var(--m-text-3)', marginTop: 4 }}>
                {t('留空沿用旧规则的全字段行为；指定角色时只改对应消息的正文。')}
              </p>
            </div>
          </div>
        </SheetBody>
        <SheetFooter>
          <Button variant='outline' onClick={onClose}>{t('取消')}</Button>
          <Button onClick={() => onSubmit({ ...draft, name: draft.name.trim() })}>
            {isNew ? t('新增') : t('保存')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
