import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        let window = UIWindow(frame: UIScreen.main.bounds)
        // 形态 A1：后端在 LaunchDaemon 里常驻，App 只是面板客户端。
        // 形态 A2：把下面这行换成 PanelViewController.makeEmbedded()，
        //          由 App 进程内 a2a_start 起网关（见 PanelViewController.isEmbedded）。
        window.rootViewController = UINavigationController(rootViewController: PanelViewController())
        window.makeKeyAndVisible()
        self.window = window
        return true
    }
}
