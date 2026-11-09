import Foundation
import Darwin

enum Shell {
    static func run(_ path: String, _ args: [String], timeout: TimeInterval? = 5) -> [String: Any] {
        // Files cannot fill a pipe or keep an EOF reader blocked when a child forks.
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("easytier-command-" + UUID().uuidString)
        let p = Process()
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: false,
                                                   attributes: [.posixPermissions: 0o700])
            defer { try? FileManager.default.removeItem(at: dir) }
            let outURL = dir.appendingPathComponent("stdout")
            let errURL = dir.appendingPathComponent("stderr")
            FileManager.default.createFile(atPath: outURL.path, contents: nil, attributes: [.posixPermissions: 0o600])
            FileManager.default.createFile(atPath: errURL.path, contents: nil, attributes: [.posixPermissions: 0o600])
            let out = try FileHandle(forWritingTo: outURL)
            let err = try FileHandle(forWritingTo: errURL)
            defer { try? out.close(); try? err.close() }
            p.executableURL = URL(fileURLWithPath: path)
            p.arguments = args
            var env = ProcessInfo.processInfo.environment
            env["PATH"] = (env["PATH"] ?? "") + ":/opt/homebrew/bin:/usr/local/bin"
            p.environment = env
            p.standardOutput = out
            p.standardError = err
            p.standardInput = FileHandle.nullDevice
            try p.run()
            let deadline = timeout.map { Date().addingTimeInterval($0) } ?? Date.distantFuture
            while p.isRunning && Date() < deadline { usleep(20_000) }
            if p.isRunning {
                p.terminate()
                let grace = Date().addingTimeInterval(0.5)
                while p.isRunning && Date() < grace { usleep(20_000) }
                if p.isRunning { kill(p.processIdentifier, SIGKILL) }
                p.waitUntilExit()
                return ["error": "命令超时", "status": -1]
            }
            return ["ok": p.terminationStatus == 0, "status": Int(p.terminationStatus),
                    "stdout": String(decoding: try Data(contentsOf: outURL), as: UTF8.self),
                    "stderr": String(decoding: try Data(contentsOf: errURL), as: UTF8.self)]
        } catch {
            return ["error": error.localizedDescription, "status": -1]
        }
    }
}
