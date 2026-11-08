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

    static var backendName: String {
        backend == .embedded ? "A2 内嵌网关" : "A1 守护进程"
    }

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

    /// Supervisor 控制口（不占 3065；网关由 supervisor 按 App 前后台启停）
    private let supervisorPort: UInt16 = 3066
    private var supervisorURL: URL { URL(string: "http://127.0.0.1:\(supervisorPort)")! }
    private var heartbeatTimer: Timer?
    private var isActivating = false
    private var activationStartedAt: Date?
    private var needsReloadAfterActivation = false
    private var appIsActive = true
    private var lastActivateAttempt = Date.distantPast
    private var appObservers: [NSObjectProtocol] = []
    /// WKDownload 已落盘的备份文件（didFinish 时交给用户保存）
    private var downloadedBackupURL: URL?

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
        installAppLifecycleObservers()
        if PanelViewController.backend == .daemon {
            activateGateway()
        } else {
            reload()
        }
        scheduleHealthPolling()
    }

    deinit {
        healthTimer?.invalidate()
        heartbeatTimer?.invalidate()
        for observer in appObservers {
            NotificationCenter.default.removeObserver(observer)
        }
        #if A2A_EMBEDDED
        if PanelViewController.backend == .embedded { _ = a2a_stop() }
        #endif
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        navigationController?.setNavigationBarHidden(false, animated: animated)
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
        // ② 会话持久化：把 Keychain 里的面板登录态注入回 localStorage（WKWebView
        //    是非持久存储，不注入每次启动都要重新登录）
        config.userContentController.addUserScript(
            WKUserScript(source: PanelSessionStore.restoreScript(), injectionTime: .atDocumentStart, forMainFrameOnly: true)
        )
        config.userContentController.add(self, name: "a2aSession")
        // ③ 面板控制（目前只有「删库重注册」）：跨端口调用 3066 会被 CORS 拦，
        //    所以走原生桥，由 App 侧用 URLSession 打 supervisor。
        config.userContentController.add(self, name: "a2aControl")

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        // 备份下载（.a2ab）需要 WKDownloadDelegate（iOS 15.4+）：网页里的 <a download>
        // 才会落盘。部署目标 15.0，用 availability 守卫。
        if #available(iOS 15.4, *) {
            webView.downloadDelegate = self
        }
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
        if PanelViewController.backend == .embedded {
            startEmbeddedGateway()
            reload()
        } else {
            activateGateway()
        }
    }

    // MARK: - Supervisor 生命周期（方案 B）

    private func installAppLifecycleObservers() {
        let center = NotificationCenter.default
        appObservers.append(center.addObserver(
            forName: UIApplication.didBecomeActiveNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            guard let self else { return }
            self.appIsActive = true
            if PanelViewController.backend == .daemon {
                self.activateGateway()
            }
        })
        appObservers.append(center.addObserver(
            forName: UIApplication.didEnterBackgroundNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            guard let self else { return }
            self.appIsActive = false
            if PanelViewController.backend == .daemon {
                self.deactivateGateway()
            }
        })
    }

    /// App 在前台：让 supervisor 拉起网关，然后加载面板。
    private func activateGateway() {
        guard PanelViewController.backend == .daemon, appIsActive else { return }
        if isActivating { return }
        let now = Date()
        if now.timeIntervalSince(lastActivateAttempt) < 2 { return }
        lastActivateAttempt = now
        isActivating = true
        activationStartedAt = now
        needsReloadAfterActivation = true

        statusBar.isHidden = false
        statusLabel.text = "正在启动网关…\nSupervisor 127.0.0.1:\(supervisorPort)"
        supervisorRequest(path: "start", timeout: 25) { [weak self] ok in
            DispatchQueue.main.async {
                guard let self else { return }
                self.isActivating = false
                self.activationStartedAt = nil
                if ok && self.appIsActive {
                    self.startHeartbeat()
                    self.needsReloadAfterActivation = false
                    self.reload()
                } else if !self.appIsActive {
                    self.deactivateGateway()
                } else {
                    // 不直接判死：gateway 可能已经由旧实例拉起，交给 /health 定时器确认。
                    self.probeHealth()
                }
            }
        }
    }

    /// App 进入后台：停掉网关和插件子进程。
    private func deactivateGateway() {
        guard PanelViewController.backend == .daemon else { return }
        stopHeartbeat()
        supervisorRequest(path: "stop", timeout: 3, completion: nil)
    }

    private func startHeartbeat() {
        if heartbeatTimer != nil { return }
        heartbeatTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            guard let self else { return }
            self.supervisorRequest(path: "heartbeat", timeout: 6, completion: nil)
        }
    }

    private func stopHeartbeat() {
        heartbeatTimer?.invalidate()
        heartbeatTimer = nil
    }

    private func supervisorRequest(
        path: String,
        timeout: TimeInterval,
        completion: ((Bool) -> Void)?
    ) {
        var request = URLRequest(url: supervisorURL.appendingPathComponent(path))
        request.httpMethod = "POST"
        request.timeoutInterval = timeout
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = Data("{}".utf8)
        URLSession.shared.dataTask(with: request) { _, response, error in
            let ok = error == nil && (response as? HTTPURLResponse)?.statusCode == 200
            completion?(ok)
        }.resume()
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
        // 即使 supervisor 的 /start 请求还没回来，也要继续探测 3065。
        // 否则网关已经起来了，状态条却会永远停在“正在启动网关”。
        if isActivating, let started = activationStartedAt,
           Date().timeIntervalSince(started) > 30 {
            isActivating = false
            activationStartedAt = nil
        }
        var req = URLRequest(url: baseURL.appendingPathComponent("health"))
        req.timeoutInterval = 3
        URLSession.shared.dataTask(with: req) { [weak self] data, _, error in
            let ok = (error == nil) && (data?.range(of: Data("\"ok\"".utf8)) != nil)
            DispatchQueue.main.async {
                guard let self else { return }
                // 网关正常就收起状态条（它只是排障用的），异常或页面报错时才显示
                self.statusBar.isHidden = ok && self.jsErrors.isEmpty
                if ok {
                    self.isActivating = false
                    self.activationStartedAt = nil
                    self.statusLabel.text = self.summary.isEmpty
                        ? "网关 OK \u{00B7} 127.0.0.1:\(self.port)\n" + self.diag
                        : self.summary
                    if Self.backend == .daemon, self.appIsActive {
                        self.startHeartbeat()
                        if self.needsReloadAfterActivation {
                            self.needsReloadAfterActivation = false
                            self.reload()
                        }
                    }
                }
                if !ok {
                    if self.isActivating {
                        self.statusBar.isHidden = false
                        self.statusLabel.text =
                            "正在启动网关…\nSupervisor 127.0.0.1:\(self.supervisorPort)"
                        return
                    }
                    // 把诊断信息直接印在界面上（无需终端）：模式、启动返回码、数据目录、ui 是否存在
                    var text = "网关未响应 127.0.0.1:\(self.port)\n构建 \(Self.buildStamp)"
                    if !self.diag.isEmpty { text += "\n" + self.diag }
                    if let err = error { text += "\n错误：\(err.localizedDescription)" }
                    text += "\n形态：\(Self.backendName)"
                    if Self.backend == .daemon {
                        text += "\n提示：App 在前台会自动请求 supervisor 启动网关。"
                        self.activateGateway()
                    }
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
        if message.name == "a2aSession" {
            if let body = message.body as? [String: Any] {
                handleSessionMessage(body)
            }
            return
        }
        if message.name == "a2aControl" {
            guard let body = message.body as? [String: Any],
                  let op = body["op"] as? String else { return }
            let id = (body["id"] as? String) ?? ""
            supervisorCall(op: op, id: id)
            return
        }
        guard message.name == Bridge.messageName,
              let body = message.body as? [String: Any],
              let raw = body["url"] as? String,
              let url = URL(string: raw) else { return }
        openLoginContainer(url: url, state: body["state"] as? String ?? "")
    }

    /// 会话持久化：JS 登录后调用 {op:"save", serverId, json} 存 Keychain，
    /// 登出调用 {op:"delete", serverId} 删除。
    func handleSessionMessage(_ body: [String: Any]) {
        guard let op = body["op"] as? String, let serverId = body["serverId"] as? String else { return }
        switch op {
        case "save":
            if let json = body["json"] as? String {
                PanelSessionStore.save(serverId: serverId, json: json)
            }
        case "delete":
            PanelSessionStore.delete(serverId: serverId)
        default:
            break
        }
    }

    /// 调 supervisor（127.0.0.1:3066）。跨端口 fetch 会被 CORS 拦，只能走原生桥。
    ///
    /// `op` → HTTP 方法 + 路径：
    ///   · `status` → GET  /status
    ///   · `start`  → POST /start
    ///   · `stop`   → POST /stop
    ///   · `factory-reset` → POST /factory-reset（成功后页面回首次注册）
    /// 结果通过 `a2a-control-result` 事件回给 JS（携带调用时的 id 以区分并发调用）。
    func supervisorCall(op: String, id: String) {
        var url = URL(string: "http://127.0.0.1:3066/status")
        if op == "start" || op == "stop" || op == "factory-reset" {
            url = URL(string: "http://127.0.0.1:3066/\(op)")
        }
        guard let url else {
            reportSupervisorError(op: op, id: id, message: "控制端口地址非法")
            return
        }
        var request = URLRequest(url: url)
        request.httpMethod = (op == "status") ? "GET" : "POST"
        request.timeoutInterval = 30
        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            DispatchQueue.main.async {
                guard let self else { return }
                if let error {
                    self.reportSupervisorError(op: op, id: id, message: error.localizedDescription)
                    return
                }
                let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                let text = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
                let payload = status == 200 ? text : "HTTP \(status) \(text)"
                if op == "factory-reset" && status == 200 {
                    // 库没了，页面里的本地会话也一并清掉，直接回首次注册
                    self.webView.evaluateJavaScript("try{localStorage.clear()}catch(e){}", completionHandler: nil)
                    self.webView.reload()
                }
                self.deliverSupervisorResult(op: op, id: id, ok: status == 200, payload: payload)
            }
        }.resume()
    }

    private func reportSupervisorError(op: String, id: String, message: String) {
        jsErrors.append("supervisor \(op) 失败：\(message)")
        statusBar.isHidden = false
        statusLabel.text = summary + "\n— supervisor —\n" + jsErrors.joined(separator: "\n")
        deliverSupervisorResult(op: op, id: id, ok: false, payload: message)
    }

    private func deliverSupervisorResult(op: String, id: String, ok: Bool, payload: String) {
        guard let js = String(payload: "{\"ok\":\(ok),\"payload\":\"\(payload)\"}").replacingOccurrences(
            of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"") else { return }
        let body = "window.dispatchEvent(new CustomEvent('a2a-control-result',{detail:{\"op\":\"\(op)\",\"id\":\"\(id)\",\"ok\":\(ok),\"payload\":\"\(js)\",\"raw\":\(js)}})})"
        webView.evaluateJavaScript(body, completionHandler: nil)
    }
}

// MARK: - WKDownloadDelegate（备份下载落盘，iOS 15.4+）

@available(iOS 15.4, *)
extension PanelViewController: WKDownloadDelegate {

    /// 备份下载（`.a2ab`）从网关流式返回。WKWebView 不会自动保存，
    /// 这里把数据落到临时文件，再交给用户决定存到哪里。
    func download(_ download: WKDownload, decideDestinationWith response: URLResponse,
                  suggestion: [String: String]?, completionHandler: @escaping (URL?) -> Void) {
        let filename = response.suggestedFilename?.isEmpty == false ? response.suggestedFilename! : "agent2api-backup.a2ab"
        let target = FileManager.default.temporaryDirectory
            .appendingPathComponent("agent2api-backup-\(UUID().uuidString)-\(filename)")
        downloadedBackupURL = target
        completionHandler(target)
    }

    func didFinish(_ download: WKDownload) {
        guard let url = downloadedBackupURL else { return }
        downloadedBackupURL = nil
        presentDownloadedFile(url)
    }
}

/// 把下载好的 .a2ab 分享给用户（保存到「文件」、iCloud 等）。
private func presentDownloadedFile(_ url: URL) {
    // 在主线程上呈现（WKDownload 回调可能在子线程）
    DispatchQueue.main.async {
        guard FileManager.default.fileExists(atPath: url.path) else { return }
        let activity = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        if let root = (UIApplication.shared.connectedScenes.first as? UIWindowScene)?.windows.first {
            root.rootViewController?.present(activity, animated: true)
        }
        // 分享结束后清理临时文件（延迟一下，让用户有时间选中"保存"）
        DispatchQueue.main.asyncAfter(deadline: .now() + 10) {
            try? FileManager.default.removeItem(at: url)
        }
    }
}
