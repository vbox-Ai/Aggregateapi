/**
 * 网关自身的配置（`GET /api/config`、`POST /api/config`）。
 *
 * ── M3 调研结论：这条接口比名字窄得多 ────────────────────────
 * 它**不是**「整份原始配置」。GET 只回 5 个键：
 *   `apiKey`（脱敏）、`apiKeySet`、`locale`、`defaultModel`、`sanitizeFingerprints`
 * （最后一项与 `GET /api/sanitize` 同键同值）。逐项判过：
 *   · `sanitizeFingerprints` —— 手机端已有 `/api/sanitize`，**不需要**；
 *   · `apiKey` / `apiKeySet` —— 旧版单 Key 的兼容字段，现代路径是 `/api/keys`
 *     （手机端已有），**不需要**；
 *   · `defaultModel` —— 这里**只读**：POST 根本不接受它，**不需要**；
 *   · **`locale`** —— POST 只接受 `apiKey` 与 `locale` 两个键，而 `locale` 是
 *     **计费语言**（网关日志原文：「计费语言已更新为 …」，由 `core::billing` 消费，
 *     影响积分/计费类文案的语言）。手机端的语言开关只写 `localStorage`，
 *     **不写回网关** —— 所以英文用户在手机上看到的积分简报只能是中文。这一项要补。
 *
 * 桌面端**没有任何文件**用这条接口（走的是各自的细粒度端点），所以它只服务于
 * 旧客户端兼容与上面这 5 个键。
 */
import { apiCall } from './client'

export type GatewayConfig = {
  /** 脱敏后的 Key（永不回明文） */
  apiKey?: string
  apiKeySet?: boolean
  /** 计费语言（如 `zh-CN` / `en-US`），由插件侧的计费/积分文案使用 */
  locale?: string
  /** 网关的默认模型（这条接口**只读**它） */
  defaultModel?: string
}

export function fetchGatewayConfig(signal?: AbortSignal): Promise<GatewayConfig> {
  return apiCall<GatewayConfig>('/api/config', { signal, quiet: true })
}

/**
 * 改网关的计费语言。
 *
 * 只发 `locale`：POST 里 apiKey 那条分支会真的动 Key（`null` = 删除），
 * 我们只想改语言，别顺手把其它键带进同一个请求。
 */
export function saveGatewayLocale(locale: string): Promise<GatewayConfig> {
  return apiCall<GatewayConfig>('/api/config', { method: 'POST', body: { locale } })
}
