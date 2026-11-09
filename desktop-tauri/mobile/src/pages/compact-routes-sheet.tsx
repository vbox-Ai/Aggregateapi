import { useEffect, useMemo, useState } from 'react'
import {
  Alert, AlertDescription, Button, Card, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTitle, Switch,
} from '@ui'
import { Empty, SectionHead } from '../components/ui'
import { ApiError } from '../api/client'
import { serverIdentity } from '../lib/servers'
import { store } from '../state/store'
import {
  COMPACT_CLIENT_ZCODE, COMPACT_MAX_RULES, compactModelKey, fetchCompactRoutes, saveCompactRoutes,
  validateCompactRoutes, type CompactRoute, type CompactRoutesConfig, type CompactRoutesView,
} from '../api/compact-routes'
import { t } from '../i18n'

/**
 * 上下文压缩路由（模型页）。
 *
 * ── 它是什么 ──────────────────────────────────────────────────
 * 「客户端身份」与「上游提供商」是两个独立维度：这里把**某个客户端**（目前只有
 * ZCode）请求的某个模型，改送到另一个模型去（用于上下文压缩那类场景）。
 *
 * ── 三条上游语义，界面上要如实体现 ────────────────────────────
 *  1. **整块保存 + 修订号**：保存时把读取到的 `revision` 一起交回；别处改过就 409。
 *     那种情况下**草稿不丢**（上游原话），所以这里给「重新读取并保留改动」——
 *     既不静默覆盖别人的修改，也不用把用户填的东西扔掉重来。
 *  2. 来源/压缩模型必须是**当前可用**的模型：所以两个字段是选择器而不是输入框，
 *     选项来自上游给的清单（已滤掉图片模型）。
 *  3. **已失效的旧规则可以留**（上游 `validate_models` 的例外）——所以规则里若引用了
 *     已不在清单中的模型，选择器仍显示它并标注「已失效」，只是不允许把它**新增**或
 *     重新启用。
 */
export function CompactRoutesSheet({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [view, setView] = useState<CompactRoutesView | null>(null)
  const [config, setConfig] = useState<CompactRoutesConfig | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const [hint, setHint] = useState('')
  const identity = serverIdentity()

  const load = async (keepDraft = false) => {
    setBusy('load')
    try {
      const next = await fetchCompactRoutes()
      if (serverIdentity() !== identity) return
      setView(next)
      // 冲突后重新读取：**保留用户的草稿**，只把修订号换成最新的
      if (!keepDraft) setConfig({ enabled: next.config?.enabled === true, rules: next.config?.rules || [] })
      setConflict(false)
      setError('')
    } catch (failure) {
      if (serverIdentity() === identity) setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      if (serverIdentity() === identity) setBusy('')
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const modelOptions = useMemo(() => {
    const options = (view?.models || [])
      .map(model => ({ value: String(model.id || ''), label: String(model.label || model.name || model.id || '') }))
      .filter(item => item.value)
    const seen = new Set(options.map(item => compactModelKey(item.value)))
    // 已失效的旧规则引用的模型也要能显示出来，否则选择器会空白
    for (const rule of config?.rules || []) {
      for (const model of [rule.source, rule.target]) {
        const key = compactModelKey(model)
        if (!key || seen.has(key)) continue
        seen.add(key)
        options.push({ value: model, label: t('{model}（已失效）', { model }) })
      }
    }
    return options
  }, [view?.models, config?.rules])

  const maxRules = Number(view?.maxRules) || COMPACT_MAX_RULES
  const rules = config?.rules || []

  const patchRule = (index: number, patch: Partial<CompactRoute>) => {
    setConfig(current => current
      ? { ...current, rules: current.rules.map((rule, position) => position === index ? { ...rule, ...patch } : rule) }
      : current)
    setHint('')
  }

  const addRule = () => {
    setConfig(current => current
      ? {
        ...current,
        rules: [...current.rules, {
          client: COMPACT_CLIENT_ZCODE, source: '', target: '', enabled: true,
        }],
      }
      : current)
    setHint('')
  }

  const removeRule = (index: number) => {
    setConfig(current => current
      ? { ...current, rules: current.rules.filter((_, position) => position !== index) }
      : current)
    setHint('')
  }

  const save = async () => {
    if (busy || !config || !view) return
    const invalid = validateCompactRoutes(config)
    if (invalid) {
      setHint(invalid)
      return
    }
    setBusy('save')
    setError('')
    setHint('')
    try {
      const next = await saveCompactRoutes(config, view.revision)
      if (serverIdentity() !== identity) return
      setView(next)
      setConfig({ enabled: next.config?.enabled === true, rules: next.config?.rules || [] })
      setConflict(false)
      store.toast(t('压缩路由已保存'))
      onChanged()
    } catch (failure) {
      if (serverIdentity() !== identity) return
      // 409 = 别处改过：不覆盖、也不丢草稿，让用户自己决定
      if (failure instanceof ApiError && failure.status === 409) {
        setConflict(true)
        setError(failure.message)
      } else {
        setError(failure instanceof Error ? failure.message : String(failure))
      }
    } finally {
      if (serverIdentity() === identity) setBusy('')
    }
  }

  return (
    <Sheet open onOpenChange={(open, details) => {
      if (open) return
      if (busy) { details.cancel(); return }
      onClose()
    }}>
      <SheetContent showCloseButton={!busy}>
        <SheetHeader><SheetTitle>{t('压缩路由')}</SheetTitle></SheetHeader>
        <SheetBody>
          {!config ? (
            <div style={{ padding: 16 }}>
              <Empty text={busy === 'load' ? t('读取中…') : (error || t('读取压缩路由失败'))} />
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 8 }}>
              <p style={{ fontSize: 12.5, lineHeight: 1.7, color: 'var(--m-text-2)' }}>
                {t('把某客户端请求的模型改送到另一个模型（用于上下文压缩）。客户端身份与上游提供商是两个独立维度；目前只支持 ZCode。')}
              </p>

              <Card className='m-card m-card-pad'>
                <div className='m-ck-toolbar'>
                  <div className='m-ck-grow'>
                    <div className='m-ck-title'>{t('总开关')}</div>
                    <div className='m-ck-note'>{config.enabled ? t('按下方规则改送模型') : t('压缩路由整体关闭，规则保留')}</div>
                  </div>
                  <Switch checked={config.enabled} disabled={Boolean(busy)}
                    aria-label={t('压缩路由总开关')}
                    onCheckedChange={enabled => {
                      setConfig({ ...config, enabled })
                      setHint('')
                    }} />
                </div>
              </Card>

              <div className='m-section' style={{ marginTop: 0 }}>
                <SectionHead title={t('规则（{n}/{max}）', { n: rules.length, max: maxRules })} />
                {rules.length ? rules.map((rule, index) => (
                  <Card key={index} className='m-card m-card-pad' style={{ marginBottom: 8 }}>
                    <div className='m-ck-toolbar'>
                      <div className='m-ck-grow'>
                        <div className='m-ck-title'>{rule.source || t('未填来源模型')}</div>
                        <div className='m-ck-note'>
                          {rule.target ? t('改送到 {model}', { model: rule.target }) : t('还没选压缩模型')}
                        </div>
                      </div>
                      <Switch checked={rule.enabled} disabled={Boolean(busy)}
                        aria-label={t('启用这条规则')}
                        onCheckedChange={enabled => patchRule(index, { enabled })} />
                      <Button variant='ghost' size='sm' disabled={Boolean(busy)}
                        onClick={() => removeRule(index)}>{t('删除')}</Button>
                    </div>

                    <div style={{ marginTop: 8 }}>
                      <Label>{t('来源模型')}</Label>
                      <Select value={rule.source} onValueChange={source => patchRule(index, { source: source || '' })}>
                        <SelectTrigger className='w-full'><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {modelOptions.map(option => (
                            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div style={{ marginTop: 8 }}>
                      <Label>{t('压缩模型')}</Label>
                      <Select value={rule.target} onValueChange={target => patchRule(index, { target: target || '' })}>
                        <SelectTrigger className='w-full'><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {modelOptions.map(option => (
                            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </Card>
                )) : <Card className='m-card'><Empty text={t('还没有规则')} /></Card>}

                <Button variant='outline' size='sm' className='w-full'
                  disabled={Boolean(busy) || rules.length >= maxRules} onClick={addRule}>
                  {t('添加规则')}
                </Button>
              </div>

              {conflict ? (
                <Alert variant='destructive'>
                  <AlertDescription>
                    {t('配置已在别处修改。你的改动还在，可以重新读取最新配置后再保存。')}
                  </AlertDescription>
                </Alert>
              ) : null}
              {hint ? <p style={{ fontSize: 12, color: 'var(--m-danger)' }}>{hint}</p> : null}
              {error ? <p style={{ fontSize: 12, color: 'var(--m-danger)', whiteSpace: 'pre-wrap' }}>{error}</p> : null}
            </div>
          )}
        </SheetBody>
        <SheetFooter>
          {conflict ? (
            <Button variant='outline' className='w-full' disabled={Boolean(busy)} onClick={() => void load(true)}>
              {t('重新读取并保留我的改动')}
            </Button>
          ) : null}
          <Button variant='outline' disabled={Boolean(busy)} onClick={onClose}>{t('取消')}</Button>
          <Button disabled={Boolean(busy) || !config} onClick={() => void save()}>
            {busy === 'save' ? t('保存中…') : t('保存')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
