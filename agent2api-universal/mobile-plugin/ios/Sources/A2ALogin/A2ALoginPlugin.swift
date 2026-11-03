import Foundation
import Capacitor
import WebKit

/// Agent2API 隔离登录容器 —— `Agent2Login.apk`（Android 系统 WebView 容器）在 iOS 上的等价物。
///
/// ── 为什么必须原生实现，不能用页面里的 window.open ─────────────
/// 上游 `mobile/src` 在网页端是「新标签 + 轮询 `login/wait`」；但 WKWebView 里
/// `window.open` 会复用**同一个** `WKWebsiteDataStore`，登录态（cookie / localStorage）
/// 会跟主面板互串 —— 多账号场景下第二次登录直接拿到上一次的会话，表现为
/// 「添加上一个账号的 token 又出现在新账号里」。
///
/// 所以这里给每次登录开一个 `WKWebsiteDataStore.nonPersistent()` 的独立容器：
///   · cookie / localStorage / IndexedDB 都在内存里，进程一退就没；
///   · 关闭时再 `removeData(ofTypes: allWebsiteDataTypes, modifiedSince: .distantPast)`
///     兜一层（容器是长驻进程，不能指望 deinit）；
///   · 回调闭环：loopback 重定向直接放行（命中本机网关），自定义协议
///     （`office-raccoon://`、`autoclaw://` 等）截获后 POST 给
///     `/api/session/login/callback`。
///
/// ── 与 Android 版的对应关系 ────────────────────────────────────
/// | Android（Agent2Login.apk）              | 这里                                     |
/// |-----------------------------------------|------------------------------------------|
/// | 独立 WebView + 独立 cookie 罐             | `WKWebsiteDataStore.nonPersistent()`      |
/// | 登完即焚（cookie/localStorage/缓存/表单）  | `removeData` + `URLCache.removeAll…`      |
/// | loopback 重定向落回网关                   | `decidePolicyFor` 放行 127.0.0.1/localhost |
/// | 自定义协议 POST /api/session/login/callback | 同一个 meta 处理路径                     |
@objc(A2ALoginPlugin)
public class A2ALoginPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "A2ALoginPlugin"
    public let jsName = "A2ALogin"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise)
    ]

    private var session: LoginSession?

    /// 打开隔离登录容器。
    /// - Parameters:
    ///   - url:     授权页
    ///   - state:   面板发起登录时拿到的 state（Cookie 抓取型回调需要，原样带回）
    ///   - gateway: 网关基地址（默认取 WebView 当前 origin 对应的回环地址）
    @objc func open(_ call: CAPPluginCall) {
        guard let raw = call.getString("url"), let url = URL(string: raw),
              let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" else {
            call.reject("url 必须是 http(s) 地址")
            return
        }
        let state = call.getString("state") ?? ""
        let gateway = call.getString("gateway") ?? defaultGateway()

        DispatchQueue.main.async { [weak self] in
            guard let self, let host = self.bridge?.viewController else {
                call.reject("没有可用的宿主视图控制器")
                return
            }
            // 同一时刻只允许一个登录容器：第二个请求直接拒，避免 cookie 罐互相干扰
            if self.session != nil {
                call.reject("已有登录容器在打开中")
                return
            }
            let session = LoginSession(gateway: gateway, state: state, url: url) { [weak self] result in
                self?.session = nil
                call.resolve(["result": result])
            }
            self.session = session
            session.present(from: host)
        }
    }

    /// App 内嵌形态（形态 A2）下网关就在本机；独立 App 形态下由用户配置的服务器地址决定。
    /// Capacitor 页面 origin 是 `capacitor://localhost`，所以这里只能给默认值，
    /// 真正的地址由 `mobile/src/api/gateway.ts` 在调用时传进来。
    private func defaultGateway() -> String { "http://127.0.0.1:3065" }
}

// ─────────────────────────────────────────────────────────────
// 一次登录会话 = 一个独立 cookie 罐 + 一个模态 WKWebView
// ─────────────────────────────────────────────────────────────
final class LoginSession: NSObject, WKNavigationDelegate {
    private let gateway: String
    private let state: String
    private let startURL: URL
    private let completion: (String) -> Void

    private let store = WKWebsiteDataStore.nonPersistent()
    private var webView: WKWebView?
    private var controller: UIViewController?
    private var finished = false

    init(gateway: String, state: String, url: URL, completion: @escaping (String) -> Void) {
        self.gateway = gateway
        self.state = state
        self.startURL = url
        self.completion = completion
        super.init()
    }

    func present(from host: UIViewController) {
        let controller = UIViewController()
        controller.title = "登录（隔离容器）"
        controller.view.backgroundColor = .systemBackground

        let config = WKWebViewConfiguration()
        config.websiteDataStore = store          // ★ 一次性 cookie 罐
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        config.preferences.javaScriptCanOpenWindowsAutomatically = true

        let web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.translatesAutoresizingMaskIntoConstraints = false
        controller.view.addSubview(web)
        NSLayoutConstraint.activate([
            web.topAnchor.constraint(equalTo: controller.view.safeAreaLayoutGuide.topAnchor),
            web.leadingAnchor.constraint(equalTo: controller.view.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: controller.view.trailingAnchor),
            web.bottomAnchor.constraint(equalTo: controller.view.bottomAnchor),
        ])
        controller.navigationItem.leftBarButtonItem = UIBarButtonItem(
            barButtonSystemItem: .cancel, target: self, action: #selector(onCancel))

        self.webView = web
        self.controller = controller

        let nav = UINavigationController(rootViewController: controller)
        nav.modalPresentationStyle = .fullScreen
        host.present(nav, animated: true) {
            web.load(URLRequest(url: self.startURL))
        }
    }

    @objc private func onCancel() { finish(reason: "cancelled") }

    // ── 回调闭环 ────────────────────────────────────────────────
    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { return decisionHandler(.allow) }
        let scheme = url.scheme?.lowercased() ?? ""
        let host = url.host?.lowercased() ?? ""

        // 1) 自定义协议 = 上游把授权结果扔出来 → 交给网关的 callback 端点
        if scheme != "http" && scheme != "https" {
            decisionHandler(.cancel)
            postCallback(customURL: url)
            return
        }
        // 2) loopback = 直接落回网关（与 Android 容器一致）
        if host == "127.0.0.1" || host == "localhost" {
            let isCallback = url.path.contains("/api/session/login/callback")
            decisionHandler(.allow)
            if isCallback { finish(reason: "loopback") }
            return
        }
        decisionHandler(.allow)
    }

    private func postCallback(customURL: URL) {
        guard let endpoint = URL(string: "\(gateway)/api/session/login/callback") else {
            finish(reason: "bad-gateway")
            return
        }
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: [
            "state": state,
            "url": customURL.absoluteString,
            "callbackUrl": customURL.absoluteString,
        ])
        URLSession.shared.dataTask(with: request) { [weak self] _, _, error in
            DispatchQueue.main.async {
                self?.finish(reason: error == nil ? "callback-posted" : "callback-failed")
            }
        }.resume()
    }

    // ── 收尾：焚毁一切痕迹 ─────────────────────────────────────
    private func finish(reason: String) {
        guard !finished else { return }
        finished = true
        purge()
        controller?.dismiss(animated: true) { [completion] in
            completion(reason)
        }
        webView = nil
        controller = nil
    }

    private func purge() {
        let types = WKWebsiteDataStore.allWebsiteDataTypes()
        store.removeData(ofTypes: types, modifiedSince: .distantPast) { }
        URLCache.shared.removeAllCachedResponses()
        HTTPCookieStorage.shared.removeCookies(since: .distantPast)
    }
}
