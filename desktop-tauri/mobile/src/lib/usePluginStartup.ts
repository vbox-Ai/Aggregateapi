import { useEffect } from 'react'
import { apiCall } from '../api/client'
import { serverIdentity } from '../lib/servers'
import { store } from '../state/store'
import { startPluginStartupPolling, type PluginStartupSnapshot } from '../../../ui-shared/plugin-startup'

/**
 * 插件启动进度的轮询。
 *
 * 网关在拉起插件进程（或 wasm / 脚本）时会有一段时间不可用，新版把这段进度暴露成
 * 会话上的 `pluginStartup`，由这个 hook 定时拉取并刷新会话。
 *
 * 我们的会话类型还没声明该字段（网关在旧版本上也不会返回），所以这里用窄类型读它；
 * 没有这段数据时 polling 退化为「只读 + 不刷新」，不会报错。
 */
export function usePluginStartup(enabled: boolean, identity: string) {
  useEffect(() => {
    if (!enabled) return
    return startPluginStartupPolling({
      read: signal => apiCall('/api/plugins/startup', { signal }),
      refresh: async () => { if (serverIdentity() === identity) await store.refresh(true) },
      session: () => (store.get().session as { pluginStartup?: PluginStartupSnapshot } | undefined)?.pluginStartup,
    })
  }, [enabled, identity])
}
