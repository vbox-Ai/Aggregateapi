// swift-tools-version: 5.9
// Capacitor 6+ 支持 SPM；Capacitor 8 的 iOS 工程两种方式都能接。
import PackageDescription

let package = Package(
    name: "A2ALogin",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "A2ALogin", targets: ["A2ALogin"])
    ],
    dependencies: [
        // 与本工程 mobile/ios 使用的 Capacitor 版本保持一致（8.x）
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "A2ALogin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/A2ALogin"
        )
    ]
)
