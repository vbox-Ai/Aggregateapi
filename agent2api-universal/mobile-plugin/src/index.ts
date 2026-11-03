import { registerPlugin } from '@capacitor/core';
import type { A2ALoginPlugin, A2ALoginOptions, A2ALoginResult } from './definitions';

/**
 * 原生实现（iOS 走 A2ALoginPlugin.swift；Android 若未实现，Capacitor 会抛
 * "not implemented on android"，由下面的 `openLogin` 兜底到 intent / 新标签）。
 */
export const A2ALogin = registerPlugin<A2ALoginPlugin>('A2ALogin');

/**
 * 统一入口：六端同一份调用代码，内部按"有没有原生容器"降级。
 * 与 `agent2api-universal/ui/host.js` 的 `A2AHost.login.open` 保持同一语义。
 */
export async function openLogin(options: A2ALoginOptions): Promise<A2ALoginResult> {
  const { url, state = '', gateway = 'http://127.0.0.1:3065' } = options;

  // ① 原生隔离容器
  try {
    return await A2ALogin.open({ url, state, gateway });
  } catch (error) {
    console.info('[A2ALogin] 原生容器不可用，降级：', error);
  }

  // ② Android：模块自带的隔离登录器（Agent2Login.apk 的 intent）
  const ua = navigator.userAgent || '';
  if (/Android/i.test(ua)) {
    const intent =
      'agent2api://login?gateway=' + encodeURIComponent(location.origin) +
      '&state=' + encodeURIComponent(state) +
      '&url=' + encodeURIComponent(url);
    try {
      window.location.href = intent;
      return { result: 'intent' };
    } catch {
      /* 落到 ③ */
    }
  }

  // ③ 新标签 + 由面板轮询 login/wait 收结果（与 web_shim.rs 同语义）
  const opened = window.open(url, '_blank', 'noopener,noreferrer');
  if (!opened) location.href = url;
  return { result: 'tab' };
}

export type { A2ALoginOptions, A2ALoginResult, A2ALoginPlugin };
export * from './definitions';
