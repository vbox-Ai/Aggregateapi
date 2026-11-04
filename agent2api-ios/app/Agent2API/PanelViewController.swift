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

    /// 构建戳：v3.4.<构建号> (sha) — 由 build-ipa.sh 写进 Info.plist
    static var buildStamp: String {
        let info = Bundle.main.infoDictionary ?? [:]
        let short = info["CFBundleShortVersionString"] as? String ?? "?"
        let build = info["A2ABuildNumber"] as? String ?? info["CFBundleVersion"] as? String ?? "?"
        let sha = info["A2AGitSha"] as? String ?? "?"
        let time = info["A2ABuildTime"] as? String ?? ""
        return "v\(short) (\(sha)) \(time)"
    }

    private var healthTimer: Timer?
    private var startedEmbedded = false

    /// 内嵌网关 `a2a_start` 的返回码（0 成功 / -1 初始化失败 / -2 端口占用）
    private var embeddedRC: Int32?
    /// 显示在黄条上的诊断串：模式、返回码、数据目录、ui 是否存在
    private var diag: String = ""
    /// 状态条上优先显示的摘要（/m 在最前，其次是 /health、rc、home）
    private var summary: String = ""
    /// 页面 JS 报错（显示在状态条最后几行，白屏时靠它定位）
    private var jsErrors: [String] = []
    /// /m 404 时是否已尝试回退到 "/"
    private var triedRootFallback = false
    /// 当前是否显示桌面面板（/）而不是手机面板（/m）
    private var showingDesktop = false

    // MARK: - 生命周期

    override func viewDidLoad() {
        super.viewDidLoad()
        // 标题直接显示构建戳，方便确认"装的是不是这一版"
        title = "Agent2API \(Self.buildStamp)"
        view.backgroundColor = .systemBackground
        buildWebView()
        buildStatusBar()
        if PanelViewController.backend == .embedded { startEmbeddedGateway() }
        navigationItem.rightBarButtonItem = UIBarButtonItem(
            title: "桌面面板",
            style: .plain,
            target: self,
            action: #selector(toggleDesktopPanel)
        )
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
        // 与系统 PWA 一致：允许内联媒体
        config.preferences.javaScriptCanOpenWindowsAutomatically = true

        // —— 关键：无沙盒 App 的 WKWebView 数据目录不可写 ——
        // WebKit 默认把 website data（localStorage/IndexedDB/缓存）写到 App 容器里；
        // TrollStore + no-sandbox 之后容器不可写（诊断页已证实 [513]），
        // WebKit 初始化失败会让页面白屏且不报错。改用「非持久」数据存储（纯内存），
        // 代价是重启 App 后需要重新登录面板（令牌不再落在磁盘）。
        config.websiteDataStore = .nonPersistent()

        // ① 登录器接管：把 window.A2A_LOGIN_OPEN 锁成 getter，
        //    页面里那句 `window.A2A_LOGIN_OPEN = function(){}` 会静默失败，
        //    于是「打开官方授权页」永远走原生隔离容器（等价 patch-ui.sh，但不用改文件）。
        config.userContentController.addUserScript(Bridge.loginOpenScript())
        config.userContentController.add(self, name: Bridge.messageName)

        // 把页面里的 JS 报错/未处理 Promise 抓出来显示在状态条上。
        // 面板白屏最常见的真相就是"某个模块 404 或 JS 抛错"，而在 App 里看不到控制台。
        let errorHook = """
        (function(){
          function send(text){ try { window.webkit.messageHandlers.a2aDiag.postMessage(String(text)); } catch (e) {} }
          window.addEventListener('error', function(e){
            var t = e.target;
            if (t && t.tagName) { send('资源加载失败: ' + t.tagName + ' ' + (t.src || t.href || '')); return; }
            send('JS错误: ' + (e.message || '') + ' @ ' + (e.filename || '') + ':' + (e.lineno || 0));
          }, true);
          window.addEventListener('unhandledrejection', function(e){
            var r = e.reason;
            send('Promise拒绝: ' + ((r && (r.message || r.stack)) || r));
          });
        })();
        """
        config.userContentController.addUserScript(
            WKUserScript(source: errorHook, injectionTime: .atDocumentStart, forMainFrameOnly: false)
        )
        config.userContentController.add(self, name: "a2aDiag")

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
        statusLabel.font = .systemFont(ofSize: 10, weight: .regular)
        // 诊断信息可能有多行（mode/port/home/ui/原因），给到 6 行，别被裁掉
        statusLabel.numberOfLines = 12
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
            statusBar.heightAnchor.constraint(equalToConstant: 170),

            statusLabel.leadingAnchor.constraint(equalTo: statusBar.leadingAnchor, constant: 14),
            statusLabel.centerYAnchor.constraint(equalTo: statusBar.centerYAnchor),
            statusLabel.trailingAnchor.constraint(equalTo: retryButton.leadingAnchor, constant: -10),

            retryButton.trailingAnchor.constraint(equalTo: statusBar.trailingAnchor, constant: -14),
            retryButton.centerYAnchor.constraint(equalTo: statusBar.centerYAnchor),
        ])
        view.bringSubviewToFront(statusBar)
    }

    // MARK: - 面板自检（网关起来了但页面空白时，告诉我们是 404 还是空响应）

    /// 依次请求 /health /m /，把"状态码 + 字节数 + 前 160 字节"附到 diag。
    /// 只有 /m 不是 200 或响应太小才把诊断页顶上来，避免正常时挡住面板。
    private func selfCheckPanel() {
        let targets: [String] = ["health", "m", ""]
        let group = DispatchGroup()
        var results: [String: String] = [:]

        for target in targets {
            group.enter()
            let key = target.isEmpty ? "/" : "/" + target
            var request = URLRequest(url: baseURL.appendingPathComponent(target))
            request.timeoutInterval = 4
            URLSession.shared.dataTask(with: request) { data, response, _ in
                let code = (response as? HTTPURLResponse)?.statusCode ?? -1
                let bytes = data?.count ?? 0
                let head = String(data: (data ?? Data()).prefix(160), encoding: .utf8) ?? ""
                let flat = head.replacingOccurrences(of: "\n", with: " ")
                results[key] = "HTTP \(code) · \(bytes) B · \(flat)"
                group.leave()
            }.resume()
        }

        group.notify(queue: .main) { [weak self] in
            guard let self else { return }
            var text = self.diag
            for key in ["/health", "/m", "/"] {
                if let value = results[key] { text += "\n\(key) → \(value)" }
            }
            self.diag = text

            // 摘要：把最关键的 /m 与 /health 放在最前面（之前被 numberOfLines 截掉的正是它们）
            var summaryLines: [String] = []
            if let body = results["/m"] { summaryLines.append("/m → " + body) }
            if let health = results["/health"] { summaryLines.append("/health → " + health) }
            summaryLines.append("rc=\(self.embeddedRC.map(String.init) ?? "?")  port=\(self.port)  ui存在=\(self.diag.contains("ui存在=true"))")
            if let home = self.diag.split(separator: "\n").first(where: { $0.hasPrefix("home=") }) {
                summaryLines.append(String(home))
            }
            self.summary = summaryLines.joined(separator: "\n")
            self.statusLabel.text = self.summary

            // /m 打不开时，回退到站点根（有些网关把面板挂在 / 上）
            if let body = results["/m"], !body.contains("HTTP 200"), !self.triedRootFallback {
                self.triedRootFallback = true
                self.webView.load(URLRequest(url: self.baseURL))
            }

            // /m 正常（200 且 >200 字节）就认为是面板页，交给 WebView 渲染
            if let body = results["/m"], body.contains("HTTP 200"), !body.contains("· 0 B") {
                let bytes = Int(body.split(separator: " ") .dropFirst(2).first ?? "0") ?? 0
                if bytes > 200 { return }
            }
            self.statusBar.isHidden = false
            self.showDiagnosticsPage()
        }
    }

    // MARK: - 诊断页（把失败原因铺满整屏，避免被状态栏裁掉）

    private func showDiagnosticsPage() {
        guard !diag.isEmpty else { return }
        let escaped = diag
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
        let html = """
        <!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
        <style>
          body{font:15px -apple-system,Menlo;padding:18px;line-height:1.55;white-space:pre-wrap;word-break:break-all;
               background:#111;color:#eee}
          h3{margin:0 0 12px;font-size:17px;color:#ffd166}
          code{color:#7ee787}
        </style></head><body>
        <h3>网关启动失败（构建 \(Self.buildStamp)）</h3>
        <div>\(escaped)</div>
        <p style="color:#888;margin-top:22px">把这一页截图发给开发者即可定位；点右上角「重试」会重新启动网关。</p>
        </body></html>
        """
        webView.loadHTMLString(html, baseURL: nil)
    }

    // MARK: - 网关启停

    /// 形态 A2：进程内起网关。ui 目录取自 bundle，数据目录取 App 容器。
    private func startEmbeddedGateway() {
        guard !startedEmbedded else { return }
        startedEmbedded = true

        #if A2A_EMBEDDED
        let fm = FileManager.default
        // 数据目录候选：有沙盒/无沙盒、TrollStore/appinst 下可写位置各不相同，
        // 逐个"建目录 + 写探针文件"实测，取第一个真正可写的；失败原因全部记录并显示。
        var candidates: [URL] = []
        // ① 先试容器内的常规位置（有沙盒/正常安装时走这里）
        if let docs = fm.urls(for: .documentDirectory, in: .userDomainMask).first {
            candidates.append(docs.appendingPathComponent("agent2api", isDirectory: true))
        }
        if let lib = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask).first {
            candidates.append(lib.appendingPathComponent("agent2api", isDirectory: true))
        }
        candidates.append(URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("agent2api", isDirectory: true))

        // ② 再去沙盒 App 的真实路径：带 `no-sandbox` 后进程会**失去对本容器的沙盒授权**，
        //    容器目录反而写不进去（你截图里 Documents 报"没有权限"就是这个），
        //    而 /var/mobile 下的真实目录是 mobile 用户可写的（Filza 就写这里）。
        candidates.append(URL(fileURLWithPath: "/var/mobile/Library/agent2api", isDirectory: true))
        candidates.append(URL(fileURLWithPath: "/var/mobile/Documents/agent2api", isDirectory: true))
        candidates.append(URL(fileURLWithPath: "/var/tmp/agent2api", isDirectory: true))

        var notes: [String] = []
        var picked: URL?
        for candidate in candidates {
            do {
                try fm.createDirectory(at: candidate, withIntermediateDirectories: true)
                let probe = candidate.appendingPathComponent(".a2a_write_probe")
                try Data("ok".utf8).write(to: probe)
                try? fm.removeItem(at: probe)
                picked = candidate
                break
            } catch {
                let short = (error as NSError).code
                notes.append("\(candidate.path) [\(short)]")
            }
        }
        guard let home = picked else {
            diag = "没有可写的数据目录：\n" + notes.joined(separator: "\n")
            return
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
        if !notes.isEmpty { diag += "\n其它候选失败：" + notes.joined(separator: " | ") }
        if !reason.isEmpty { diag += "\n原因=\(reason)" }
        NSLog("[Agent2API] a2a_start -> \(rc)  port=\(port) home=\(home.path) uiExists=\(uiExists)")
        if rc != 0 {
            showDiagnosticsPage()
        } else {
            selfCheckPanel()
        }
        #else
        diag = "mode=daemon（本构建未链接 agent2api_ios）"
        NSLog("[Agent2API] 本次构建未链接 agent2api_ios（纯客户端形态），请确认守护进程在跑")
        #endif
    }

    /// 在「手机面板 /m」与「桌面面板 /」之间切换。
    /// 手机面板的「网关 Key」页是只读的（上游设计），桌面面板才有完整的
    /// Key 新建、可用范围（提供商/模型白名单）等管理能力。
    @objc private func toggleDesktopPanel() {
        showingDesktop.toggle()
        navigationItem.rightBarButtonItem?.title = showingDesktop ? "手机面板" : "桌面面板"
        webView.load(URLRequest(url: showingDesktop ? baseURL : baseURL.appendingPathComponent("m")))
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
                // 网关正常就收起状态条（它只是排障用的），异常或页面报错时才显示
                self.statusBar.isHidden = ok && self.jsErrors.isEmpty
                if ok {
                    self.statusLabel.text = self.summary.isEmpty
                        ? "网关 OK \u{00B7} 127.0.0.1:\(self.port)\n" + self.diag
                        : self.summary
                }
                if !ok {
                    // 把诊断信息直接印在界面上（无需终端）：模式、启动返回码、数据目录、ui 是否存在
                    var text = "网关未响应 127.0.0.1:\(self.port)\n构建 \(Self.buildStamp)"
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
        if message.name == "a2aDiag" {
            let text = String(describing: message.body)
            jsErrors.append(text)
            if jsErrors.count > 6 { jsErrors.removeFirst() }
            statusBar.isHidden = false
            statusLabel.text = summary + "\n— JS —\n" + jsErrors.joined(separator: "\n")
            return
        }
        guard message.name == Bridge.messageName,
              let body = message.body as? [String: Any],
              let raw = body["url"] as? String,
              let url = URL(string: raw) else { return }
        openLoginContainer(url: url, state: body["state"] as? String ?? "")
    }
}
