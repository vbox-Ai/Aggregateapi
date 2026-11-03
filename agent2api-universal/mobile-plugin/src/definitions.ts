// Agent2API 隔离登录容器 · TS 接口
// 一份定义，三端行为：
//   · iOS（原生插件）  → nonPersistent WKWebView + 回调闭环
//   · Android          → 复用现有 agent2api://login intent（模块自带的 Agent2Login.apk），无 App 则新标签
//   · Web / 桌面壳      → 新标签 + 轮询 login/wait（与 web_shim.rs 行为一致）

export interface A2ALoginResult {
  /** cancelled | loopback | callback-posted | callback-failed | bad-gateway */
  result: string
}

export interface A2ALoginOptions {
  /** 授权页地址（http/https） */
  url: string;
  /** 面板 login/start 拿到的 state，Cookie 抓取型回调需要原样带回 */
  state?: string;
  /** 网关基地址，如 http://127.0.0.1:3065 或局域网地址 */
  gateway?: string;
}

export interface A2ALoginPlugin {
  /**
   * 打开隔离登录容器。resolve 时登录会话已结束（不代表一定成功，
   * 真正的结果由网关 `login/wait` 的轮询给出，与桌面壳语义一致）。
   */
  open(options: A2ALoginOptions): Promise<A2ALoginResult>;
}
