import { useState } from 'react'
import {
  Badge, Button, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTitle,
} from '@ui'
import { Empty, ErrorNote } from '../components/ui'
import { store } from '../state/store'
import { t } from '../i18n'
import { POSITIVE_REASONING_LEVELS } from '../../../ui-shared/models-reasoning'
import {
  addModelMapping, removeModelMapping,
  type ManageMapping, type ManageModel, type ManageView,
} from '../api/gateway'

/**
 * 映射管理（桌面端「模型映射」那一块的手机版）。
 *
 * ── 映射是什么 ────────────────────────────────────────────────
 * 一条映射 = 「对外名 → 上游模型」：客户端（或别的软件）请求 `alias` 时，
 * 网关把它换成这家上游认识的那个 ID 发出去。三种形态在这里都能看到：
 *   · `alias === target` = **原始 ID 的默认映射**（`isDefault`），删不掉也不必删；
 *   · `alias !== target` = 额外加的别名（比如给同一个上游模型挂一个带前缀的对外名）；
 *   · `dangling` = 目标上游已不在清单里，这条挂在空中（桌面端会提示清理）。
 *
 * ── 提交契约（`api/model_manage.rs::add_mapping`）─────────────
 * `POST /api/models/mappings { alias, target, provider?, reasoning? }`：
 * `target` 必填；`reasoning` 传档位字符串 = 固定思考档位，空 = 不注入。
 *
 * 关闭某条映射走「删掉这一条」或关掉该模型行的启用开关 —— 映射自身没有独立
 * 的开关接口（桌面端改的是模型行状态）。
 */
export function ModelMappingSheet({
  model,
  mappings,
  onClose,
  onSaved,
}: {
  model: ManageModel
  mappings: ManageMapping[]
  onClose: () => void
  onSaved: (view: ManageView) => void
}) {
  const provider = String(model.provider || '')
  const id = String(model.id || '')
  const [alias, setAlias] = useState('')
  const [target, setTarget] = useState(id)
  const [reasoning, setReasoning] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  /** 挂在这个模型行上的映射：同一家 + 目标就是它（或别名就是它） */
  const rows = mappings.filter(item => {
    const sameProvider = !item.provider || item.provider === provider
    return sameProvider && (item.target === id || item.alias === id)
  })

  const add = async () => {
    if (busy) return
    const name = alias.trim()
    const upstream = target.trim()
    if (!name) {
      setError(t('请填写对外名（客户端请求时用的名字）'))
      return
    }
    if (!upstream) {
      setError(t('请填写上游模型 ID'))
      return
    }
    setBusy('add')
    setError('')
    try {
      const view = await addModelMapping({
        alias: name,
        target: upstream,
        provider: provider || undefined,
        reasoning: reasoning ? reasoning : null,
      })
      onSaved(view)
      store.toast(t('映射已添加'))
      setAlias('')
      setReasoning('')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy('')
    }
  }

  const remove = async (item: ManageMapping) => {
    const name = String(item.alias || '')
    const upstream = String(item.target || '')
    if (!name || !upstream) return
    setBusy(`del:${name}`)
    setError('')
    try {
      const view = await removeModelMapping({
        alias: name,
        target: upstream,
        provider: item.provider || provider || undefined,
      })
      onSaved(view)
      store.toast(t('映射已删除'))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy('')
    }
  }

  return (
    <Sheet open onOpenChange={open => { if (!open) onClose() }}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{t('映射 · {id}', { id })}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          <p className='m-ck-note'>
            {t('对外名是客户端请求时用的名字；上游模型 ID 是这家上游认识的那个 ID。两者相同就是原始 ID 的默认映射。')}
          </p>
          {error ? <ErrorNote text={error} /> : null}

          <div className='flex flex-col gap-2'>
            <Label>{t('这个模型的映射（{n} 条）', { n: String(rows.length) })}</Label>
            {rows.length ? rows.map(item => (
              <div key={`${item.provider || ''}:${item.alias}:${item.target}`} className='flex items-center justify-between gap-2 border-t border-hairline pt-2.5'>
                <div className='min-w-0'>
                  <div className='truncate text-[12.5px] font-medium'>{String(item.alias || '')}</div>
                  <div className='truncate text-[10.5px] text-subtle'>
                    {item.alias === item.target ? t('默认映射（原始 ID）') : t('→ {target}', { target: String(item.target || '') })}
                  </div>
                  <div className='mt-1 flex flex-wrap gap-1.5'>
                    {item.isDefault ? <Badge variant='secondary' shape='tag' className='m-pill'>{t('默认')}</Badge> : null}
                    {item.enabled === false ? <Badge variant='secondary' shape='tag' className='m-pill' style={{ color: 'var(--m-warn)' }}>{t('已停用')}</Badge> : null}
                    {item.dangling ? <Badge variant='secondary' shape='tag' className='m-pill' style={{ color: 'var(--m-warn)' }}>{t('未挂载')}</Badge> : null}
                  </div>
                </div>
                {item.isDefault ? null : (
                  <Button
                    variant='ghost'
                    size='sm'
                    type='button'
                    disabled={Boolean(busy)}
                    onClick={() => void remove(item)}
                  >
                    {t('删除')}
                  </Button>
                )}
              </div>
            )) : <Empty text={t('这个模型还没有额外别名')} />}
          </div>

          <div className='flex flex-col gap-2 border-t border-hairline pt-3'>
            <Label htmlFor='map-alias'>{t('新增一条映射')}</Label>
            <Input
              id='map-alias'
              value={alias}
              disabled={Boolean(busy)}
              placeholder={t('对外名，例如 {name}', { name: `${provider || 'x'}/${id}` })}
              onChange={event => setAlias(event.target.value)}
            />
            <Input
              value={target}
              disabled={Boolean(busy)}
              placeholder={t('上游模型 ID，例如 {id}', { id })}
              onChange={event => setTarget(event.target.value)}
            />
            <div className='flex items-center justify-between gap-2'>
              <span className='text-[11px] text-subtle'>{t('思考档位（可选，固定注入给上游）')}</span>
              <Select value={reasoning || 'none'} onValueChange={value => setReasoning(!value || value === 'none' ? '' : value)}>
                <SelectTrigger className='w-[9.5rem]'><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value='none'>{t('不注入')}</SelectItem>
                  {POSITIVE_REASONING_LEVELS.map(level => (
                    <SelectItem key={level} value={level}>{level}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className='text-[10.5px] text-subtle'>
              {t('同一个对外名不能既指向这个模型又指向别处；要换目标就先删掉旧的那条。')}
            </p>
          </div>
        </SheetBody>
        <SheetFooter>
          <Button variant='ghost' type='button' disabled={Boolean(busy)} onClick={onClose}>{t('关闭')}</Button>
          <Button type='button' disabled={Boolean(busy)} onClick={() => void add()}>
            {busy === 'add' ? t('添加中…') : t('添加映射')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
