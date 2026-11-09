/**
 * 静态表单式的「添加账号」（对齐桌面端 `add-account-configs.ts` + `add-provider-blocks.tsx`）。
 *
 * ── 为什么要有这一层 ────────────────────────────────────────
 * 手机端原来只有**动态登录**一条路：`GET /api/session/login/methods`，网关对没实现
 * 动态登录的提供商回 **501**，于是界面直接拒绝（「不会猜测凭证字段」）。而桌面端
 * 根本不依赖这条路 —— 它对 **27 家**走的是 `add-account-configs.ts` 里的静态表单，
 * 字段名**直接对应 `POST /api/accounts` 的请求体**。小浣熊（raccoon）就是其中之一：
 * 手填 `token` / `refreshToken` / 备注名即可。
 *
 * 所以这里**直接复用桌面那份配置模块**（它是纯数据、无 JSX；手机端本来就有从
 * `ui-islands` 复用模块的先例，见 `add-account-dynamic-fields`）——**单一数据源**，
 * 字段名不可能两边漂移。
 *
 * ── 提交语义（逐条照桌面实现，这是最不能出错的一层）────────────
 *   · 平铺键名：`{ provider, ...每个字段的 key }`（`field.inputKey` **只影响 DOM id**，
 *     请求体里仍然是 `field.key` —— 小浣熊的 `refreshToken` 就是靠这条映射到 `refresh`）；
 *   · `jsonExpand` 字段（如 CodeArts 的整段凭据 JSON）：**前端解析后把键并进请求体**，
 *     原始那串文本不留（后端只认平铺字段，不认"一个字符串里装着 JSON"）；
 *   · 有 `regionOptions` 时 `payload.mode = 选区`；
 *   · 备注名走 `payload.name`（可选）；
 *   · 文件导入：文本 → `authFileContent`；二进制 → `authFileB64`（data URL 的 base64 体）。
 *
 * ── 手机端**做不到**的一段（界面会写明原因，不静默隐藏）───────
 * 「网页登录」在桌面端由**桌面壳的桥**驱动（`workbuddyDesktop.startLogin`），
 * 手机端没有这个桥；「读本机客户端登录态」更是桌面专有（要读本机文件 / DPAPI 密文）。
 * 这两段在手机端不渲染，但会显示一行原因，并指向可用的等价路径。
 */
import {
  ADD_METHODS,
  configOf as builtinConfigOf,
  desktopImportAvailable,
  fieldIdOf,
  maxLengthOf,
  manualNoteOf,
  manualTitleOf,
  methodsOf,
  addButtonTextOf,
  type FieldSpec,
  type ProviderConfig,
} from '../../../ui-islands/src/islands/add-account-configs'

export { fieldIdOf, maxLengthOf, manualNoteOf, manualTitleOf, addButtonTextOf, methodsOf }
export type { FieldSpec, ProviderConfig }

/**
 * WorkBuddy **不在这张静态表里** —— 桌面端配置模块的头注释写明了原因：它的块结构特殊
 * （账号版本 + 打开方式 + 第三方入口开关），单独一个组件实现。手机端原来没有它，
 * 于是加 WorkBuddy 账号只会落到「未声明动态登录方式」那句提示。
 *
 * 手机端**能做**的是桌面端同一条落库路径里的两条（契约都核过）：
 *   · **从文件导入凭证 JSON**：桌面端解析文件、校验 `accessToken` + `uid`，再
 *     `{ ...record, provider: workbuddyProviderId(edition) }` 提交（`workbuddy` /
 *     `workbuddy-intl` 由凭证里的 domain 判定，`workbuddy.ai` ⇒ 国际版）；
 *   · **网页登录**：直接复用 U9 建好的那条（oauth/start → 打开或复制地址 → 轮询 → 粘回调）。
 * **做不到**的是「读本机客户端登录态」（要读电脑上的客户端目录），界面会写明原因。
 */
const WORKBUDDY_IMPORT_NOTE = '选 WorkBuddy 官方客户端的凭证文件（JSON，含 accessToken 与 uid）。' +
  '国内版 / 国际版按文件内容自动判定；凭证保存在网关，可独立使用。'

const WORKBUDDY_AUTH_HINT = '官方客户端凭证目录：Windows 是 ' +
  'C:\\Users\\<你的用户名>\\AppData\\Local\\CodeBuddyExtension\\Data\\Public\\auth，' +
  'macOS 是 ~/Library/Application Support/CodeBuddyExtension/Data/Public/auth'

function workbuddyConfig(providerId: string): ProviderConfig | undefined {
  if (providerId !== 'workbuddy' && providerId !== 'workbuddy-intl') return undefined
  const intl = providerId === 'workbuddy-intl'
  return {
    provider: providerId,
    label: intl ? 'WorkBuddy 国际版' : 'WorkBuddy 国内版',
    addButton: intl ? '添加 WorkBuddy 国际版账号' : '添加 WorkBuddy 国内版账号',
    // 手填段：WorkBuddy 的凭证不是一个 token 能拼出来的（要 accessToken + uid，还要认版本），
    // 所以这里不给手填字段，只给「导入凭证文件」——与桌面端那条文件路径同一落库方式。
    fields: [],
    manualTitle: '导入凭证文件',
    manualNote: WORKBUDDY_AUTH_HINT,
    fileImport: { accept: '.json,application/json', note: WORKBUDDY_IMPORT_NOTE },
  }
}

/** 静态表优先，其次 WorkBuddy 这两家（桌面端把它们放在特殊块里） */
export function configOf(providerId: string): ProviderConfig | undefined {
  return builtinConfigOf(providerId) ?? workbuddyConfig(providerId)
}

/** 这一家是不是 WorkBuddy（导入文件时走"解析后按版本定 provider"的特殊路径） */
export function isWorkbuddyProvider(providerId: string): boolean {
  return providerId === 'workbuddy' || providerId === 'workbuddy-intl'
}

/**
 * 解析 WorkBuddy 凭证文件：校验 `accessToken` + `uid`，并按文件内容判定版本。
 *
 * 与桌面端同口径：版本优先看文件自己的事实（domain 命中 `workbuddy.ai` ⇒ 国际版；
 * 或记录里已经写明 `workbuddy-intl` / `intl`），推不出来就用调用方给的分段默认值。
 * 返回 `null` = 不是有效凭证（缺必需字段），由调用方报错，**不猜**。
 */
export function parseWorkbuddyCredential(
  text: string,
  fallbackProvider: string,
): { record: Record<string, unknown>; provider: string } | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const record = parsed as Record<string, unknown>
  const nested = [record.auth, record.account].filter(
    item => item && typeof item === 'object' && !Array.isArray(item),
  ) as Record<string, unknown>[]
  const pick = (key: string): unknown => {
    for (const source of [record, ...nested]) {
      const value = source[key]
      if (value !== undefined && value !== null && value !== '') return value
    }
    return undefined
  }
  if (!pick('accessToken')) return null
  if (!pick('uid')) return null

  let provider = fallbackProvider
  const declared = String(pick('provider') || pick('edition') || '').toLowerCase()
  const domain = String(pick('domain') || pick('host') || pick('baseUrl') || '').toLowerCase()
  if (declared.includes('intl') || declared.includes('international') || /workbuddy\.ai/.test(domain)) {
    provider = 'workbuddy-intl'
  } else if (declared.includes('workbuddy') || declared.includes('cn') || domain) {
    provider = 'workbuddy'
  }
  return { record, provider }
}


/** 手填字段的输入值（键 = field.key） */
export type FieldValues = Record<string, string>

/**
 * 由静态配置 + 输入值拼出 `POST /api/accounts` 的请求体。
 *
 * 与桌面 `add-provider-blocks.tsx` 的组装逐条对应；`jsonExpand` 字段解析失败时
 * **就地抛出**（与桌面一致：宁可让用户改，也不把坏数据发出去）。
 */
export function buildStaticPayload(
  config: ProviderConfig,
  values: FieldValues,
  options: { name?: string; region?: string } = {},
): Record<string, unknown> {
  const payload: Record<string, unknown> = { provider: config.provider }
  for (const field of config.fields) {
    const raw = values[field.key] ?? ''
    if (field.jsonExpand) {
      const text = raw.trim()
      if (!text) continue
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        throw new Error(`「${field.label}」不是合法的 JSON，请检查后再提交`)
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`「${field.label}」需要是一个 JSON 对象`)
      }
      Object.assign(payload, parsed as Record<string, unknown>)
      continue
    }
    if (raw === '' && field.optional) continue
    payload[field.key] = raw
  }
  if (config.regionOptions?.length && options.region) payload.mode = options.region
  const name = (options.name ?? '').trim()
  if (name) payload.name = name
  return payload
}

/** 必填字段是否都填了（用于禁用提交按钮；可选字段不拦） */
export function missingRequired(config: ProviderConfig, values: FieldValues): FieldSpec[] {
  return config.fields.filter(field => !field.optional && !(values[field.key] ?? '').trim())
}

/** 手机端能渲染的分段（以及不能渲染的原因） */
export type SectionPlan = {
  manual: boolean
  file: boolean
  sms: boolean
  oauth: boolean
  guest: boolean
  /**
   * 网页登录（官方页面登录）。**手机端能做** —— 见 `api/web-login.ts`：
   * 网关侧是一条普通 HTTP 流程，且回调地址指向 `127.0.0.1`，打开官方页的是手机自己的
   * 浏览器、回到的也是手机自己的本机网关。桌面端之所以交给壳，是因为它要开**内嵌窗口**
   * 并捕获 Cookie；手机端不需要内嵌窗口，改用"打开/复制链接 + 轮询结果"。
   */
  web: boolean
  /** 手机端**真做不到**的分段及其原因（界面会写出来，不静默隐藏） */
  blocked: { id: string; label: string; reason: string }[]
}

/**
 * 按桌面同一条 `methodsOf(config, region)` 决定露出哪些分段，再按**手机端能力**裁剪。
 *
 * 关键：**不用 `desktopImportAvailable()` 当判据** —— 它读的是桌面壳注入的 `platform()`，
 * 手机端拿不到（返回空串），于是它会认为"桌面导入可用"，从而让手机端渲染一段**做不到**的
 * 界面。所以这里按手机端的真实能力判定：桌面导入一律不可用。
 */
export function planSections(config: ProviderConfig, region: string): SectionPlan {
  const methods = methodsOf(config, region)
  const blocked: SectionPlan['blocked'] = []
  if (methods.includes('desktop')) {
    blocked.push({
      id: 'desktop',
      label: '读取本机客户端登录态',
      reason: '这一步要读电脑上客户端的登录态文件（部分家还要 Windows DPAPI 解密），手机上做不到。可以用手填凭证、导入凭证文件，或下面的网页登录。',
    })
  }
  return {
    manual: config.fields.length > 0,
    file: Boolean(config.fileImport),
    sms: methods.includes('sms'),
    oauth: methods.includes('oauth'),
    guest: methods.includes('guest'),
    web: methods.includes('web'),
    blocked,
  }
}

/** 桌面端 ADD_METHODS 的展示文案（分段标题用） */
export function methodLabel(id: string): string {
  return ADD_METHODS.find(item => item.id === id)?.label || id
}

/** 这一家在静态表里有没有登记（决定动态登录 501 时能不能回落到静态表单） */
export function hasStaticConfig(provider: string): boolean {
  return Boolean(configOf(provider))
}

/** 桌面导入是否**在手机端**可用：一律不可用（见 planSections 的说明） */
export function desktopImportUsableOnMobile(): boolean {
  return false
}

/** 保留给将来：桌面端可用的家（手机上仍不可用），避免误用 */
export function desktopImportAvailableOnDesktop(config: ProviderConfig): boolean {
  return desktopImportAvailable(config)
}
