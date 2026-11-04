import UIKit
import WebKit

/// 面板主界面：WKWebView 加载本机网关的移动端面板（`/m`），
/// 对应 Android 模块里的「KernelSU WebUI + ui/ 自托管面板」。
///
/// 两种后端形态共用本类：
/// - `.daemon`（形态 A1，默认）：网关由 LaunchDaemon 常驻，App 只做客户端；
/// - `.embedded`（形态 A2）：App 启动时通过 `agent2api_ios` 静态库在进程内起网关。
final class PanelViewController: UIViewController {

    enum Backend { case daemon, embedded }

    /// 编译期决定默认后端：
    /// · `A2A_EMBEDDED`（链接了 agent2api_ios 静态库）→ 网关跑在 App 进程内，
    ///   IPA 装上即可用，不依赖越狱机的 LaunchDaemon；
    /// · 否则 → 纯客户端壳，连 127.0.0.1:3065 上由 LaunchDaemon 拉起的网关。
    #if A2A_EMBEDDED
    static var backend: Backend = .embedded
    #else
    static var backend: Backend = .daemon
    #endif

    /// 网关端口首选值（与 daemon plist 的 AGENT2API_PROXY_PORT 一致）；
    /// 若被占用（例如上一次的实例还没退干净），会依次尝试后面的端口。
    private var port: UInt16 = 3065
    private let portCandidates: [UInt16] = [3065, 3066, 3067]
    private var baseURL: URL { URL(string: "http://127.0.0.1:\(port)")! }

    private var webView: WKWebView!
    private let statusBar = UIView()
    private let statusLabel = UILabel()
    private let retryButton = UIButton(type: .system)

    private var healthTimer: Timer?
    private var startedEmbedded = false

    /// 内嵌网关 `a2a_start` 的返回码（0 成功 / -1 初始化失败 / -2 端口占用）
    private var embeddedRC: Int32?
    /// 显示在黄条上的诊断串：模式、返回码、数据目录、ui 是否存在
    private var diag: String = ""

    // MARK: - 生命周期

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "Agent2API"
        view.backgroundColor = .systemBackground
        buildWebView()
        buildStatusBar()
        if PanelViewController.backend == .embedded { startEmbeddedGateway() }
        reload()
        scheduleHealthPolling()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        navigationController?.setNavigationBarHidden(false, animated: animated)
    }

    deinit {
        healthTimer?.invalidate()
        #if A2A_EMBEDDED
        if PanelViewController.backend == .embedded { _ = a2a_stop() }
        #endif
    }

    // MARK: - 视图搭建

    private func buildWebView() {
        let config = WKWebViewConfiguration()
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        // 与系统 PWA 一致：允许内联媒体、允许 localStorage 持久（面板双令牌就存这儿）
        config.preferences.javaScriptCanOpenWindowsAutomatically = true

        // ① 登录器接管：把 window.A2A_LOGIN_OPEN 锁成 getter，
        //    页面里那句 `window.A2A_LOGIN_OPEN = function(){}` 会静默失败，
        //    于是「打开官方授权页」永远走原生隔离容器（等价 patch-ui.sh，但不用改文件）。
        config.userContentController.addUserScript(Bridge.loginOpenScript())
        config.userContentController.add(self, name: Bridge.messageName)

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        // 面板是移动端布局，禁掉「双击缩放」造成的输入框抖动
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)

        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
    }

    private func buildStatusBar() {
        statusBar.translatesAutoresizingMaskIntoConstraints = false
        statusBar.backgroundColor = UIColor.systemYellow.withAlphaComponent(0.95)
        statusBar.isHidden = true
        view.addSubview(statusBar)

        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        statusLabel.font = .systemFont(ofSize: 12, weight: .medium)
        statusLabel.numberOfLines = 2
        statusLabel.textColor = .black
        statusBar.addSubview(statusLabel)

        retryButton.translatesAutoresizingMaskIntoConstraints = false
        retryButton.setTitle("重试", for: .normal)
        retryButton.titleLabel?.font = .systemFont(ofSize: 12, weight: .semibold)
        retryButton.addTarget(self, action: #selector(onRetry), for: .touchUpInside)
        statusBar.addSubview(retryButton)

        NSLayoutConstraint.activate([
            statusBar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            statusBar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            statusBar.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            statusBar.heightAnchor.constraint(equalToConstant: 44),

            statusLabel.leadingAnchor.constraint(equalTo: statusBar.leadingAnchor, constant: 14),
            statusLabel.centerYAnchor.constraint(equalTo: statusBar.centerYAnchor),
            statusLabel.trailingAnchor.constraint(equalTo: retryButton.leadingAnchor, constant: -10),

            retryButton.trailingAnchor.constraint(equalTo: statusBar.trailingAnchor, constant: -14),
            retryButton.centerYAnchor.constraint(equalTo: statusBar.centerYAnchor),
        ])
        view.bringSubviewToFront(statusBar)
    }

    // MARK: - 网关启停

    /// 形态 A2：进程内起网关。ui 目录取自 bundle，数据目录取 App 容器。
    private func startEmbeddedGateway() {
        guard !startedEmbedded else { return }
        startedEmbedded = true

        #if A2A_EMBEDDED
        let fm = FileManager.default
        guard let lib = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
            diag = "拿不到 ApplicationSupport 目录"
            return
        }
        let home = lib.appendingPathComponent("agent2api", isDirectory: true)
        do {
            try fm.createDirectory(at: home, withIntermediateDirectories: true)
        } catch {
            diag = "建数据目录失败：\(error.localizedDescription)"
        }
        let ui = Bundle.main.resourceURL?.appendingPathComponent("ui", isDirectory: true)
        let uiExists = ui.map { fm.fileExists(atPath: $0.path) } ?? false

        let rc: Int32 = {
            // 端口可能被上一次实例或 daemon 占着：依次试 3065 → 3066 → 3067
            var last: Int32 = -1
            for candidate in portCandidates {
                last = home.path.withCString { homePtr in
                    (ui?.path ?? "").withCString { uiPtr in
                        a2a_start(homePtr, uiPtr, candidate)
                    }
                }
                if last == 0 {
                    port = candidate
                    break
                }
            }
            return last
        }()
        embeddedRC = rc
        // rc != 0 时向 Rust 侧取"为什么失败"（bootstrap 的具体 reason），直接显示在黄条上
        var reason = ""
        if rc != 0, let cstr = a2a_last_error() {
            reason = String(cString: cstr)
            a2a_free_string(cstr)
        }
        // 把关键事实直接写到界面上：没有终端也能定位（模式/返回码/端口/数据目录/ui 是否打包）
        diag = "mode=embedded rc=\(rc)\nport=\(port)\nhome=\(home.path)\nui存在=\(uiExists)"
        if !reason.isEmpty { diag += "\n原因=\(reason)" }
        NSLog("[Agent2API] a2a_start -> \(rc)  port=\(port) home=\(home.path) uiExists=\(uiExists)")
        #else
        diag = "mode=daemon（本构建未链接 agent2api_ios）"
        NSLog("[Agent2API] 本次构建未链接 agent2api_ios（纯客户端形态），请确认守护进程在跑")
        #endif
    }

    private func reload() {
        webView.load(URLRequest(url: baseURL.appendingPathComponent("m")))
    }

    @objc private func onRetry() {
        // 形态 A1 下守护进程可能被 launchctl bootout 过：给用户一个"自救"路径
        if PanelViewController.backend == .embedded { startEmbeddedGateway() }
        reload()
    }

    // MARK: - 健康探测（对应 supervisor.sh 的 /health 判定）

    private func scheduleHealthPolling() {
        healthTimer?.invalidate()
        healthTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            self?.probeHealth()
        }
        probeHealth()
    }

    private func probeHealth() {
        var req = URLRequest(url: baseURL.appendingPathComponent("health"))
        req.timeoutInterval = 3
        URLSession.shared.dataTask(with: req) { [weak self] data, _, error in
            let ok = (error == nil) && (data?.range(of: Data("\"ok\"".utf8)) != nil)
            DispatchQueue.main.async {
                guard let self else { return }
                self.statusBar.isHidden = ok
                if !ok {
                    // 把诊断信息直接印在界面上（无需终端）：模式、启动返回码、数据目录、ui 是否存在
                    var text = "网关未响应 127.0.0.1:\(self.port)"
                    if !self.diag.isEmpty { text += "\n" + self.diag }
                    if let err = error { text += "\n错误：\(err.localizedDescription)" }
                    text += "\nA1 形态：launchctl kickstart -k system/com.chiyu.agent2api"
                    self.statusLabel.text = text
                }
            }
        }.resume()
    }

    // MARK: - 登录器桥（原生侧）

    /// 打开隔离登录容器；成功后由容器自己完成回调并把结果交给网关。
    func openLoginContainer(url: URL, state: String) {
        let vc = LoginContainer(gateway: baseURL, loginURL: url, state: state)
        vc.onFinished = { [weak self] summary in
            // 闭包里调实例方法必须显式 self（Swift 逃逸闭包语义），
            // 先 guard 拿到强引用，避免一连串 self? 把 Optional 插进 JS 字符串
            guard let self else { return }
            self.navigationController?.dismiss(animated: true)
            let detail = self.jsonLiteral(summary)
            self.webView.evaluateJavaScript(
                "window.dispatchEvent(new CustomEvent('a2a-login-finished',{detail:\(detail)}))",
                completionHandler: nil
            )
            // 面板侧有轮询（等待账号登录完成…），这里只做一次即时刷新让状态尽快回去
            self.webView.reload()
        }
        let nav = UINavigationController(rootViewController: vc)
        nav.modalPresentationStyle = .fullScreen
        navigationController?.present(nav, animated: true)
    }

    private func jsonLiteral(_ text: String) -> String {
        let escaped = text
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "\n", with: "\\n")
        return "\"\(escaped)\""
    }
}

// MARK: - WKNavigationDelegate

extension PanelViewController: WKNavigationDelegate {

    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { return decisionHandler(.allow) }
        let scheme = url.scheme?.lowercased() ?? ""

        // 面板里点了外部链接（文档、GitHub）→ 系统浏览器，容器只留本机网关
        if scheme == "http" || scheme == "https" {
            let host = url.host ?? ""
            if host != "127.0.0.1" && host != "localhost" {
                UIApplication.shared.open(url)
                return decisionHandler(.cancel)
            }
            return decisionHandler(.allow)
        }

        // agent2api:// 之类由我们自己的容器处理，其余自定义 scheme 丢给系统
        if scheme == "agent2api" { return decisionHandler(.cancel) }
        if UIApplication.shared.canOpenURL(url) {
            UIApplication.shared.open(url)
        }
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        probeHealth()
    }
}

// MARK: - WKUIDelegate

extension PanelViewController: WKUIDelegate {

    /// 网页里 `window.open(url,'_blank')` / `target=_blank` 都会走到这里。
    /// 面板在非 Android UA 下就是走这条路径发登录请求，
    /// 所以我们把"新窗口"一律接管成一次性隔离容器（等价 Agent2Login.apk）。
    func webView(_ webView: WKWebView,
                 createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard let url = navigationAction.request.url else { return nil }

        if Bridge.isLoginCandidate(url) {
            openLoginContainer(url: url, state: "")
        } else {
            UIApplication.shared.open(url)
        }
        // 返回 nil：不创建"第二个常驻 WebView"，登录流量一律进隔离容器
        return nil
    }

    func webViewDidClose(_ webView: WKWebView) {}
}

// MARK: - WKScriptMessageHandler

extension PanelViewController: WKScriptMessageHandler {

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard message.name == Bridge.messageName,
              let body = message.body as? [String: Any],
              let raw = body["url"] as? String,
              let url = URL(string: raw) else { return }
        openLoginContainer(url: url, state: body["state"] as? String ?? "")
    }
}
