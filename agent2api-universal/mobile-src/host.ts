/**
 * Agent2API · 手机端宿主能力层（放进 `desktop-tauri/mobile/src/host.ts`）
 *
 * 职责只有三件：
 *   1. 拉一次 `GET /api/host`，把"这台机器能干什么"变成可查询的能力表；
 *   2. 给页面提供"要不要渲染这个入口"的判断（能力驱动，不看 UA）；
 *   3. 把登录交给 A2ALogin（原生隔离容器），原生不可用时自动降级。
 *
 * 设计约束（与上游 `web_shim.rs` 的既有原则一致）：
 *   · 能力不足 → 不渲染，而不是渲染出来点下去报错；
 *   · 能力不足但用户可能点到 → 给一句可行动的话，绝不静默假成功；
 *   · 能力判断的唯一来源是 `/api/host` 与原生注入，**不读 userAgent 做业务判断**
 *     （UA 只用来在"原生不可用"时选择降级路径）。
 */
import { Capacitor } from '@capacitor/core';
import { openLogin as openNativeLogin } from '@agent2api/capacitor-a2a-login';
import { gatewayBase } from './api/gateway';

export type HostPlatform = 'windows' | 'macos' | 'linux' | 'android' | 'ios' | 'web' | 'unknown';

export interface HostCaps {
  execHelpers: boolean;
  plugins: boolean;
  sidecar: boolean;
  isolatedLogin: boolean;
  fileDialogs: boolean;
  notifications: boolean;
  selfUpdate: boolean;
  systemProxy: boolean;
  portChange: boolean;
  loopbackBind: boolean;
  secureStore: 'dpapi' | 'keychain' | 'file' | 'browser' | 'none';
}

export interface HostInfo {
  platform: HostPlatform;
  form: 'daemon' | 'embedded' | 'browser' | 'unknown';
  version: string;
  caps: HostCaps;
  ui?: { mobileFirst?: boolean; defaultRoute?: string };
}

/** 兜底能力表：拿不到 `/api/host`（老网关）时用它，保守到"什么都不能" */
const FALLBACK_CAPS: HostCaps = {
  execHelpers: false, plugins: false, sidecar: false,
  isolatedLogin: Capacitor.isNativePlatform(),
  fileDialogs: Capacitor.isNativePlatform(),
  notifications: Capacitor.isNativePlatform(),
  selfUpdate: false, systemProxy: false, portChange: false,
  loopbackBind: true, secureStore: 'file',
};

let cached: HostInfo | null = null;
let inflight: Promise<HostInfo> | null = null;

export async function loadHostInfo(): Promise<HostInfo> {
  if (cached) return cached;
  if (inflight) return inflight;

  const guessPlatform = (): HostPlatform => {
    if (Capacitor.getPlatform() === 'ios') return 'ios';
    if (Capacitor.getPlatform() === 'android') return 'android';
    return 'web';
  };

  inflight = (async () => {
    try {
      const response = await fetch(`${gatewayBase()}/api/host`, { headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as HostInfo;
      cached = { ...data, caps: { ...FALLBACK_CAPS, ...data.caps } };
    } catch (error) {
      console.info('[host] /api/host 不可用，使用保守能力表：', error);
      cached = {
        platform: guessPlatform(),
        form: Capacitor.isNativePlatform() ? 'embedded' : 'browser',
        version: 'unknown',
        caps: { ...FALLBACK_CAPS },
      };
    }
    return cached!;
  })();

  return inflight;
}

/** 同步读取（页面渲染用）；未加载完时按保守表处理，加载完再触发重渲染 */
export function hostCaps(): HostCaps {
  return cached ? cached.caps : FALLBACK_CAPS;
}

export function hostHas(feature: keyof HostCaps): boolean {
  const value = hostCaps()[feature];
  return typeof value === 'boolean' ? value : false;
}

const FEATURE_TEXT: Partial<Record<keyof HostCaps, string>> = {
  plugins: '插件在本端不可用（需要能启动外部进程的宿主）',
  sidecar: '订阅内核在本端不可用（需要启动 mihomo sidecar）',
  execHelpers: '本端不允许启动外部程序',
  fileDialogs: '本端没有文件选择器，请手动输入路径或粘贴内容',
  notifications: '本端不支持系统通知',
  selfUpdate: '本端不支持原地更新，请重新安装',
  portChange: '本端不能改端口，请改配置后重启后端',
  systemProxy: '本端不支持跟随系统代理',
};

/** 能力不足时的统一出口：返回 false + 一句可行动的话（不抛异常） */
export function guardCap(feature: keyof HostCaps, toast?: (message: string) => void): boolean {
  if (hostHas(feature)) return true;
  const message = FEATURE_TEXT[feature] || `本端不支持 ${feature}`;
  console.info('[host]', message);
  toast?.(message);
  return false;
}

/**
 * 登录统一入口：与 `ui/host.js` 的 `A2AHost.login.open` 同语义。
 * 原生隔离容器 → Android intent → 新标签，三档降级在插件里已经实现。
 */
export async function openLogin(authUrl: string, state: string): Promise<void> {
  try {
    await openNativeLogin({ url: authUrl, state, gateway: gatewayBase() });
  } catch (error) {
    console.info('[host] 登录容器降级：', error);
    const opened = window.open(authUrl, '_blank', 'noopener,noreferrer');
    if (!opened) window.location.href = authUrl;
  }
}
