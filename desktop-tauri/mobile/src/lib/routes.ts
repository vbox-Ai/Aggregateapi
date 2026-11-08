export const SCREEN_IDS = [
  'home', 'report', 'accounts', 'assistant', 'more', 'models', 'keys', 'proxies',
  'tasks', 'requests', 'logs', 'settings', 'docs', 'agent', 'tools', 'servers', 'checkin', 'plugins',
  'plugin-page', 'custom-providers',
] as const

export type ScreenId = typeof SCREEN_IDS[number]
export type Route = { screen: ScreenId; params?: Record<string, string> }

/**
 * 旧插件签到地址只作路由兼容，不再加载插件提供的 HTML。
 *
 * `plugin:<pack>:<page>` 是**插件自定义页面**，交给 `plugin-page` 屏幕渲染
 * （iframe 加载网关托管的 `/plugins/<pack>/ui/<page>`）。签到那一条仍走内置
 * 签到页 —— 它是网关内置能力，不该由插件决定长什么样。
 */
export function normalizeRoute(screen: string, params?: Record<string, string>): Route {
  if (screen === 'checkin-records') return { screen: 'checkin', params: { ...params, tab: 'records' } }
  if (screen.startsWith('plugin:')) {
    const rest = screen.slice('plugin:'.length)
    const [pack, page] = rest.split(':')
    if (pack && page) return { screen: 'plugin-page', params: { ...params, pack, page } }
    return { screen: 'plugins', params }
  }
  if (screen === 'plugin-page' && params?.pack && params?.page) return { screen: 'plugin-page', params }
  if ((SCREEN_IDS as readonly string[]).includes(screen)) return { screen: screen as ScreenId, params }
  return { screen: 'home' }
}

export function routeFromHash(hash: string): Route {
  const [screen, value] = hash.replace(/^#/, '').trim().split('/')
  if (screen === 'checkin' && (value === 'records' || value === 'schedule')) {
    return { screen, params: { tab: value } }
  }
  return normalizeRoute(screen || 'home', value ? { id: value } : undefined)
}
