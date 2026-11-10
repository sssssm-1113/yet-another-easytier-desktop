import Foundation
import Darwin

@main struct SessionTests {
    static func main() throws {
        if CommandLine.arguments.count > 1 && CommandLine.arguments[1] == "--privileged-session" {
            exit(PrivilegeHelper.run(CommandLine.arguments))
        }
        let fm = FileManager.default
        let root = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("et-test-" + UUID().uuidString)
        try fm.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: root) }
        let environment = ProcessInfo.processInfo.environment
        let realCore = environment["ET_TEST_CORE"]
        let core = realCore.map { URL(fileURLWithPath: $0) } ?? root.appendingPathComponent("fake-core")
        if realCore == nil {
            try "#!/bin/sh\nexec /bin/sleep 300\n".write(to: core, atomically: true, encoding: .utf8)
            try fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: core.path)
        }
        let port = Int(environment["ET_TEST_PORT"] ?? "15888")!
        let instances = root.appendingPathComponent("instances")
        for name in ["one", "two"] {
            let dir = instances.appendingPathComponent(name)
            try fm.createDirectory(at: dir, withIntermediateDirectories: true)
            if let source = environment["ET_TEST_CONFIG"] {
                try fm.copyItem(atPath: source, toPath: dir.appendingPathComponent("config.toml").path)
            } else { try "test".write(to: dir.appendingPathComponent("config.toml"), atomically: true, encoding: .utf8) }
            try Data().write(to: dir.appendingPathComponent("core.log"))
        }
        let session = PrivilegeSession(corePath: core.path, instancesPath: instances.path); session.testing = true
        try session.prepare()
        func start(_ id: String) throws -> Int32 {
            let result = try session.request(["action":"start", "id":id, "port":port + (id == "two" ? 1 : 0), "level":"info"])
            guard let pid = result["pid"] as? Int else { fatalError("start failed: \(result)") }
            return Int32(pid)
        }
        let first = try start("one")
        if let cli = environment["ET_TEST_CLI"] {
            var ready = false
            for _ in 0..<40 {
                let result = Shell.run(cli, ["-p", "127.0.0.1:\(port)", "-o", "json", "peer", "list"], timeout: 2)
                if result["ok"] as? Bool == true { ready = true; break }
                usleep(100_000)
            }
            precondition(ready, "real core RPC did not start")
        }
        let result = try session.request(["action":"stop", "id":"one"])
        precondition(result["ok"] as? Bool == true && !CoreRuntime.processExists(first), "first stop failed")
        let second = try start("one")
        let third = try start("two")
        precondition(second != first && CoreRuntime.processExists(second) && CoreRuntime.processExists(third), "reconnect failed")
        do {
            _ = try session.request(["action":"start", "id":"../bad", "port":port, "level":"info"])
            fatalError("invalid request accepted")
        } catch {}
        let deadline = Date().addingTimeInterval(5)
        while (CoreRuntime.processExists(second) || CoreRuntime.processExists(third)) && Date() < deadline { usleep(50000) }
        precondition(!CoreRuntime.processExists(second) && !CoreRuntime.processExists(third), "helper did not clean up cores after disconnect")
        print("PASS: session reuses authorization, stops cores, rejects invalid request and cleans up")
    }
}
