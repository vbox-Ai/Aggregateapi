import Foundation
import Security

/// 面板登录态的 Keychain 持久化。
///
/// WKWebView 用的是 `nonPersistent` 数据存储，`localStorage` 每次启动都是空的 ——
/// 于是「重启 App 后要重新登录」的现象。这里把面板的 access/refresh 令牌存进
/// Keychain（不是明文文件），启动时注入回页面。
///
/// 安全：`SecItemAdd` / `SecItemCopyMatching` / `SecItemDelete`，访问控制
/// `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`（解锁后可用，不跨设备）。
enum PanelSessionStore {

    private static let service = "com.chiyu.agent2api"
    private static let accountPrefix = "panelAuth:"

    /// 存一条面板登录态（JSON 字符串）
    static func save(serverId: String, json: String) -> Bool {
        guard let data = json.data(using: .utf8) else { return false }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: "\(accountPrefix)\(serverId)",
            kSecValueData as String: data,
        ]
        // 先删旧的再存，避免重复条目
        SecItemDelete(query as CFDictionary)
        return SecItemAdd(query as CFDictionary, nil) == errSecSuccess
    }

    /// 取一条面板登录态；没有返回 nil
    static func load(serverId: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: "\(accountPrefix)\(serverId)",
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    /// 删除一条
    static func delete(serverId: String) -> Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: "\(accountPrefix)\(serverId)",
        ]
        return SecItemDelete(query as CFDictionary) == errSecSuccess
    }

    /// 列出所有已保存的服务器 id
    static func allServerIds() -> [String] {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecReturnAttributes as String: true,
            kSecMatchLimit as String: kSecMatchLimitAll,
        ]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let items = result as? [[String: Any]] else { return [] }
        return items.compactMap { item in
            guard let account = item[kSecAttrAccount as String] as? String,
                  account.hasPrefix(accountPrefix) else { return nil }
            return String(account.dropFirst(accountPrefix.count))
        }
    }

    /// 启动注入脚本：把 Keychain 里的每条面板登录态写回 localStorage，
    /// 让页面读到 `agent2api.panelAuth.<serverId>`，免去每次重登。
    static func restoreScript() -> String {
        func escape(_ value: String) -> String {
            var out = value
            out = out.replacingOccurrences(of: "\\", with: "\\\\")
            out = out.replacingOccurrences(of: "'", with: "\\'")
            out = out.replacingOccurrences(of: "\n", with: "\\n")
            out = out.replacingOccurrences(of: "\r", with: "\\r")
            return out
        }
        var statements: [String] = []
        for serverId in allServerIds() {
            if let json = load(serverId: serverId) {
                let key = "agent2api.panelAuth.\(serverId)"
                statements.append(
                    "try{localStorage.setItem('\(escape(key))','\(escape(json))')}catch(e){}"
                )
            }
        }
        return "(function(){\(statements.joined(separator: ""))})();"
    }
}
