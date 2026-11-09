import { apiCall, authHeaders, refreshPanelAuthIfExpiring, url } from './client'
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

/**
 * 恢复进度。
 *
 * 网关把阶段与文案都放在后端（`db/backup.rs` 的 `RestorePhase::label/percent`）——
 * 恢复要读文件、解密、在暂存库执行 SQL、拍安全备份、覆盖主库、重载内存态，
 * 30 秒到几分钟；接口在结束时才返回，界面不轮询就只有一个转圈按钮，
 * 用户既看不到进展也不知道要等多久。
 *
 * 与 `/api/update/progress` 同一套：500ms 轮询。没跑过恢复时是
 * `{active:false, phase:''}`。
 */
export type RestoreProgress = {
  active?: boolean
  /** 阶段文案，直接来自后端 */
  phase?: string
  percent?: number
  done?: boolean
  failed?: boolean
  error?: string | null
  startedAt?: number
  finishedAt?: number
}

export function fetchRestoreProgress(): Promise<RestoreProgress> {
  // 路径是 `/api/backup/progress`（处理器 `backup_api::restore_progress`）。
  // 这里曾经写成 `/api/backup/restore/progress` —— 那个路由在网关里**不存在**
  // （上游 http.rs 的 backup 只有 export/import/progress/download/upload 五条），
  // 于是恢复进度一直在 404，进度条永远停在 0%。2026-11-09 对照路由表改正。
  return apiCall<RestoreProgress>('/api/backup/progress')
}

/** 导出密码规则（与 `archive::validate_password` 对齐：≥12 字、≤1024 字节） */
export function validateExportPassword(password: string): string | null {
  if ([...password].length < 12) return t('备份密码需要至少 12 位')
  if (new TextEncoder().encode(password).length > 1024) return t('备份密码不能超过 1024 字节')
  return null
}

/** 恢复密码规则：.a2ab 需要密码，旧 .sql 可以留空；两者都不能超过 1024 字节 */
export function validateRestorePassword(password: string, isSql: boolean): string | null {
  if (new TextEncoder().encode(password).length > 1024) return t('备份密码不能超过 1024 字节')
  if (!password && !isSql) return t('请输入备份密码；旧 SQL 备份可以留空')
  return null
}
