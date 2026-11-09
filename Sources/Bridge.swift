import Cocoa
import WebKit
import ServiceManagement

final class Bridge: NSObject, WKScriptMessageHandler {
    weak var webView: WKWebView?
    weak var statusBar: StatusBarController?
    var keepInMenuBar = true

    private let fm = FileManager.default
    private let supportURL: URL
    private let instancesURL: URL
    private var runtimes: [String: CoreRuntime] = [:]

    override init() {
        let defaultBase = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
            .appendingPathComponent("EasyTier Desktop", isDirectory: true)
        let base = ProcessInfo.processInfo.environment["ET_DATA_DIR"].map { URL(fileURLWithPath: $0, isDirectory: true) } ?? defaultBase
        supportURL = base
        instancesURL = base.appendingPathComponent("instances", isDirectory: true)
        super.init()
        try? fm.createDirectory(at: instancesURL, withIntermediateDirectories: true)
    }

    convenience init(webView: WKWebView) {
        self.init()
        self.webView = webView
    }

    // MARK: - Message handling

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "et",
              let body = message.body as? [String: Any],
              let cmd = body["cmd"] as? String else { return }
        let id = body["id"] as? Int ?? 0

        switch cmd {
        case "init":
            respond(id, initPayload())
        case "loadState":
            respond(id, ["data": loadState() ?? NSNull()])
        case "saveState":
            respond(id, ["ok": saveState(body["data"] as? String ?? "")])
        case "startCore":
            startCore(body, id: id)
        case "stopCore":
            let pid = body["profileId"] as? String ?? ""
            stopCore(pid, id: id)
        case "cli":
            runCLI(body, id: id)
        case "readLog":
            readLog(body, id: id)
        case "chooseBinary":
            chooseBinary(body, id: id)
        case "setLoginItem":
            setLoginItem(body, id: id)
        case "openFolder":
            NSWorkspace.shared.open(supportURL)
            respond(id, ["ok": true])
        case "openInstanceFolder":
            let pid = body["profileId"] as? String ?? ""
            NSWorkspace.shared.open(instancesURL.appendingPathComponent(pid))
            respond(id, ["ok": true])
        case "exportConfig":
            exportConfig(body, id: id)
        case "importConfig":
            importConfig(id: id)
        case "openExternal":
            if let str = body["url"] as? String, let url = URL(string: str),
               ["http", "https"].contains(url.scheme ?? "") {
                NSWorkspace.shared.open(url)
            }
            respond(id, ["ok": true])
        case "setKeepInMenuBar":
            keepInMenuBar = (body["value"] as? Bool) ?? true
            statusBar?.setVisible(keepInMenuBar)
            respond(id, ["ok": true])
        case "updateMenu":
            updateMenu(body)
            respond(id, ["ok": true])
        case "quit":
            NSApp.terminate(nil)
        case "log":
            print("[UI] \(body["message"] ?? "")")
            respond(id, ["ok": true])
        default:
            respond(id, ["error": "unknown command: \(cmd)"])
        }
    }

    // MARK: - Payloads

    private func initPayload() -> [String: Any] {
        let core = corePath
        let cli = cliPath
        let loginItem = SMAppService.mainApp.status == .enabled
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0.1"
        return [
            "supportDir": supportURL.path,
            "coreAvailable": core != nil,
            "cliAvailable": cli != nil,
            "coreVersion": core.map { BinaryLocator.version(of: $0) } ?? "",
            "cliVersion": cli.map { BinaryLocator.version(of: $0) } ?? "",
            "corePath": core ?? "",
            "cliPath": cli ?? "",
            "loginItem": loginItem,
            "appVersion": version,
            "hostname": Host.current().localizedName ?? "Mac",
            "os": ProcessInfo.processInfo.operatingSystemVersionString
        ]
    }

    private func respond(_ id: Int, _ payload: [String: Any]) {
        guard let webView else { return }
        guard JSONSerialization.isValidJSONObject(payload),
              let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.__etResolve(\(id), \(json));", completionHandler: nil)
    }

    func emit(_ name: String, _ payload: [String: Any]) {
        guard let webView else { return }
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.__etEvent(\"\(name)\", \(json));", completionHandler: nil)
    }

    // MARK: - State persistence

    private var stateURL: URL { supportURL.appendingPathComponent("state.json") }

    private func loadState() -> String? {
        guard let data = try? Data(contentsOf: stateURL) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private func saveState(_ json: String) -> Bool {
        do {
            try json.write(to: stateURL, atomically: true, encoding: .utf8)
            try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: stateURL.path)
            return true
        } catch {
            return false
        }
    }

    // MARK: - Binaries

    private var corePath: String? { BinaryLocator.find("easytier-core", override: UserDefaults.standard.string(forKey: "corePath") ?? "") }
    private var cliPath: String? { BinaryLocator.find("easytier-cli", override: UserDefaults.standard.string(forKey: "cliPath") ?? "") }

    private func chooseBinary(_ body: [String: Any], id: Int) {
        let kind = body["kind"] as? String ?? "core"
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        panel.message = "选择 \(kind == "core" ? "easytier-core" : "easytier-cli") 可执行文件"
        panel.prompt = "选择"
        if panel.runModal() == .OK, let url = panel.url {
            UserDefaults.standard.set(url.path, forKey: kind == "core" ? "corePath" : "cliPath")
            if kind == "core" {
                let sibling = url.deletingLastPathComponent().appendingPathComponent("easytier-cli").path
                if fm.isExecutableFile(atPath: sibling) {
                    UserDefaults.standard.set(sibling, forKey: "cliPath")
                }
            }
            respond(id, ["ok": true, "path": url.path])
        } else {
            respond(id, ["ok": false])
        }
    }

    // MARK: - Core process

    private func startCore(_ body: [String: Any], id: Int) {
        guard let profileId = body["profileId"] as? String,
              let config = body["config"] as? String,
              profileId.range(of: "^[A-Za-z0-9-]{1,128}$", options: .regularExpression) != nil,
              let sessionId = body["sessionId"] as? String,
              let rpcPort = body["rpcPort"] as? Int, (1024...65535).contains(rpcPort) else {
            respond(id, ["error": "参数缺失"])
            return
        }
        guard let core = corePath else {
            respond(id, ["error": "未找到 easytier-core"])
            return
        }
        guard runtimes[profileId] == nil else {
            respond(id, ["error": "此网络仍有核心实例，请先确认断开后再连接"])
            return
        }
        let elevated = (body["elevated"] as? Bool) ?? false
        let logLevel = (body["logLevel"] as? String) ?? "info"

        let dir = instancesURL.appendingPathComponent(profileId, isDirectory: true)
        let configURL = dir.appendingPathComponent("config.toml")
        let logURL = dir.appendingPathComponent("core.log")
        do {
            try fm.createDirectory(at: dir, withIntermediateDirectories: true)
            try config.write(to: configURL, atomically: true, encoding: .utf8)
            try? fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: configURL.path)
            try Data().write(to: logURL)
            try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: logURL.path)
        } catch {
            respond(id, ["error": error.localizedDescription])
            return
        }

        let runtime = CoreRuntime(profileId: profileId, corePath: core, configPath: configURL.path, logPath: logURL.path, rpcPort: rpcPort, logLevel: logLevel, elevated: elevated)
        runtime.onExit = { [weak self, weak runtime] code in
            DispatchQueue.main.async {
                guard let self, let runtime, self.runtimes[profileId] === runtime else { return }
                self.runtimes[profileId] = nil
                self.emit("coreExit", ["id": profileId, "sessionId": sessionId, "code": Int(code)])
            }
        }
        runtimes[profileId] = runtime
        runtime.queue.async { [weak self] in
            do {
                try runtime.start()
                DispatchQueue.main.async { self?.respond(id, ["ok": true, "sessionId": sessionId]) }
            } catch {
                DispatchQueue.main.async {
                    if self?.runtimes[profileId] === runtime { self?.runtimes[profileId] = nil }
                    self?.respond(id, ["error": error.localizedDescription])
                }
            }
        }
    }

    private func stopCore(_ profileId: String, id: Int) {
        guard let runtime = runtimes[profileId] else {
            respond(id, ["ok": true])
            return
        }
        // This queues behind start, including any pending administrator authorization.
        runtime.queue.async { [weak self] in
            do {
                try runtime.stop()
                DispatchQueue.main.async {
                    if self?.runtimes[profileId] === runtime { self?.runtimes[profileId] = nil }
                    self?.respond(id, ["ok": true])
                }
            } catch {
                DispatchQueue.main.async { self?.respond(id, ["error": error.localizedDescription]) }
            }
        }
    }

    private func runCLI(_ body: [String: Any], id: Int) {
        guard let cli = cliPath else {
            respond(id, ["error": "未找到 easytier-cli"])
            return
        }
        let args = (body["args"] as? [String]) ?? []
        let timeout = (body["timeout"] as? Double) ?? 5

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let result = Shell.run(cli, args, timeout: timeout)
            DispatchQueue.main.async {
                self?.respond(id, result)
            }
        }
    }

    private func readLog(_ body: [String: Any], id: Int) {
        guard let profileId = body["profileId"] as? String,
              profileId.range(of: "^[A-Za-z0-9-]{1,128}$", options: .regularExpression) != nil else {
            respond(id, ["error": "参数缺失或无效"])
            return
        }
        let offset = (body["offset"] as? Int) ?? 0
        let url = instancesURL.appendingPathComponent(profileId).appendingPathComponent("core.log")
        respond(id, LogReader.read(url, offset: offset))
    }

    // MARK: - Login item

    private func setLoginItem(_ body: [String: Any], id: Int) {
        let enabled = (body["enabled"] as? Bool) ?? false
        do {
            if enabled {
                if SMAppService.mainApp.status != .enabled { try SMAppService.mainApp.register() }
            } else {
                if SMAppService.mainApp.status == .enabled { try SMAppService.mainApp.unregister() }
            }
            respond(id, ["ok": true, "enabled": SMAppService.mainApp.status == .enabled])
        } catch {
            respond(id, ["error": error.localizedDescription, "enabled": SMAppService.mainApp.status == .enabled])
        }
    }

    // MARK: - Files

    private func exportConfig(_ body: [String: Any], id: Int) {
        let filename = body["filename"] as? String ?? "config.toml"
        let content = body["content"] as? String ?? ""
        let panel = NSSavePanel()
        panel.nameFieldStringValue = filename
        panel.prompt = "导出"
        panel.message = "导出 EasyTier 配置文件"
        if panel.runModal() == .OK, let url = panel.url {
            do {
                try content.write(to: url, atomically: true, encoding: .utf8)
                respond(id, ["ok": true, "path": url.path])
            } catch {
                respond(id, ["error": error.localizedDescription])
            }
        } else {
            respond(id, ["ok": false])
        }
    }

    private func importConfig(id: Int) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.allowedContentTypes = []
        panel.allowsMultipleSelection = false
        panel.message = "选择 EasyTier 配置文件（.toml）"
        panel.prompt = "导入"
        if panel.runModal() == .OK, let url = panel.url {
            do {
                let attrs = try fm.attributesOfItem(atPath: url.path)
                if let size = attrs[.size] as? Int, size > 2_000_000 {
                    respond(id, ["error": "文件过大"])
                    return
                }
                let text = try String(contentsOf: url, encoding: .utf8)
                respond(id, ["ok": true, "name": url.deletingPathExtension().lastPathComponent, "content": text])
            } catch {
                respond(id, ["error": error.localizedDescription])
            }
        } else {
            respond(id, ["ok": false])
        }
    }

    // MARK: - Menu

    private func updateMenu(_ body: [String: Any]) {
        let raw = (body["networks"] as? [[String: Any]]) ?? []
        let demo = (body["demo"] as? Bool) ?? true
        let list = raw.map { item -> (id: String, name: String, status: String) in
            (item["id"] as? String ?? "", item["name"] as? String ?? "网络", item["status"] as? String ?? "stopped")
        }
        statusBar?.update(networks: list, demo: demo)
    }

    var hasActiveRuntimes: Bool { !runtimes.isEmpty }

    func shutdown(completion: @escaping (String?) -> Void) {
        guard let (id, runtime) = runtimes.first else { completion(nil); return }
        runtime.queue.async { [weak self] in
            do {
                try runtime.stop()
                DispatchQueue.main.async {
                    guard let self else { completion(nil); return }
                    if self.runtimes[id] === runtime { self.runtimes[id] = nil }
                    self.shutdown(completion: completion)
                }
            } catch {
                DispatchQueue.main.async { completion(error.localizedDescription) }
            }
        }
    }
}

// MARK: - Binary lookup

enum BinaryLocator {
    static func find(_ name: String, override: String = "") -> String? {
        let fm = FileManager.default
        var candidates: [String] = []
        if !override.isEmpty {
            var isDir: ObjCBool = false
            if fm.fileExists(atPath: override, isDirectory: &isDir), isDir.boolValue {
                candidates.append((override as NSString).appendingPathComponent(name))
            } else {
                candidates.append(override)
            }
        }
        if let resources = Bundle.main.resourceURL {
            candidates.append(resources.appendingPathComponent("bin/\(name)").path)
        }
        candidates.append(contentsOf: [
            "/opt/homebrew/bin/\(name)",
            "/usr/local/bin/\(name)",
            "/usr/bin/\(name)",
            ("~/.cargo/bin/\(name)" as NSString).expandingTildeInPath,
            "/Applications/EasyTier.app/Contents/MacOS/\(name)",
            "/Applications/EasyTier.app/Contents/Resources/\(name)",
            "/Applications/EasyTier.app/Contents/Resources/bin/\(name)"
        ])
        if let path = ProcessInfo.processInfo.environment["PATH"] {
            for dir in path.split(separator: ":") {
                candidates.append("\(dir)/\(name)")
            }
        }
        return candidates.first { fm.isExecutableFile(atPath: $0) }
    }

    static func version(of path: String) -> String {
        let result = Shell.run(path, ["--version"], timeout: 1.5)
        let text = (result["stdout"] as? String) ?? ""
        let err = (result["stderr"] as? String) ?? ""
        let merged = text.isEmpty ? err : text
        return merged.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
