import Cocoa
import WebKit
import ServiceManagement

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    var bridge: Bridge!
    var statusBar: StatusBarController!

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()
        buildWindow()
        buildStatusBar()

        if let url = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "ui") {
            webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        } else if let url = Bundle.main.url(forResource: "index", withExtension: "html") {
            webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        } else {
            let html = "<h1 style='font-family:-apple-system;padding:40px'>UI bundle missing</h1>"
            webView.loadHTMLString(html, baseURL: nil)
        }

        NSApp.activate(ignoringOtherApps: true)

        if let path = ProcessInfo.processInfo.environment["ET_SNAPSHOT"] {
            DispatchQueue.main.asyncAfter(deadline: .now() + 4.2) {
                let cfg = WKSnapshotConfiguration()
                cfg.rect = self.webView.bounds
                self.webView.takeSnapshot(with: cfg) { image, _ in
                    if let image, let tiff = image.tiffRepresentation,
                       let rep = NSBitmapImageRep(data: tiff),
                       let png = rep.representation(using: .png, properties: [:]) {
                        try? png.write(to: URL(fileURLWithPath: path))
                        print("snapshot written: \(path)")
                    }
                    if ProcessInfo.processInfo.environment["ET_QUIT"] == "1" {
                        NSApp.terminate(nil)
                    }
                }
            }
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { showWindow() }
        return true
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard let bridge, bridge.hasActiveRuntimes else { return .terminateNow }
        bridge.shutdown { error in
            if let error {
                let alert = NSAlert()
                alert.messageText = "核心尚未停止，已取消退出"
                alert.informativeText = error
                alert.runModal()
            }
            sender.reply(toApplicationShouldTerminate: error == nil)
        }
        return .terminateLater
    }

    // MARK: - Window

    private func buildWindow() {
        let visible = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let width = min(1320, max(1120, visible.width - 80))
        let height = min(860, max(720, visible.height - 60))
        let rect = NSRect(x: 0, y: 0, width: width, height: height)
        window = NSWindow(
            contentRect: rect,
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.isReleasedWhenClosed = false
        window.title = "EasyTier"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.isMovableByWindowBackground = true
        window.minSize = NSSize(width: 1120, height: 720)
        window.backgroundColor = .windowBackgroundColor
        window.delegate = self
        window.setFrameAutosaveName("EasyTierMainWindow")
        window.center()

        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        config.suppressesIncrementalRendering = false
        if let preview = ProcessInfo.processInfo.environment["ET_PREVIEW"] {
            let script = WKUserScript(source: "window.__ET_PREVIEW = \(preview);", injectionTime: .atDocumentStart, forMainFrameOnly: true)
            config.userContentController.addUserScript(script)
        }

        bridge = Bridge()
        config.userContentController.add(bridge, name: "et")

        webView = WKWebView(frame: rect, configuration: config)
        webView.autoresizingMask = [.width, .height]
        webView.setValue(false, forKey: "drawsBackground")
        webView.allowsBackForwardNavigationGestures = false
        webView.allowsMagnification = false
        webView.allowsLinkPreview = false
        webView.uiDelegate = self
        bridge.webView = webView

        let container = NSView(frame: rect)
        container.autoresizingMask = [.width, .height]
        webView.frame = container.bounds
        webView.autoresizingMask = [.width, .height]
        container.addSubview(webView)

        let strip = DragStripView(frame: NSRect(x: 92, y: rect.height - 28, width: rect.width - 92, height: 28))
        strip.autoresizingMask = [.width, .minYMargin]
        container.addSubview(strip)

        window.contentView = container
        window.makeKeyAndOrderFront(nil)
    }

    func showWindow() {
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        if let path = ProcessInfo.processInfo.environment["ET_SNAPSHOT"] {
            DispatchQueue.main.asyncAfter(deadline: .now() + 4.2) {
                let cfg = WKSnapshotConfiguration()
                cfg.rect = self.webView.bounds
                self.webView.takeSnapshot(with: cfg) { image, _ in
                    if let image, let tiff = image.tiffRepresentation,
                       let rep = NSBitmapImageRep(data: tiff),
                       let png = rep.representation(using: .png, properties: [:]) {
                        try? png.write(to: URL(fileURLWithPath: path))
                        print("snapshot written: \(path)")
                    }
                    if ProcessInfo.processInfo.environment["ET_QUIT"] == "1" {
                        NSApp.terminate(nil)
                    }
                }
            }
        }
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if bridge.keepInMenuBar {
            sender.orderOut(nil)
            return false
        }
        return true
    }

    // MARK: - Status bar

    private func buildStatusBar() {
        statusBar = StatusBarController(bridge: bridge)
        bridge.statusBar = statusBar
    }

    // MARK: - Main menu

    private func buildMenu() {
        let mainMenu = NSMenu()

        let appItem = NSMenuItem()
        mainMenu.addItem(appItem)
        let appMenu = NSMenu()
        appItem.submenu = appMenu

        let about = NSMenuItem(title: "关于 EasyTier", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(about)
        appMenu.addItem(NSMenuItem.separator())
        let settings = NSMenuItem(title: "设置…", action: #selector(openSettings), keyEquivalent: ",")
        settings.target = self
        appMenu.addItem(settings)
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(NSMenuItem(title: "隐藏 EasyTier", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h"))
        let hideOthers = NSMenuItem(title: "隐藏其他", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(hideOthers)
        appMenu.addItem(NSMenuItem(title: "显示全部", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: ""))
        appMenu.addItem(NSMenuItem.separator())
        let quit = NSMenuItem(title: "退出 EasyTier", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appMenu.addItem(quit)

        let editItem = NSMenuItem()
        mainMenu.addItem(editItem)
        let editMenu = NSMenu(title: "编辑")
        editItem.submenu = editMenu
        editMenu.addItem(withTitle: "撤销", action: Selector(("undo:")), keyEquivalent: "z")
        let redo = editMenu.addItem(withTitle: "重做", action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        editMenu.addItem(NSMenuItem.separator())
        editMenu.addItem(withTitle: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "拷贝", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")

        let windowItem = NSMenuItem()
        mainMenu.addItem(windowItem)
        let windowMenu = NSMenu(title: "窗口")
        windowItem.submenu = windowMenu
        windowMenu.addItem(withTitle: "最小化", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "缩放", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        windowMenu.addItem(NSMenuItem.separator())
        windowMenu.addItem(withTitle: "关闭窗口", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")

        NSApp.mainMenu = mainMenu
        NSApp.windowsMenu = windowMenu
    }

    @objc private func openSettings() {
        bridge.emit("navigate", ["view": "settings"])
        showWindow()
    }
}

// MARK: - WKUIDelegate

extension AppDelegate: WKUIDelegate {
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.alertStyle = .warning
        alert.addButton(withTitle: "确定")
        alert.addButton(withTitle: "取消")
        completionHandler(alert.runModal() == .alertFirstButtonReturn)
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "好")
        alert.runModal()
        completionHandler()
    }
}

final class DragStripView: NSView {
    override var mouseDownCanMoveWindow: Bool { true }

    override func mouseDown(with event: NSEvent) {
        if event.clickCount == 2 {
            window?.zoom(nil)
        } else {
            window?.performDrag(with: event)
        }
    }
}

// MARK: - Menu bar item

final class StatusBarController: NSObject {
    private let statusItem: NSStatusItem
    private weak var bridge: Bridge?
    private var networks: [(id: String, name: String, status: String)] = []
    private var demo = true

    init(bridge: Bridge) {
        self.bridge = bridge
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        super.init()

        if let button = statusItem.button {
            let img = NSImage(systemSymbolName: "point.3.connected.trianglepath.dotted", accessibilityDescription: "EasyTier")
            img?.isTemplate = true
            button.image = img
            button.toolTip = "EasyTier"
        }
        rebuildMenu()
    }

    func setVisible(_ visible: Bool) {
        statusItem.isVisible = visible
    }

    func update(networks: [(id: String, name: String, status: String)], demo: Bool) {
        self.networks = networks
        self.demo = demo
        rebuildMenu()
        if let button = statusItem.button {
            let connected = networks.contains { $0.status == "running" }
            let img = NSImage(systemSymbolName: "point.3.connected.trianglepath.dotted", accessibilityDescription: "EasyTier")
            img?.isTemplate = true
            button.image = img
            button.toolTip = connected ? "EasyTier · 已连接" : "EasyTier · 未连接"
        }
    }

    private func rebuildMenu() {
        let menu = NSMenu()

        let header = NSMenuItem(title: demo ? "EasyTier · 演示模式" : "EasyTier", action: nil, keyEquivalent: "")
        header.isEnabled = false
        menu.addItem(header)
        menu.addItem(NSMenuItem.separator())

        if networks.isEmpty {
            let empty = NSMenuItem(title: "暂无网络", action: nil, keyEquivalent: "")
            empty.isEnabled = false
            menu.addItem(empty)
        } else {
            for net in networks {
                let title: String
                switch net.status {
                case "running": title = "\(net.name)  ·  已连接"
                case "connecting": title = "\(net.name)  ·  连接中"
                case "failed": title = "\(net.name)  ·  失败"
                default: title = "\(net.name)  ·  未连接"
                }
                let item = NSMenuItem(title: title, action: #selector(toggleNetwork(_:)), keyEquivalent: "")
                item.target = self
                item.representedObject = net.id
                item.state = net.status == "running" ? .on : .off
                menu.addItem(item)
            }
        }

        menu.addItem(NSMenuItem.separator())
        let open = NSMenuItem(title: "打开 EasyTier", action: #selector(openWindow), keyEquivalent: "")
        open.target = self
        menu.addItem(open)

        let settings = NSMenuItem(title: "设置…", action: #selector(openSettings), keyEquivalent: "")
        settings.target = self
        menu.addItem(settings)

        menu.addItem(NSMenuItem.separator())
        let quit = NSMenuItem(title: "退出 EasyTier", action: #selector(quit), keyEquivalent: "")
        quit.target = self
        menu.addItem(quit)

        statusItem.menu = menu
    }

    @objc private func toggleNetwork(_ sender: NSMenuItem) {
        guard let id = sender.representedObject as? String else { return }
        bridge?.emit("menuAction", ["action": "toggle", "id": id])
    }

    @objc private func openWindow() {
        bridge?.emit("menuAction", ["action": "open"])
        if let app = NSApp.delegate as? AppDelegate { app.showWindow() }
    }

    @objc private func openSettings() {
        bridge?.emit("navigate", ["view": "settings"])
        if let app = NSApp.delegate as? AppDelegate { app.showWindow() }
    }

    @objc private func quit() {
        NSApp.terminate(nil)
    }
}
