import UIKit
import WebKit

/// 隔离登录容器 —— `apk/Agent2Login.apk` 在 iOS 上的等价实现。
///
/// ── 与 Android 版的对应关系 ───────────────────────────────────
/// | Android                                   | 这里                                        |
/// |-------------------------------------------|---------------------------------------------|
/// | 独立 WebView 容器 + 独立 cookie 罐          | `WKWebsiteDataStore.nonPersistent()`        |
/// | 登录完成焚毁 cookie/localStorage/缓存/表单   | `removeData(ofTypes:modifiedSince:)` + URLCache |
/// | loopback 重定向直接落回网关                  | 允许导航到 `127.0.0.1:3065` 的容器内加载      |
/// | 自定义协议 POST /api/session/login/callback | `decidePolicyFor` 截获 → URLSession POST     |
/// | 设备授权轮询类无需回调                       | 关掉容器后由面板轮询接管                      |
final class LoginContainer: UIViewController {

    private let gateway: URL
    private let loginURL: URL
    private let state: String

    private var webView: WKWebView!
    private let store = WKWebsiteDataStore.nonPersistent()   // ★ 一次性 cookie 罐
    private var finished = false

    /// 关闭时回调（summary 只用于日志/调试，面板不依赖它）
    var onFinished: ((String) -> Void)?

    init(gateway: URL, loginURL: URL, state: String) {
        self.gateway = gateway
        self.loginURL = loginURL
        self.state = state
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    deinit { purge() }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "登录（隔离容器）"
        view.backgroundColor = .systemBackground
        navigationItem.leftBarButtonItem = UIBarButtonItem(
            barButtonSystemItem: .cancel, target: self, action: #selector(onCancel))

        let config = WKWebViewConfiguration()
        config.websiteDataStore = store
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        config.preferences.javaScriptCanOpenWindowsAutomatically = true

        // 登录页里可能有页面自检脚本读 UA；不改 UA（部分上游会按 UA 下发风控挑战）
        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])

        webView.load(URLRequest(url: loginURL))
    }

    // MARK: - 收尾

    @objc private func onCancel() { finish(reason: "cancelled") }

    private func finish(reason: String) {
        guard !finished else { return }
        finished = true
        purge()
        let summary = "login \(reason) state=\(state)"
        onFinished?(summary)
    }

    /// 焚毁这个容器的一切痕迹（cookie / localStorage / IndexedDB / 缓存）
    private func purge() {
        let types = WKWebsiteDataStore.allWebsiteDataTypes()
        store.removeData(ofTypes: types, modifiedSince: .distantPast) { }
        URLCache.shared.removeAllCachedResponses()
        HTTPCookieStorage.shared.removeCookies(since: .distantPast)
    }

    // MARK: - 回调闭环

    /// 自定义协议（`office-raccoon://`、`autoclaw://` 等）登录完成后的回调，
    /// 原样作为 URL POST 给网关的 `/api/session/login/callback`。
    private func postCallback(customURL: URL) {
        var req = URLRequest(url: gateway.appendingPathComponent("api/session/login/callback"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body: [String: Any] = [
            "state": state,
            "url": customURL.absoluteString,
            "callbackUrl": customURL.absoluteString,
        ]
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)

        URLSession.shared.dataTask(with: req) { [weak self] data, _, error in
            let text = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
            DispatchQueue.main.async {
                if let error {
                    NSLog("[Agent2API] 回调提交失败: \(error.localizedDescription)")
                } else {
                    NSLog("[Agent2API] 回调已提交: \(text.prefix(200))")
                }
                self?.finish(reason: error == nil ? "callback-posted" : "callback-failed")
            }
        }.resume()
    }
}

// MARK: - WKNavigationDelegate

extension LoginContainer: WKNavigationDelegate {

    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { return decisionHandler(.allow) }
        let scheme = (url.scheme ?? "").lowercased()
        let host = (url.host ?? "").lowercased()

        // 1. 自定义协议 = 上游把授权结果"扔"出来，交给网关的 callback 端点
        if scheme != "http" && scheme != "https" {
            postCallback(customURL: url)
            return decisionHandler(.cancel)
        }

        // 2. loopback 重定向 = 直接落回网关（与 Android 容器完全一致）
        if host == "127.0.0.1" || host == "localhost" {
            let isCallback = url.path.contains("/api/session/login/callback")
            decisionHandler(.allow)
            if isCallback {
                // 网关收到后自己落库；容器保留这一跳让用户看到"登录成功"页，
                // 但立刻可以收尾（cookie 罐本来就要焚毁）
                finish(reason: "loopback")
            }
            return
        }

        return decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        NSLog("[Agent2API] 登录容器加载失败: \(error.localizedDescription)")
    }
}

// MARK: - WKUIDelegate

extension LoginContainer: WKUIDelegate {

    /// 登录页里的弹窗（有些 SSO 会开新窗）→ 同一个容器内继续，绝不外泄到主 WebView
    func webView(_ webView: WKWebView,
                 createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url { webView.load(URLRequest(url: url)) }
        return nil
    }
}
