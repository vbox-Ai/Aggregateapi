import { authHeaders, refreshPanelAuthIfExpiring, url } from './client'
import { fileBridge } from '../lib/download'
import { t } from '../i18n'

export type BackupOptions = {
  password: string
  includeLogs?: boolean
}

/** 备份密码只进内存，绝不进 localStorage（见 token.rs 的明文不出内存约定）。 */

/**
 * 导出整库备份。
 *
 * ── 两条路 ────────────────────────────────────────────────────
 *   · **iOS 壳**：交给原生桥 `saveRemote` —— 备份包可能有几十 MB，
 *     让原生带着鉴权头直接请求并落盘，不把整包 base64 塞过 JS 桥。
 *   · **浏览器 / PWA**：`fetch` 拿 Blob 后交给浏览器下载。
 *
 * 文件名由调用方给（页面里已在用日期戳）。
 */
export async function downloadBackup(options: BackupOptions, filename: string): Promise<void> {
  await refreshPanelAuthIfExpiring()
  const body = { password: options.password, includeLogs: options.includeLogs ?? true }

  const bridge = fileBridge()
  if (bridge) {
    bridge.postMessage({
      op: 'saveRemote',
      url: url('/api/backup/download'),
      method: 'POST',
      body,
      headers: authHeaders(),
      filename,
    })
    return
  }

  const response = await fetch(url('/api/backup/download'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const data = await response.json().catch(() => null)
    throw new Error((data as { message?: string })?.message || t('导出备份失败'))
  }
  const blob = await response.blob()
  const { downloadBlob } = await import('../lib/download')
  downloadBlob(blob, filename)
}

/** 恢复整库备份：multipart 上传 .a2ab（password 字段 + backup 字段）。 */
export async function uploadBackup(file: File, password: string): Promise<void> {
  await refreshPanelAuthIfExpiring()
  const form = new FormData()
  form.append('password', password)
  form.append('backup', file, file.name)
  const response = await fetch(url('/api/backup/upload'), {
    method: 'POST',
    headers: authHeaders(),
    credentials: 'same-origin',
    body: form,
  })
  if (!response.ok) {
    const data = await response.json().catch(() => null)
    throw new Error((data as { message?: string })?.message || t('恢复备份失败'))
  }
}
