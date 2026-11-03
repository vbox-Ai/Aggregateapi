import Foundation
import WebKit

/// 面板 ↔ 原生 的桥：把 Android 版 `patch-ui.sh` 注入 JS 的那套接线，
/// 换成 WKWebView 的 `WKUserScript`（document-start 注入，面板自更新也不会被冲掉）。
enum Bridge {

    static let messageName = "a2aLogin"
    static let handlerName = "a2aLogin"

    /// document-start 注入：锁死 `window.A2A_LOGIN_OPEN`。
    ///
    /// 面板（`ui/m.html`）里本来就有一段自己定义该函数的脚本，它会在非 Android
    /// UA 下退化成 `window.open(url,'_blank')`。这里用 `Object.defineProperty`
    /// 提供一个只有 getter 的属性：页面那行赋值会命中我们设的 setter（空实现），
    /// 于是函数体永远是原生的 `postMessage`，走隔离容器。
    /// 即使面板哪天换实现、改成直接 `window.open`，`WKUIDelegate` 那侧
    /// （`createWebViewWith`）还有一道兜底。
    static func loginOpenScript() -> WKUserScript {
        let js = """
        (function () {
          if (window.__a2aNativeLoginInstalled) { return; }
          window.__a2aNativeLoginInstalled = true;
          function nativeOpen(url, state) {
            try {
              var payload = {
                url: String(url || ''),
                state: state ? String(state) : '',
                origin: String(window.location.origin || '')
              };
              window.webkit.messageHandlers.a2aLogin.postMessage(payload);
            } catch (e) { /* 非 WKWebView（Safari 调试）→ 什么都不做 */ }
          }
          try {
            Object.defineProperty(window, 'A2A_LOGIN_OPEN', {
              configurable: true,
              enumerable: true,
              get: function () { return nativeOpen; },
              set: function () { /* 页面自己的赋值静默丢弃，保留原生实现 */ }
            });
          } catch (e) {
            window.A2A_LOGIN_OPEN = nativeOpen;
          }
        })();
        """
        return WKUserScript(source: js, injectionTime: .atDocumentStart, forMainFrameOnly: true)
    }

    /// 判断一个 URL 是不是"该进隔离登录容器"的授权页。
    ///
    /// 面板里 `window.open` 的两种来源：授权页（要隔离 cookie 罐）与普通外链
    /// （文档/GitHub，应该丢系统浏览器）。判据：
    /// 1. 不是本机网关（本机的是业务跳转，留在主容器）；
    /// 2. 路径或查询串带授权语义（login/oauth/authorize/sso/redirect_uri/state/client_id）。
    static func isLoginCandidate(_ url: URL) -> Bool {
        let host = (url.host ?? "").lowercased()
        if host == "127.0.0.1" || host == "localhost" { return false }
        guard url.scheme == "http" || url.scheme == "https" else { return false }

        let haystack = (url.path + "?" + (url.query ?? "")).lowercased()
        let needles = ["login", "oauth", "authorize", "authorization", "sso", "signin",
                       "sign-in", "redirect_uri", "client_id", "state=", "code_challenge"]
        return needles.contains { haystack.contains($0) }
    }
}
