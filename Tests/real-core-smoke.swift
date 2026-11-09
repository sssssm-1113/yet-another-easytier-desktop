import Foundation
import Darwin

@main struct RealCoreSmoke {
    static func main() throws {
        let args = CommandLine.arguments
        let core = args[1], cli = args[2], dir = URL(fileURLWithPath: args[3]), port = Int(args[4])!
        setenv("ET_MACHINE_ID", UUID().uuidString, 1)
        let config = dir.appendingPathComponent("smoke.toml")
        let log = dir.appendingPathComponent("core.log")
        FileManager.default.createFile(atPath: log.path, contents: nil)
        let simulatedElevation = args.contains("--simulate-elevated")
        let runner: ((String) -> [String: Any])? = simulatedElevation ? { command in
            let script = CoreRuntime.administratorScript(command).replacingOccurrences(of: " with administrator privileges", with: "")
            return Shell.run("/usr/bin/osascript", ["-e", script], timeout: 15)
        } : nil
        let runtime = CoreRuntime(profileId: "real-smoke", corePath: core, configPath: config.path,
                                  logPath: log.path, rpcPort: port, logLevel: "info", elevated: simulatedElevation,
                                  privilegedRunner: runner)
        try runtime.queue.sync { try runtime.start() }
        defer { try? runtime.queue.sync { try runtime.stop() } }
        var peers: [String: Any] = [:]
        for _ in 0..<40 {
            peers = Shell.run(cli, ["-p", "127.0.0.1:\(port)", "-o", "json", "peer", "list"], timeout: 2)
            if peers["ok"] as? Bool == true { break }
            usleep(100_000)
        }
        guard peers["ok"] as? Bool == true else { fatalError("Real peer RPC failed: \(peers)") }
        let routes = Shell.run(cli, ["-p", "127.0.0.1:\(port)", "-o", "json", "route", "list"], timeout: 2)
        guard routes["ok"] as? Bool == true else { fatalError("Real route RPC failed: \(routes)") }
        try (peers["stdout"] as! String).write(to: dir.appendingPathComponent("peers.json"), atomically: true, encoding: .utf8)
        try (routes["stdout"] as! String).write(to: dir.appendingPathComponent("routes.json"), atomically: true, encoding: .utf8)
        print("Real peer JSON:", peers["stdout"] as! String)
        print("Real route JSON:", routes["stdout"] as! String)
        try runtime.queue.sync { try runtime.stop() }
        let stopped = Shell.run(cli, ["-p", "127.0.0.1:\(port)", "-o", "json", "peer", "list"], timeout: 1)
        guard stopped["ok"] as? Bool != true else { fatalError("RPC still accessible after stop") }
        print("Real core start / peer RPC / route RPC / confirmed stop: PASS")
    }
}
