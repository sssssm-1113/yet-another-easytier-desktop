import Cocoa

if CommandLine.arguments.count > 1 && CommandLine.arguments[1] == "--privileged-session" {
    exit(PrivilegeHelper.run(CommandLine.arguments))
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
