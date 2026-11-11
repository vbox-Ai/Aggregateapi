/**
 * 「API 模板」点选后要带给「新建自定义提供商」表单的预置值。
 *
 * ── 为什么用一个模块级变量，而不是塞进 store ──────────────────────
 * 这是一次性的**跳转载荷**：点模板 → 跳页面 → 表单挂载时取走，取完就没了。
 * 塞进 store 会多出一份需要清理的持久状态（返回、刷新、切网关时都要想着清），
 * 而这里取走即清空的语义恰好就是它需要的。
 *
 * 协议字段要做映射：预置清单（桌面 ui/preset-providers.js）用的是后端值
 * chat_completions / nthropic，而手机端表单的下拉选项是
 * openai / nthropic / gemini（见 api/custom-providers.ts 的 PROTOCOL_OPTIONS）。
 * 不映射就会把无效值塞进下拉。
 */
export type ProviderPreset = { key?: string; name: string; protocol: string; baseUrl: string }

let pending: ProviderPreset | null = null

/** 表单能识别的协议值 */
export function formProtocol(protocol: string): string {
  if (protocol === 'anthropic' || protocol === 'gemini') return protocol
  // chat_completions / responses 等都归到「OpenAI 兼容」——表单只有这三档
  return 'openai'
}

export function requestProviderPreset(preset: ProviderPreset): void {
  pending = preset
}

/** 取走待用预置（取一次即清空） */
export function takeProviderPreset(): ProviderPreset | null {
  const current = pending
  pending = null
  return current
}
