import { apiCall } from './client'
import { githubErrorMessage } from '../../../ui-shared/updates'
import { t } from '../i18n'
import type {
  PluginMutation, PluginOperation, PluginSettings, PluginsPayload, PluginUpdate, ReleaseState,
} from '../../../ui-shared/plugins'

export type {
  PackProvider, PackSummary, PackUiSummary, PluginMutation, PluginOperation, PluginSettings,
  PluginsPayload, PluginUpdate, StorePlugin,
} from '../../../ui-shared/plugins'

export function pluginErrorMessage(error: unknown): string {
  return githubErrorMessage(error, t, 'plugin')
}

export function getPlugins(signal?: AbortSignal): Promise<PluginsPayload> {
  return apiCall('/api/plugins', { signal })
}

export function refreshPluginCatalog(): Promise<ReleaseState> {
  return apiCall('/api/plugins/release')
}

export function checkPluginUpdates(): Promise<{ error?: boolean; reason?: string; updates?: PluginUpdate[] }> {
  return apiCall('/api/plugins/update')
}

export function startPluginInstall(id: string, target: string, update = false): Promise<{ operation: PluginOperation }> {
  return apiCall(update ? '/api/plugins/update' : '/api/plugins/install-from-release', {
    method: 'POST',
    body: { id, target },
  })
}

/**
 * 从**本地插件包**安装（`POST /api/plugins/install`，body `{packB64}`）。
 *
 * 与 `startPluginInstall`（从 Release 下载）是两条路：这条把包**上传给网关**再装，
 * 适合离线分发、内测包、以及仓库里还没有的包。注意「本地」指的是**包在手机上**
 * （下载/文件里拿到的 zip），装的位置仍然是**网关联机的那台**。
 *
 * 上游两道体积闸门（任一不过都 400）：
 *   · 空包或不 > 24 MiB（`MAX_PACK_BYTES = 24 * 1024 * 1024`）；
 *   · 请求体上限另留 1 MiB（`MAX_PACK_UPLOAD_BYTES`），装 base64 的 JSON 开销。
 * 校验不过的包会被 `prepare_pack` 拒掉（400），失败原因原样回显给用户即可。
 */
export function installPluginPack(packB64: string): Promise<PluginMutation> {
  return apiCall<PluginMutation>('/api/plugins/install', { method: 'POST', body: { packB64 } })
}

export function setPluginEnabled(id: string, enabled: boolean): Promise<PluginMutation> {
  return apiCall('/api/plugins/enable', { method: 'POST', body: { id, enabled } })
}

export function setPluginProvider(id: string, provider: string, enabled: boolean): Promise<PluginMutation> {
  return apiCall('/api/plugins/provider', { method: 'POST', body: { id, provider, enabled } })
}

export function uninstallPlugin(id: string): Promise<PluginMutation> {
  return apiCall('/api/plugins/uninstall', { method: 'POST', body: { id } })
}

export function getPluginSettings(signal?: AbortSignal): Promise<PluginSettings> {
  return apiCall('/api/plugins/settings', { signal })
}

export function savePluginSettings(body: Partial<PluginSettings>): Promise<PluginSettings> {
  return apiCall('/api/plugins/settings', { method: 'PATCH', body })
}
