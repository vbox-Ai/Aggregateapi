/**
 * 云同步的服务商预设。
 *
 * 逐字对齐桌面端 `ui-islands/src/islands/settings-cloud-sync-model.ts` 的
 * `WEBDAV_PRESETS` / `S3_PRESETS` —— 这些是**纯前端**的东西（契约文档里没有，
 * 因为后端只认 `baseUrl` / `region` 两个字段）。第一版手机端只照契约实现了字段，
 * 漏了这一层，用户会以为「坚果云 / Nextcloud / 群晖」这些自家名字是缺失的功能。
 *
 * 预设的作用只有一件事：**把地址（或区域）填成模板**，之后用户自己改。
 * 所以「当前选中哪个预设」不是配置、是**从已填字段反推**出来的：
 *   · WebDAV 按 baseUrl 的 **host** 匹配（`dav.jianguoyun.com` 这类）；
 *   · S3 按 region 与预设的占位区域匹配（`auto` / `us-east-1` …）；
 *   · 匹配不上就是「自定义」。
 * 这样用户手填一个别的地址时，下拉不会谎报成某个预设。
 */

import { t } from '../i18n'

export type WebdavPreset = {
  id: string
  label: string
  /** 选中时要填进 `webdavBaseUrl` 的模板；自定义为空 */
  baseUrl: string
  hint: string
}

export type S3Preset = {
  id: string
  label: string
  /** 选中时要填进 `s3Region` 的模板，同时用作该输入框的 placeholder */
  regionPlaceholder: string
  hint: string
}

export const WEBDAV_PRESETS: WebdavPreset[] = [
  {
    id: 'jianguoyun',
    label: t('坚果云'),
    baseUrl: 'https://dav.jianguoyun.com/dav/',
    hint: t('坚果云需使用「第三方应用密码」（账户信息 → 安全选项里生成），地址必须是 /dav/ 下的目录。'),
  },
  {
    id: 'nextcloud',
    label: 'Nextcloud',
    baseUrl: 'https://your-server/remote.php/dav/files/USERNAME/',
    hint: t('把地址里的 your-server 与 USERNAME 换成你自己的；目录不存在时会自动创建。'),
  },
  {
    id: 'synology',
    label: t('群晖 NAS'),
    baseUrl: 'http://your-nas-ip:5005/',
    hint: t('群晖需在「控制面板 → 应用程序门户 → WebDAV」里启用服务，端口默认 5005（HTTP）/ 5006（HTTPS）。'),
  },
  { id: 'custom', label: t('自定义'), baseUrl: '', hint: '' },
]

export const S3_PRESETS: S3Preset[] = [
  {
    id: 'aws',
    label: 'Amazon S3',
    regionPlaceholder: 'us-east-1',
    hint: t('Endpoint 留空即走 AWS 官方地址；Region 必须与桶所在区域一致。'),
  },
  {
    id: 'r2',
    label: 'Cloudflare R2',
    regionPlaceholder: 'auto',
    hint: t('Endpoint 填 https://<账户ID>.r2.cloudflarestorage.com，Region 固定填 auto。'),
  },
  {
    id: 'minio',
    label: 'MinIO',
    regionPlaceholder: 'us-east-1',
    hint: t('Endpoint 形如 http://192.168.1.10:9000（自建通常用 http）；Region 一般填 us-east-1。'),
  },
  {
    id: 'oss',
    label: t('阿里云 OSS'),
    regionPlaceholder: 'cn-hangzhou',
    hint: t('Endpoint 填 https://oss-cn-hangzhou.aliyuncs.com，Region 填 cn-hangzhou（按实际地域改）。'),
  },
  {
    id: 'cos',
    label: t('腾讯云 COS'),
    regionPlaceholder: 'ap-guangzhou',
    hint: t('Endpoint 填 https://cos.ap-guangzhou.myqcloud.com，Region 填 ap-guangzhou（按实际地域改）。'),
  },
  {
    id: 'obs',
    label: t('华为云 OBS'),
    regionPlaceholder: 'cn-north-4',
    hint: t('Endpoint 填 https://obs.cn-north-4.myhuaweicloud.com，Region 填 cn-north-4（按实际地域改）。'),
  },
  { id: 'custom', label: t('自定义'), regionPlaceholder: 'us-east-1', hint: '' },
]

/** 新表单的默认值（与桌面端 `emptyForm()` 一致：远端根目录与档案名不是空串） */
export const CLOUD_SYNC_DEFAULTS = { remoteRoot: 'agent2api-sync', profile: 'default' } as const

/**
 * 从已填地址反推 WebDAV 预设。
 *
 * 按 **host** 比，不按整串前缀 —— 用户会在模板后面接自己的目录
 * （`https://dav.jianguoyun.com/dav/我的备份`），前缀比法会漏。
 */
export function matchWebdavPreset(baseUrl: string): WebdavPreset {
  const custom = WEBDAV_PRESETS[WEBDAV_PRESETS.length - 1]
  const value = baseUrl.trim()
  if (!value) return custom
  for (const preset of WEBDAV_PRESETS) {
    if (!preset.baseUrl) continue
    try {
      const host = new URL(preset.baseUrl).host
      if (host && value.includes(host)) return preset
    } catch {
      // 模板本身不是合法 URL 就跳过它，不要因此让整段判断抛出去
    }
  }
  return custom
}

/** 从已填区域反推 S3 预设（匹配不上就是自定义） */
export function matchS3Preset(region: string): S3Preset {
  const custom = S3_PRESETS[S3_PRESETS.length - 1]
  const value = region.trim().toLowerCase()
  if (!value) return S3_PRESETS[0]
  for (const preset of S3_PRESETS) {
    if (preset.id === 'custom') continue
    if (preset.regionPlaceholder.toLowerCase() === value) return preset
  }
  return custom
}
