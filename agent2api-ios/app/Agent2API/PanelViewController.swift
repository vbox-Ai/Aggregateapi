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

    /// 本包是否**链接了内嵌网关**（`agent2api_ios` 静态库）。
    ///
    /// 以前它同时决定"用哪个后端"，于是 deb 里的 App（历史上按 EMBED=0 编）在守护进程
    /// 起不来时**只能干等** —— 重启或重新越狱后 launchd 里的注册丢了，面板就一直报
    /// 「网关未响应 127.0.0.1:3065」。现在两者分开：链接与否是**编译期**事实，
    /// 用哪个后端是**运行期**决定。
    #if A2A_EMBEDDED
    static let embeddedLinked = true
    #else
    static let embeddedLinked = false
    #endif

    /// 当前后端。**默认先试守护进程**（越狱机的常规形态：让守护进程独占 3065、插件常驻）；
    /// 只有它确实起不来、且本包链接了内嵌网关时，才在 `activateGateway` 里退回内嵌形态。
    static var backend: Backend = .daemon

    static var backendName: String {
        backend == .embedded ? "A2 内嵌网关" : "A1 守护进程"
    }

    /// 网关端口首选值（与 daemon plist 的 AGENT2API_PROXY_PORT 一致）；
    /// 若被占用（例如上一次的实例还没退干净），会依次尝试后面的端口。
    private var port: UInt16 = 3065
    private let portCandidates: [UInt16] = [3065, 3066, 3067]
    private var baseURL: URL { URL(string: "http://127.0.0.1:\(port)")! }

    /// 面板端口：**默认与网关同端口**（`nil` = 同端口）。开了局域网访问之后
    /// supervisor 会把面板搬到独立端口（3067）并把新端口报在 `/status` 的
    /// `panelPort` 里 —— 这里必须跟上，否则 App 会去连一个此时只挂 `/v1` 的
    /// 端口，面板直接 404。
    ///
    /// 注意 `baseURL` 仍然是**网关**端口的：`/health` 探测、以及嵌入式形态都
    /// 用它。只有加载面板（`/m`）才走 `panelBaseURL`。
    private var panelPort: UInt16?
    private var panelBaseURL: URL { URL(string: "http://127.0.0.1:\(panelPort ?? port)")! }

    private var webView: WKWebView!
    private let statusBar = UIView()
    private let statusLabel = ToneLabel()
    /// 顶部那枚切换面板的悬浮按钮（不挂导航栏，见 installFloatingChrome 的说明）
    private let topPanelButton = UIButton(type: .system)
    /// 完整状态文本：胶囊里只显示**短标题**，但点开的日志必须是完整的
    private var statusFullText = ""
    /// 上一次的"状态键" —— 只在状态**变化**时显示胶囊（正常态一律不显示）
    private var lastStatusKey = ""
    /// 正在写入胶囊短标题（赋值会再次触发 onText，必须挡掉递归）
    private var writingStatusTitle = false

    /// 状态胶囊的显示规则（操作者指定）：
    ///   · 启动中 → 显示一次（橙）；启动成功 → 显示一次（黄）；**正常运行时完全不显示**；
    ///   · 出错 → 红色常驻，胶囊里放一行错误摘要，点它看完整日志。
    /// 之所以按"状态键"驱动而不是"发生赋值"驱动：5 秒心跳/健康轮询会反复赋值，
    /// 按赋值驱动就会把自动收起的胶囊一次次顶回来（真机反馈的"有事没事弹出来"）。
    private func presentStatus(_ text: String) {
        guard !writingStatusTitle else { return }
        statusFullText = text
        applyTone(for: text)

        let key: String
        let title: String
        let autoHide: Bool
        if text.contains("失败") || text.contains("错误")
            || text.contains("— JS —") || text.contains("— supervisor —") {
            let firstLine = text.split(separator: "\n").first.map(String.init) ?? text
            key = "error:" + firstLine
            title = "网关出错了：" + (firstLine.count > 16 ? String(firstLine.prefix(16)) + "…" : firstLine)
            autoHide = false        // 出错常驻：等用户点开或网关恢复正常
        } else if text.contains("正在启动") {
            key = "starting"
            title = "正在启动网关…"
            autoHide = true
        } else if text.contains("等待") {
            key = "waiting"
            title = "等待网关…"
            autoHide = true
        } else if !text.isEmpty {
            key = "ready"
            title = "网关已就绪"
            autoHide = true
        } else {
            return                  // 空文本不显示
        }

        // 状态没变也要**把标签归一成短标题**：外部代码（例如把 "网关 OK · 127.0.0.1:端口"
        // 加诊断串拼成完整文本那条）会反复直接写 statusLabel.text，若不还原，
        // 胶囊上显示的就是那条长原文 —— 真机反馈的"横条上写着网关 OK…"就是这么来的。
        writingStatusTitle = true
        statusLabel.text = title
        writingStatusTitle = false

        guard key != lastStatusKey else { return }   // 状态没变 → 不重新显示
        lastStatusKey = key

        statusBar.isHidden = false
        if autoHide {
            scheduleStatusAutoHide()
        } else {
            statusHideTimer?.invalidate()
            statusHideTimer = nil
        }
    }
    private let retryButton = UIButton(type: .system)

    /// 状态胶囊要浮在**面板自己的悬浮标签栏之上**，所以要把它抬起来这么高。
    ///
    /// 这个数值来自面板侧的定义：标签栏高 `--m-tabbar-h`（约 56）+ 离安全区 8
    /// + 胶囊自身离标签栏 8 ≈ 72。两侧各改一处时这里要跟着对一下（原生量不到
    /// Web 里的 CSS 变量，只能各写一份）。
    private let tabBarClearance: CGFloat = 72

    /// 文本变化时回调的 UILabel。
    ///
    /// 为什么要这个子类：状态胶囊要**按状态上色**，而状态文本是在 8 个不同调用点
    /// 分别赋给 `statusLabel.text` 的。逐个调用点加色调参数会显著扩大 Swift 改动面
    /// —— 而 Swift 在本地编译不了，每轮验证都要等一次完整的 CI 构建。做成子类后，
    /// 配色逻辑收在一处（`applyTone(for:)`），调用点一行都不用改。
    private final class ToneLabel: UILabel {
        var onText: ((String) -> Void)?
        override var text: String? {
            didSet {
                // 相同文字不算变化：5 秒心跳/健康轮询会反复赋同一个摘要，若只按"发生赋值"
                // 回调，每次都会触发「显示 + 重排自动收起」，胶囊就被反复顶回来。
                guard text != lastNotifiedText else { return }
                lastNotifiedText = text
                onText?(text ?? "")
            }
        }
        private var lastNotifiedText: String?
    }

    /// 构建戳：v3.4.<构建号> (sha) — 由 build-ipa.sh 写进 Info.plist
    static var buildStamp: String {
        let info = Bundle.main.infoDictionary ?? [:]
        let short = info["CFBundleShortVersionString"] as? String ?? "?"
        let build = info["A2ABuildNumber"] as? String ?? info["CFBundleVersion"] as? String ?? "?"
        let sha = info["A2AGitSha"] as? String ?? "?"
        let time = info["A2ABuildTime"] as? String ?? ""
        return "v\(short) (\(sha)) \(time)"
    }

    /// 顶部胶囊里显示的**精简**版本号（只要 `v3.4.325` 这一截）。
    ///
    /// 原来直接把整条构建戳（带 sha 与构建时间）放进胶囊，宽度很大、在状态栏
    /// 那一行显得很挤；而 sha/时间属于「排查时才看」的信息，点一下状态胶囊就能
    /// 在小窗里看到完整诊断串。所以这里只显示版本号。
    static var shortStamp: String {
        let info = Bundle.main.infoDictionary ?? [:]
        let short = info["CFBundleShortVersionString"] as? String ?? ""
        return short.isEmpty ? buildStamp : "v\(short)"
    }

    private var healthTimer: Timer?
    /// 状态胶囊的自动收起定时器（见 scheduleStatusAutoHide）
    private var statusHideTimer: Timer?
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
        // 标题只放软件名：版本戳归状态胶囊的小窗（顶部那枚版本胶囊已按要求移除）
        title = "Agent2API"
        view.backgroundColor = .systemBackground
        buildWebView()
        buildStatusBar()
        // 顶部改成悬浮形态：左边版本胶囊、右边两枚圆形图标按钮（手机面板 / 桌面面板）。
        // 导航栏本身仍然负责安全区与内容避让，只是把外观改成透明的，避免自绘浮层钻到刘海里。
        installFloatingChrome()
        if PanelViewController.backend == .embedded { startEmbeddedGateway() }
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
        statusHideTimer?.invalidate()
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
        // 导航栏**彻底隐藏**：只要它还占着位置，顶部就会留一条区域/底色横条
        // （透明 Appearance 也治不干净）。顶部那两件（版本胶囊 + 切换按钮）
        // 已改为页面上的悬浮控件，见 installFloatingChrome。
        navigationController?.setNavigationBarHidden(true, animated: animated)
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
        // ③ 面板控制（删库重注册、局域网开关）：跨端口调用 3066 会被 CORS 拦，
        //    所以走原生桥，由 App 侧用 URLSession 打 supervisor。
        config.userContentController.add(self, name: "a2aControl")
        // ④ 文件保存：面板里的「导出 / 备份」要把文件交给用户存到「文件」。
        //    WKWebView 的下载 API 需要宿主实现整套导航代理才会落盘，这里直接
        //    用 URLSession + 分享面板代劳，少一层 WebKit 行为差异。
        config.userContentController.add(self, name: "a2aFile")

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
        statusBar.layer.cornerRadius = 18
        statusBar.layer.cornerCurve = .continuous
        statusBar.clipsToBounds = true
        statusBar.isHidden = true
        view.addSubview(statusBar)

        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        statusLabel.font = .systemFont(ofSize: 11, weight: .medium)
        // 一行摘要 + 截断：胶囊高度固定，按钮与文字才在同一条基线上（两行文字时
        // 「重试」会被挤得看起来错位）。完整诊断串点开小窗看 —— 见 onStatusTap。
        statusLabel.numberOfLines = 1
        statusLabel.lineBreakMode = .byTruncatingTail
        statusLabel.textColor = .black
        statusLabel.onText = { [weak self] text in
            // 所有状态更新（启动/就绪/出错/诊断串）都经过这一个漏斗，规则集中在
            // presentStatus 里，不必去每个更新点接线，也就不可能漏掉某条路径。
            self?.presentStatus(text)
        }
        statusBar.addSubview(statusLabel)

        retryButton.translatesAutoresizingMaskIntoConstraints = false
        retryButton.setTitle("重试", for: .normal)
        retryButton.titleLabel?.font = .systemFont(ofSize: 12, weight: .semibold)
        retryButton.addTarget(self, action: #selector(onRetry), for: .touchUpInside)
        statusBar.addSubview(retryButton)

        // 点胶囊 = 看完整日志（小窗弹出，不占屏幕）
        let tap = UITapGestureRecognizer(target: self, action: #selector(onStatusTap))
        statusBar.addGestureRecognizer(tap)

        NSLayoutConstraint.activate([
            // 移到**底栏上方**：面板自己的悬浮标签栏贴在底部，状态胶囊浮在它之上，
            // 两者不再抢同一条位置；左右改成 equal（原来 trailing 是 lessThanOrEqual，
            // 胶囊会随文字长度忽长忽短），整条更长、更好点。
            // 真机反馈"太长了，至少缩短一半"：原来左右各 12 铺满一整行，现在改成
            // **居中、最宽约屏幕一半**，宽度由短标题与「重试」按钮的固有尺寸决定。
            statusBar.centerXAnchor.constraint(equalTo: view.safeAreaLayoutGuide.centerXAnchor),
            statusBar.widthAnchor.constraint(lessThanOrEqualTo: view.safeAreaLayoutGuide.widthAnchor, multiplier: 0.55),
            statusBar.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -tabBarClearance),
            statusBar.heightAnchor.constraint(equalToConstant: 40),

            statusLabel.leadingAnchor.constraint(equalTo: statusBar.leadingAnchor, constant: 14),
            statusLabel.trailingAnchor.constraint(equalTo: retryButton.leadingAnchor, constant: -12),
            statusLabel.centerYAnchor.constraint(equalTo: statusBar.centerYAnchor),

            retryButton.trailingAnchor.constraint(equalTo: statusBar.trailingAnchor, constant: -14),
            retryButton.centerYAnchor.constraint(equalTo: statusBar.centerYAnchor),
        ])
        view.bringSubviewToFront(statusBar)
    }

    /// 由状态文本决定胶囊颜色。
    ///
    /// 刻意的折中：Swift 在本地编译不了，所以这次**不给**那些 `statusLabel.text = ...`
    /// 的调用点都加一个色调参数（改动面越大越可能编译不过，而每轮验证要等一次完整的
    /// CI 构建）。改成让 `ToneLabel` 在文本变化时回调，配色只在这一处；
    /// 将来若要更精确，再把色调从调用点显式传下来。
    private func applyTone(for text: String) {
        let tone: UIColor
        if text.contains("失败") || text.contains("错误") || text.contains("— JS —") || text.contains("— supervisor —") {
            tone = .systemRed
        } else if text.contains("正在启动") || text.contains("等待") {
            tone = .systemOrange
        } else {
            tone = .systemYellow
        }
        statusBar.backgroundColor = tone.withAlphaComponent(0.95)
        // 红/橙底比黄底深，用白字更清楚
        statusLabel.textColor = tone == .systemYellow ? .black : .white
    }

    /// 点状态胶囊：把完整诊断串放进一个小窗（可重试、可关闭）
    @objc private func onStatusTap() {
        // 用户点它就是因为还想看 —— 取消自动隐藏，别刚打开就消失
        statusHideTimer?.invalidate()
        statusHideTimer = nil
        // 胶囊里只放短标题，所以完整文本单独存着 —— 点开要看的是完整日志
        let text = statusFullText.isEmpty ? (statusLabel.text ?? "") : statusFullText
        let alert = UIAlertController(
            title: "运行日志",
            message: text.isEmpty ? "（暂无内容）" : text,
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: "重试", style: .default) { [weak self] _ in self?.onRetry() })
        alert.addAction(UIAlertAction(title: "关闭", style: .cancel))
        present(alert, animated: true)
    }

    /// 状态胶囊几秒后自动收起。
    ///
    /// 真机反馈：胶囊一旦出现就**一直挂着**（网关正常时也在最上面占一条），
    /// 希望它像提示条一样看几秒就消失。所以每次状态文本变化都重排一次定时器：
    /// 新的状态会重新显示并重新计时（`statusLabel.text` 的赋值点本来就会
    /// `isHidden = false`），到点就收起。
    ///
    /// 刻意不做"错误时永久保留"：那正好是用户要避免的"一直显示"。需要回看时
    /// 对应的动作（切换面板、重试、下拉）都会重新触发状态，胶囊会再出现一次。
    private func scheduleStatusAutoHide() {
        statusHideTimer?.invalidate()
        statusHideTimer = Timer.scheduledTimer(withTimeInterval: 4.0, repeats: false) { [weak self] _ in
            self?.statusBar.isHidden = true
        }
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
            // `/health` 在**网关**端口（它是网关路由），`/m` 与 `/` 在**面板**端口
            // （开着局域网访问时面板搬到了独立端口）。这里必须分开探，否则
            // `/m` 会打到只挂 /v1 的端口上、必然 404，界面就会误报「网关异常」
            // 并把诊断条顶上来。
            let origin = target == "health" ? baseURL : panelBaseURL
            var request = URLRequest(url: origin.appendingPathComponent(target))
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

            // /m 打不开时，回退到站点根（有些网关把面板挂在 / 上）——
            // 根页也是**面板**端口提供的，所以要跟着面板走。
            if let body = results["/m"], !body.contains("HTTP 200"), !self.triedRootFallback {
                self.triedRootFallback = true
                self.webView.load(URLRequest(url: self.panelBaseURL))
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
    // MARK: - 顶部悬浮 chrome

    /// 顶部悬浮三件套：左胶囊显示构建戳、右两枚圆形图标按钮切换手机/桌面面板。
    ///
    /// 为什么只改外观、不藏导航栏：导航栏负责安全区与内容避让（`viewWillAppear`
    /// 里就是靠它把内容顶开的）。把导航栏藏掉再自己铺一层浮层，Web 内容会钻到
    /// 刘海/状态栏下面；只把它的**外观**改成透明，避让逻辑一行都不用动。
    private func installFloatingChrome() {
        // 透明外观要把每一项都设到位：只调 configureWithTransparentBackground()
        // 而留下 backgroundEffect / shadow，导航栏仍会画出一条底色横条（真机反馈里
        // 顶部那条白底就是这么来的）。所以这里显式清背景色、背景材质与分隔线，
        // 并且**在导航栏与 item 两处都设**（不同滚动态取的那份不一样）。
        let appearance = UINavigationBarAppearance()
        appearance.configureWithTransparentBackground()
        appearance.backgroundColor = .clear
        appearance.backgroundEffect = nil
        appearance.shadowColor = .clear
        appearance.shadowImage = UIImage()
        navigationItem.standardAppearance = appearance
        navigationItem.scrollEdgeAppearance = appearance
        navigationItem.compactAppearance = appearance
        if let bar = navigationController?.navigationBar {
            bar.standardAppearance = appearance
            bar.scrollEdgeAppearance = appearance
            bar.compactAppearance = appearance
            bar.isTranslucent = true
            bar.shadowImage = UIImage()
            bar.setBackgroundImage(UIImage(), for: .default)
        }

        // 顶部**不再**放版本胶囊：操作者明确要求移除（真机上它占着状态栏那一行的宽度）。
        // 版本号仍可在状态胶囊的小窗里看到（buildStamp 未删）。
        // ── 不再把这件挂在导航栏里 ──────────────────────────────
        // 只要导航栏还在（哪怕 Appearance 全透明），系统仍会占掉一条顶部区域、
        // 并在某些滚动态画出一条底色 —— 真机反复反馈的"上面老有一条横条"就是它。
        // 所以改成**悬浮控件**：直接加在页面上，与状态胶囊同一层，页面向后滚到底下。
        // 顶部那枚切换按钮：唯一的悬浮控件（原来挂在导航栏右项上）
        topPanelButton.tintColor = .label
        topPanelButton.backgroundColor = UIColor.secondarySystemBackground.withAlphaComponent(0.75)
        topPanelButton.layer.cornerRadius = 12
        topPanelButton.translatesAutoresizingMaskIntoConstraints = false
        topPanelButton.addTarget(self, action: #selector(togglePanel), for: .touchUpInside)
        updatePanelButton()   // 图标与无障碍标签由它设置（表示"切过去的那一面"）

        view.addSubview(topPanelButton)

        // 顶部只剩这一枚悬浮按钮：贴着安全区右上角，尺寸收到 24（原来 30）。
        NSLayoutConstraint.activate([
            topPanelButton.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -12),
            topPanelButton.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 8),
            topPanelButton.widthAnchor.constraint(equalToConstant: 24),
            topPanelButton.heightAnchor.constraint(equalToConstant: 24),
        ])
        view.bringSubviewToFront(topPanelButton)
        updatePanelButton()
    }

    /// 刷新那枚切换按钮：图标与无障碍标签都表示"切过去的那一面"。
    private func updatePanelButton() {
        topPanelButton.setImage(UIImage(systemName: showingDesktop ? "iphone" : "desktopcomputer"), for: .normal)
        topPanelButton.accessibilityLabel = showingDesktop ? "手机面板" : "桌面面板"
    }

    /// 在两面之间切换。图标/胶囊表达的是"另一面"，所以这里取反。
    @objc private func togglePanel() { switchPanel(desktop: !showingDesktop) }

    /// 切到指定面板。幂等：重复点当前这一面不重载（原来那个 toggle 会白刷一次页面）。
    private func switchPanel(desktop: Bool) {
        guard showingDesktop != desktop else { return }
        showingDesktop = desktop
        updatePanelButton()
        webView.load(URLRequest(url: desktop ? panelBaseURL : panelBaseURL.appendingPathComponent("m")))
    }

    private func reload() {
        // 保留**当前地址**再重载：手机端路由记在 hash 里（`routeFromHash(location.hash)`），
        // 而这里原来硬写加载 `/m`（不带 hash）⇒ 每次重载都把用户甩回首页
        // （前台切回、端口变化、状态刷新都会走到这里）。
        // 只在确实停在手机面板上时才沿用当前 URL；否则（首次加载、加载失败、停在桌面面板）
        // 仍按老规矩去 `/m`，不改变既有行为。
        if let current = webView.url,
           current.path.hasSuffix("/m") || current.path.contains("/m/") {
            webView.load(URLRequest(url: current))
        } else {
            webView.load(URLRequest(url: panelBaseURL.appendingPathComponent("m")))
        }
    }

    /// 问 supervisor 面板现在在哪个端口，必要时跟上并重载。
    ///
    /// 触发时机：① App 前台拉起网关之后（`activateGateway`）；② 面板改了
    /// 局域网开关之后（supervisor 会按新开关重启网关，端口随之变化）。
    /// 端口变成与网关同端口时把 `panelPort` 清回 `nil`（默认形态）。
    ///
    /// - Parameter reloadIfChanged: 端口确实变了才重载，避免无谓地刷白页面
    private func syncPanelPort(reloadIfChanged: Bool, completion: (() -> Void)? = nil) {
        var request = URLRequest(url: supervisorURL.appendingPathComponent("status"))
        request.httpMethod = "GET"
        request.timeoutInterval = 5
        URLSession.shared.dataTask(with: request) { [weak self] data, _, _ in
            DispatchQueue.main.async {
                guard let self else { return }
                var changed = false
                if let data,
                   let json = try? JSONSerialization.jsonObject(with: data),
                   let object = json as? [String: Any],
                   let raw = object["panelPort"] as? NSNumber {
                    let next = UInt16(truncating: raw)
                    let current = self.panelPort ?? self.port
                    if next != current {
                        self.panelPort = (next == self.port) ? nil : next
                        changed = true
                    }
                }
                if changed, reloadIfChanged {
                    self.reload()
                }
                completion?()
            }
        }.resume()
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
                    // 先问清面板当前在哪个端口再加载：开了局域网访问时面板在
                    // 独立端口（3067），照旧连 3065 会打到只挂 /v1 的端口上。
                    self.syncPanelPort(reloadIfChanged: false) { self.reload() }
                } else if !self.appIsActive {
                    self.deactivateGateway()
                } else if PanelViewController.embeddedLinked {
                    // 守护进程没起来，而本包链了内嵌网关 ⇒ 自己把网关跑起来，别再让面板空转。
                    // 场景：重启 / 重新越狱后 launchd 里的注册丢了（App 无权 bootstrap，需 root）。
                    // 端口不冲突：守护进程不在时 3065 本来就空着（它在了上面就成功了）。
                    // 这是**一次性**的退回：本次运行就按内嵌形态走，不再来回切。
                    PanelViewController.backend = .embedded
                    self.startEmbeddedGateway()
                    // 心跳是"向 supervisor 报到"的机制 —— 内嵌形态没有 supervisor，
                    // 起了只会每 5 秒发一次注定失败的请求，所以这里不启。
                    self.needsReloadAfterActivation = false
                    // 也不查 supervisor 的面板端口（`syncPanelPort` 问的就是它）：
                    // 内嵌形态下面板与网关同一个端口，直接加载即可 —— 否则日志里会堆一串
                    // 「supervisor status 失败：请求超时」。
                    self.reload()
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
                        // 形态 A1 的网关由 LaunchDaemon 常驻。**重启手机或重新越狱之后**，launchd 是重开的，
                        // 上一次 deb 安装时注册的作业不在了 ⇒ 这里会一直连不上。此时 App 无权自己 bootstrap
                        // （要 root），只能把该做的事说清楚，别让用户面对一句"未响应"无从下手。
                        text += "\n如果这是重启手机或重新越狱之后：守护进程的注册已丢失，在 Sileo 里把 deb 重装一次即可恢复"
                        text += "（安装脚本会自动重新注册并拉起它）；也可以在终端执行 launchctl bootstrap system "
                        text += "/Library/LaunchDaemons/com.chiyu.agent2api.plist。"
                        text += "\n另一种不依赖守护进程的形态是「独立版 IPA（EMBED=1）」：网关跑在 App 进程内，重启后无需任何操作。"
                        self.activateGateway()
                    }
                    self.statusLabel.text = text
                }
            }
        }.resume()
    }

    // MARK: - 登录器桥（原生侧）

    /// 打开隔离登录容器；成功后由容器自己完成回调并把结果交给网关。
    ///
    /// `gateway:` 传的必须是**面板**端口：容器拿它拼 `api/session/login/callback`，
    /// 而 `/api/*` 由面板监听提供 —— 开了局域网访问后面板在独立端口（3067），
    /// 传网关端口会 404、第三方登录静默失败。
    func openLoginContainer(url: URL, state: String) {
        let vc = LoginContainer(gateway: panelBaseURL, loginURL: url, state: state)
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
            // 只有 `lan` 带参数：给了 enabled 就是写开关，没给就是读
            supervisorCall(op: op, id: id, enabled: body["enabled"] as? Bool)
            return
        }
        if message.name == "a2aFile" {
            if let body = message.body as? [String: Any] {
                handleFileMessage(body)
            }
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
    ///   · `lan`    → 给了 `enabled` 就 POST /lan?enabled=1|0（写开关并按需重启
    ///                网关），没给就 GET /lan（读开关）
    ///   · `factory-reset` → POST /factory-reset（成功后页面回首次注册）
    /// 结果通过 `a2a-control-result` 事件回给 JS（携带调用时的 id 以区分并发调用）。
    func supervisorCall(op: String, id: String, enabled: Bool? = nil) {
        // 路径是**拼**出来的而不是 appendingPathComponent：`/lan?enabled=1` 里的
        // `?` 会被后者百分号编码成 `%3F`，落成一个不存在的路径。
        var path = "/status"
        var method = "GET"
        switch op {
        case "start", "stop", "factory-reset":
            path = "/\(op)"
            method = "POST"
        case "lan":
            if let enabled {
                path = "/lan?enabled=\(enabled ? 1 : 0)"
                method = "POST"
            } else {
                path = "/lan"
            }
        default:
            break
        }
        guard let url = URL(string: "http://127.0.0.1:3066\(path)") else {
            reportSupervisorError(op: op, id: id, message: "控制端口地址非法")
            return
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
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
                if op == "lan" && status == 200 {
                    // supervisor 已按新开关重启网关，面板可能换了端口。先让界面把
                    // 结果提示出来（JS 收到事件才会渲染），一拍之后再同步端口重载，
                    // 否则刚发出的提示会被这次重载立刻抹掉。
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in
                        self?.syncPanelPort(reloadIfChanged: true)
                    }
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

    /// 把 supervisor 的调用结果回给 JS。
    ///
    /// 用 `JSONSerialization` 构造信封，比手工拼字符串再转义安全 —— `payload`
    /// 里带的就是 status JSON，里面有引号和反斜杠，手工拼错一步就回不去。
    private func deliverSupervisorResult(op: String, id: String, ok: Bool, payload: String) {
        let detail: [String: Any] = ["op": op, "id": id, "ok": ok, "payload": payload]
        guard let data = try? JSONSerialization.data(withJSONObject: detail, options: []),
              let js = String(data: data, encoding: .utf8) else { return }
        let body = "window.dispatchEvent(new CustomEvent('a2a-control-result',{detail:\(js)}))"
        webView.evaluateJavaScript(body, completionHandler: nil)
    }
}

// MARK: - 文件保存（a2aFile 桥）

extension PanelViewController {

    /// 处理面板发来的保存请求。
    ///
    /// 两种用法（见 `lib/download.ts` 的说明）：
    ///   · `saveInline`：JS 已拿到字节（导出 JSON 等小文件），base64 传过来；
    ///   · `saveRemote`：备份这类可能几十 MB 的流，由这里带鉴权头自己请求，
    ///     不把整包 base64 塞过 JS 桥。
    func handleFileMessage(_ body: [String: Any]) {
        guard let op = body["op"] as? String else { return }
        let filename = (body["filename"] as? String) ?? "agent2api-export"

        switch op {
        case "saveInline":
            guard let base64 = body["base64"] as? String,
                  let data = Data(base64Encoded: base64) else {
                reportFileError("导出内容不是合法的 base64")
                return
            }
            writeAndPresent(data: data, filename: filename)

        case "saveRemote":
            guard let raw = body["url"] as? String, let target = URL(string: raw) else {
                reportFileError("导出地址非法")
                return
            }
            var request = URLRequest(url: target)
            request.httpMethod = (body["method"] as? String) ?? "GET"
            request.timeoutInterval = 300
            if let headers = body["headers"] as? [String: String] {
                for (key, value) in headers { request.setValue(value, forHTTPHeaderField: key) }
            }
            if let payload = body["body"],
               let data = try? JSONSerialization.data(withJSONObject: payload, options: []) {
                request.httpBody = data
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            }
            URLSession.shared.downloadTask(with: request) { [weak self] location, response, error in
                guard let self else { return }
                if let error {
                    DispatchQueue.main.async { self.reportFileError(error.localizedDescription) }
                    return
                }
                // 非 2xx 时网关返回的是 JSON 错误体，读出来告诉用户，别给一个坏文件
                let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                guard status == 200, let location else {
                    let text = location.flatMap { try? String(contentsOf: $0, encoding: .utf8) } ?? ""
                    DispatchQueue.main.async { self.reportFileError("导出失败：HTTP \(status) \(text)") }
                    return
                }
                let data = (try? Data(contentsOf: location)) ?? Data()
                try? FileManager.default.removeItem(at: location)
                DispatchQueue.main.async { self.writeAndPresent(data: data, filename: filename) }
            }.resume()

        default:
            break
        }
    }

    /// 落临时文件后弹分享面板（用户在那里选「存储到文件」）
    private func writeAndPresent(data: Data, filename: String) {
        let target = FileManager.default.temporaryDirectory
            .appendingPathComponent("agent2api-\(UUID().uuidString)-\(filename)")
        do {
            try data.write(to: target)
        } catch {
            reportFileError("写入临时文件失败：\(error.localizedDescription)")
            return
        }
        let activity = UIActivityViewController(activityItems: [target], applicationActivities: nil)
        if let root = (UIApplication.shared.connectedScenes.first as? UIWindowScene)?.windows.first {
            root.rootViewController?.present(activity, animated: true)
        }
        // 分享结束后清理临时文件（延迟一下，让用户有时间选中「存储到文件」）
        DispatchQueue.main.asyncAfter(deadline: .now() + 600) {
            try? FileManager.default.removeItem(at: target)
        }
    }

    private func reportFileError(_ message: String) {
        jsErrors.append("导出失败：\(message)")
        statusBar.isHidden = false
        statusLabel.text = summary + "\n— 导出 —\n" + jsErrors.joined(separator: "\n")
    }
}
