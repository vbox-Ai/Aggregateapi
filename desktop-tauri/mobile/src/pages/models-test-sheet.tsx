import { useState } from 'react'
import {
  Alert, AlertDescription, Button, Label, Sheet, SheetBody, SheetContent,
  SheetFooter, SheetHeader, SheetTitle, Textarea,
} from '@ui'
import { ErrorNote } from '../components/ui'
import { t } from '../i18n'
import { testModel, type ManageModel, type ModelTestResult } from '../api/gateway'

/**
 * 模型测试（桌面端 `model-test-dialog` 的手机版）。
 *
 * ── 它测的是什么 ──────────────────────────────────────────────
 * 走的是**网关自己的 Key 通道**（`POST /api/models/test`），不是面板的账号：
 * 网关先按这把 Key 的可用范围校验（模型不在范围 ⇒ 404、provider 不在范围
 * ⇒ 403），再拿真实凭证打一次上游、把回复原样回给我们。所以它能验证三件事：
 * 账号凭证还能用、上游没挂、这个模型 ID 在那一端真的存在。
 *
 * ── 字段名注意 ────────────────────────────────────────────────
 * 载荷里模型字段叫 **`model`**（不是 `id`）—— 照 `api/model_test.rs` 的
 * `text_field(&payload, "model", 128)`。
 *
 * 返回体是上游那一次对话的关键事实（内容 / 模型名 / 用量），字段不保证稳定，
 * 所以认不出来时原样把 JSON 打出来，不做美化式猜测。
 */
export function ModelTestSheet({ model, onClose }: { model: ManageModel; onClose: () => void }) {
  const provider = String(model.provider || '')
  const id = String(model.id || '')
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<ModelTestResult | null>(null)

  const run = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    setResult(null)
    try {
      const data = await testModel({ provider, model: id, ...(prompt.trim() ? { prompt: prompt.trim() } : {}) })
      setResult(data || {})
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  const content = typeof result?.content === 'string' ? result.content : ''

  return (
    <Sheet open onOpenChange={open => { if (!open) onClose() }}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{t('测试 · {id}', { id })}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          <p className='m-ck-note'>
            {t('用网关自己的 Key 打一次上游，验证凭证、连通性与模型 ID。不发提示词也可以（走默认那句）。')}
          </p>
          {error ? <ErrorNote text={error} /> : null}

          <Label htmlFor='mt-prompt'>{t('提示词（可选）')}</Label>
          <Textarea
            id='mt-prompt'
            rows={3}
            value={prompt}
            disabled={busy}
            placeholder={t('例如：只回一句「你好」，不要解释。')}
            onChange={event => setPrompt(event.target.value)}
          />

          {result ? (
            <div className='flex flex-col gap-2 border-t border-hairline pt-3'>
              <Label>{t('上游回复')}</Label>
              {content ? (
                <p className='whitespace-pre-wrap break-words text-[12.5px]'>{content}</p>
              ) : (
                <Alert>
                  <AlertDescription>{t('这次没有拿到文本内容，下面是原始返回。')}</AlertDescription>
                </Alert>
              )}
              {typeof result.model === 'string' && result.model !== id ? (
                <p className='text-[10.5px] text-subtle'>{t('上游实际使用的是 {model}', { model: result.model })}</p>
              ) : null}
              {!content ? (
                <pre className='m-mono max-h-56 overflow-auto text-[10.5px] leading-relaxed'>
                  {JSON.stringify(result, null, 2)}
                </pre>
              ) : null}
            </div>
          ) : null}
        </SheetBody>
        <SheetFooter>
          <Button variant='ghost' type='button' disabled={busy} onClick={onClose}>{t('关闭')}</Button>
          <Button type='button' disabled={busy} onClick={() => void run()}>
            {busy ? t('测试中…') : t('开始测试')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
