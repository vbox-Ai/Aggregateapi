import { authHeaders, refreshPanelAuthIfExpiring, url } from './client'
import { t } from '../i18n'

export type BackupOptions = {
  password: string
  includeLogs?: boolean
}

/** 备份密码只进内存，绝不进 localStorage（见 token.rs 的明文不出内存约定）。 */

/** 导出整库备份：POST /api/backup/download 返回 .a2ab 二进制流。 */
export async function downloadBackup(options: BackupOptions): Promise<Blob> {
  await refreshPanelAuthIfExpiring()
  const response = await fetch(url('/api/backup/download'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    credentials: 'same-origin',
    body: JSON.stringify({ password: options.password, includeLogs: options.includeLogs ?? true }),
  })
  if (!response.ok) {
    const data = await response.json().catch(() => null)
    throw new Error((data as { message?: string })?.message || t('导出备份失败'))
  }
  return response.blob()
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
