import { apiCall } from './client'

/**
 * 云同步（`docs/mobile-ui/contracts/DATA-SYSTEM.md` 的 cloud_sync.rs 一节）。
 *
 * 把账号密文与网关 Key 同步到 WebDAV 或 S3（远端只拿到密文，密钥留在本机）。
 *
 * 契约里最容易踩的几条：
 *  · **PUT 是整份表单**（不是 patch）：缺字段按空串处理；
 *  · **密码类字段空串 = 沿用库里那份**，非空才换新 —— 所以界面上的密码框留空保存
 *    不会把已存的密码清掉，不需要「伪占位值」这种技巧；
 *  · `GET` 只回 `hasPassword` / `hasSecretKey` / `hasSyncPassword` 布尔，**不回显密码**；
 *  · `syncPassword` 在保存时是必填的（首次配置必须给）；
 *  · `upload` / `download` / `test` / `remote` 四条都会**出网**，超时给足（上传按远端带宽，
 *    桌面壳单独放宽到 300 秒）；
 *  · `download` 会**整体替换本机业务数据**（替换前自动备份到 `backups/`），
 *    需要密钥时会回 **409 KEY_REQUIRED**，此时要先走 `import-key`。
 */

export type CloudProvider = 'webdav' | 's3'

export type CloudSyncStatus = {
  lastSyncAt?: number
  lastAction?: 'upload' | 'download'
  lastSnapshotId?: string
  lastLocalHash?: string
  lastKeyFingerprint?: string
  lastError?: string
  lastErrorSource?: 'manual' | 'auto'
}

export type CloudSyncSettings = {
  provider?: CloudProvider
  webdav?: { baseUrl?: string; username?: string; hasPassword?: boolean; userAgent?: string }
  s3?: {
    region?: string
    bucket?: string
    accessKeyId?: string
    endpoint?: string
    hasSecretKey?: boolean
    userAgent?: string
  }
  hasSyncPassword?: boolean
  enabled?: boolean
  autoSync?: boolean
  remoteRoot?: string
  profile?: string
  status?: CloudSyncStatus
  remotePath?: string
  keyFingerprint?: string | null
}

/** PUT 的表单（整份发；密码类字段留空 = 沿用旧值） */
export type CloudSyncForm = {
  provider: CloudProvider
  webdavBaseUrl: string
  webdavUsername: string
  webdavPassword: string
  webdavUserAgent: string
  s3Region: string
  s3Bucket: string
  s3AccessKeyId: string
  s3SecretAccessKey: string
  s3Endpoint: string
  s3UserAgent: string
  syncPassword: string
  enabled: boolean
  autoSync: boolean
  remoteRoot: string
  profile: string
}

export const fetchCloudSync = () => apiCall<CloudSyncSettings>('/api/cloud-sync')
export const putCloudSync = (form: CloudSyncForm) =>
  apiCall<CloudSyncSettings>('/api/cloud-sync', { method: 'PUT', body: form })

/** 用「已存密文 + 本次输入明文」拼临时设置测连接，并建远端目录（出网，失败 502） */
export const testCloudSync = (form: CloudSyncForm) =>
  apiCall<{ remotePath?: string }>('/api/cloud-sync/test', { method: 'POST', body: form })

export type RemoteManifest = {
  empty?: boolean
  remotePath?: string
  manifestBytes?: number
  format?: string
  version?: string
  appVersion?: string
  schemaVersion?: number
  deviceName?: string
  createdAt?: string
  snapshotId?: string
  artifacts?: string[]
  compatible?: boolean
  incompatibleReason?: string | null
  keyFingerprint?: string | null
  localKeyFingerprint?: string | null
  keyRequired?: boolean
  hasKeyArtifact?: boolean
}

export const fetchRemoteManifest = () => apiCall<RemoteManifest>('/api/cloud-sync/remote')

export type UploadResult = {
  status?: string
  remotePath?: string
  bytes?: number
  snapshotId?: string
  rows?: Record<string, number>
}

/** 前置：`enabled` 必须为 true、远端凭据齐全、还要有 syncPassword */
export const uploadCloudSync = () =>
  apiCall<UploadResult>('/api/cloud-sync/upload', { method: 'POST' })

export type DownloadResult = {
  status?: string
  remotePath?: string
  deviceName?: string
  createdAt?: string
  snapshotId?: string
  applied?: Record<string, unknown>
  safetyBackup?: string
}

/** 整体替换本机业务数据；缺密钥时抛 409（`ApiError.status === 409`） */
export const downloadCloudSync = () =>
  apiCall<DownloadResult>('/api/cloud-sync/download', { method: 'POST' })

export const importCloudSyncKey = (password: string) =>
  apiCall<{ status?: string; keyFingerprint?: string; backup?: string | null }>(
    '/api/cloud-sync/import-key',
    { method: 'POST', body: { password } },
  )

/** 云端读取到的清单是否可恢复 */
export function remoteReadiness(manifest: RemoteManifest | null): 'empty' | 'ready' | 'key' | 'incompatible' | 'unknown' {
  if (!manifest) return 'unknown'
  if (manifest.empty) return 'empty'
  if (manifest.compatible === false) return 'incompatible'
  if (manifest.keyRequired) return 'key'
  return 'ready'
}
