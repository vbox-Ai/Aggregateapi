import { useState } from 'react'
import {
  Alert, AlertDescription, Button, Input, Label, SegmentedControl,
  Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTitle,
} from '@ui'
import { ErrorNote } from '../components/ui'
import { store } from '../state/store'
import { t } from '../i18n'
import { setModelCapabilities, type ManageModel, type ManageView } from '../api/gateway'
import {
  CAPABILITY_KEYS, MAX_TOKEN_VALUE, capSourceOf, isTokenKey, normalizeOverrides,
  type CapabilityKey,
} from '../../../ui-shared/model-capability'

/**
 * 能力位编辑（桌面端 `model-capability-dialog` 的手机版）。
 *
 * ── 六个键、三态、两个来源 ────────────────────────────────────
 * 两个数值键（上下文窗口 / 最大输出 Token）+ 四个布尔键（工具调用 / 图片 /
 * 视频 / 思考）。**三态必须分开**：「支持」「明确不支持」「未声明」是三件
 * 不同的事 —— 混成一个"关"之后，用户会把"不知道"当成"不支持"照着抄。
 *
 * 值的来源也要标出来（桌面端用虚线下划线 + 右上角小点表达）：
 *   · 继承上游 / 未声明 —— 上游清单里给的原值（或干脆没有这个键）；
 *   · 由 models.dev 补齐 —— 社区目录补的，不是这家上游说的；
 *   · 已手动覆盖 —— 用户改过，`capOverrides` 里有这个键。
 *
 * ── 提交是全量 ────────────────────────────────────────────────
 * 六个键一次全给（`POST /api/models/capabilities`）：用户在弹窗里看到什么，
 * 保存后就是什么。数值键留空、布尔键选「未声明」= 传 `null` = 恢复未声明。
 *
 * 自定义提供商的家走不了这条路 —— 那家的模型清单是**整表保存**的，能力位
 * 也在那张表里（桌面端 `models-custom-source.ts` 的 `setCapabilities`），
 * 所以这里只对内建家开放，并在界面上说明。
 */

function labelOf(key: CapabilityKey): string {
  if (key === 'maxInputTokens') return t('上下文窗口')
  if (key === 'maxOutputTokens') return t('最大输出 Token')
  if (key === 'supportsToolCall') return t('工具调用')
  if (key === 'supportsImages') return t('图片识别')
  if (key === 'supportsVideo') return t('视频识别')
  return t('支持思考')
}

function hintOf(key: CapabilityKey): string {
  if (key === 'maxInputTokens') return t('对下游声明的上下文窗口；留空 = 未声明')
  if (key === 'maxOutputTokens') return t('单次回复的输出上限；留空 = 未声明')
  return t('「未声明」不等于不支持：下游会按不支持处理，但清单里确实没这个键')
}

function statusOf(model: ManageModel, key: CapabilityKey): string {
  const caps = (model.capabilities && typeof model.capabilities === 'object' ? model.capabilities : {}) as Record<string, unknown>
  if (normalizeOverrides(model.capOverrides).includes(key)) return t('已手动覆盖')
  const source = capSourceOf(model, key)
  if (source === 'modelsdev') return t('由 models.dev 补齐（不是这家上游声明的）')
  if (source === 'user') return t('手动设定')
  const value = caps[key]
  if (value === null || value === undefined) return t('上游未声明')
  return t('继承上游声明')
}

type Draft = Record<CapabilityKey, string>

function draftOf(model: ManageModel): Draft {
  const caps = (model.capabilities && typeof model.capabilities === 'object' ? model.capabilities : {}) as Record<string, unknown>
  const draft = {} as Draft
  for (const key of CAPABILITY_KEYS) {
    const value = caps[key]
    if (isTokenKey(key)) {
      draft[key] = typeof value === 'number' && value > 0 ? String(value) : ''
    } else {
      draft[key] = value === true ? 'on' : value === false ? 'off' : 'inherit'
    }
  }
  return draft
}

/** 草稿 → 提交体：空串 / 非法值 / `inherit` 一律给 `null`（= 恢复未声明） */
function patchOf(draft: Draft): Record<string, number | boolean | null> {
  const patch: Record<string, number | boolean | null> = {}
  for (const key of CAPABILITY_KEYS) {
    const raw = (draft[key] || '').trim()
    if (isTokenKey(key)) {
      const number = Number(raw)
      const valid = raw !== '' && Number.isFinite(number) && number >= 1 && number <= MAX_TOKEN_VALUE
      patch[key] = valid ? Math.trunc(number) : null
    } else {
      patch[key] = raw === 'on' ? true : raw === 'off' ? false : null
    }
  }
  return patch
}

export function ModelCapabilitySheet({
  model,
  onClose,
  onSaved,
}: {
  model: ManageModel
  onClose: () => void
  onSaved: (view: ManageView) => void
}) {
  const provider = String(model.provider || '')
  const id = String(model.id || '')
  const custom = provider.startsWith('custom-')
  const [draft, setDraft] = useState<Draft>(() => draftOf(model))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const set = (key: CapabilityKey, value: string) => {
    setDraft(current => ({ ...current, [key]: value }))
  }

  const save = async () => {
    if (busy || custom) return
    setBusy(true)
    setError('')
    try {
      const view = await setModelCapabilities({ provider, id, capabilities: patchOf(draft) })
      onSaved(view)
      store.toast(t('能力位已保存'))
      onClose()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open onOpenChange={open => { if (!open) onClose() }}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{t('能力位 · {id}', { id })}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          <p className='m-ck-note'>{t('改的是这个模型对下游声明的能力。保存后立即生效，映射与账号不用改。')}</p>
          {custom ? (
            <Alert>
              <AlertDescription>
                {t('自定义提供商的能力位在「自定义提供商」页整表保存，这里改不了 —— 请在那边编辑这家提供商的模型清单。')}
              </AlertDescription>
            </Alert>
          ) : null}
          {error ? <ErrorNote text={error} /> : null}

          {CAPABILITY_KEYS.map(key => (
            <div key={key} className='flex flex-col gap-1.5 border-t border-hairline pt-2.5'>
              <div className='flex items-center justify-between gap-2'>
                <Label htmlFor={`cap-${key}`}>{labelOf(key)}</Label>
                <span className='text-[10.5px] text-subtle'>{statusOf(model, key)}</span>
              </div>
              {isTokenKey(key) ? (
                <Input
                  id={`cap-${key}`}
                  inputMode='numeric'
                  disabled={busy || custom}
                  value={draft[key]}
                  placeholder={t('留空 = 未声明')}
                  onChange={event => set(key, event.target.value)}
                />
              ) : (
                <SegmentedControl
                  aria-label={labelOf(key)}
                  value={draft[key]}
                  onValueChange={value => set(key, value)}
                  options={[
                    { value: 'inherit', label: t('未声明') },
                    { value: 'on', label: t('支持') },
                    { value: 'off', label: t('不支持') },
                  ]}
                />
              )}
              <p className='text-[10.5px] text-subtle'>{hintOf(key)}</p>
            </div>
          ))}

          <p className='text-[10.5px] text-subtle'>
            {t('数值上限 {max}；保存时六个键一起提交，界面上是什么、网关里就是什么。', { max: String(MAX_TOKEN_VALUE) })}
          </p>
        </SheetBody>
        <SheetFooter>
          <Button variant='ghost' type='button' disabled={busy} onClick={onClose}>{t('取消')}</Button>
          <Button type='button' disabled={busy || custom} onClick={() => void save()}>
            {busy ? t('保存中…') : t('保存')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
