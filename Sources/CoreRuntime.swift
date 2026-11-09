import Foundation
import Darwin

final class CoreRuntime {
    let queue = DispatchQueue(label: "EasyTier.core." + UUID().uuidString)
    let profileId: String
    let corePath: String
    let configPath: String
    let logPath: String
    let rpcPort: Int
    let logLevel: String
    let elevated: Bool
    var onExit: ((Int32) -> Void)?

    private var process: Process?
    private var pid: Int32?
    private var signature: String?
    private var logHandle: FileHandle?
    private var monitor: DispatchSourceTimer?
    private var finished = false
    private let privilegedRunner: (String) -> [String: Any]

    init(profileId: String, corePath: String, configPath: String, logPath: String,
         rpcPort: Int, logLevel: String, elevated: Bool,
         privilegedRunner: ((String) -> [String: Any])? = nil) {
        self.profileId = profileId
        self.corePath = corePath
        self.configPath = configPath
        self.logPath = logPath
        self.rpcPort = rpcPort
        self.logLevel = logLevel
        self.elevated = elevated
        self.privilegedRunner = privilegedRunner ?? { command in
            return Shell.run("/usr/bin/osascript", ["-e", Self.administratorScript(command)], timeout: nil)
        }
    }

    static func administratorScript(_ command: String) -> String {
        let escaped = command.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "\n", with: "\\n")
        return "do shell script \"\(escaped)\" with administrator privileges"
    }

    static func quote(_ s: String) -> String { "'" + s.replacingOccurrences(of: "'", with: "'\\''") + "'" }

    var launchCommand: String {
        // Only the simple nohup command is backgrounded; its PID survives exec into core.
        let dir = (configPath as NSString).deletingLastPathComponent
        return "cd \(Self.quote(dir)) || exit 1; /usr/bin/nohup /usr/bin/env \(Self.quote("RUST_LOG=" + logLevel)) \(Self.quote(corePath)) -c \(Self.quote(configPath)) --rpc-portal 127.0.0.1:\(rpcPort) >> \(Self.quote(logPath)) 2>&1 < /dev/null & echo $!"
    }

    static func processExists(_ pid: Int32) -> Bool {
        guard pid > 1 else { return false }
        return kill(pid, 0) == 0 || errno == EPERM
    }

    private static func processSignature(_ pid: Int32) -> String? {
        guard processExists(pid) else { return nil }
        let state = Shell.run("/bin/ps", ["-p", String(pid), "-o", "stat="])
        guard let stat = state["stdout"] as? String, !stat.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !stat.contains("Z") else { return nil }
        let result = Shell.run("/bin/ps", ["-p", String(pid), "-o", "lstart=", "-o", "command="])
        guard result["ok"] as? Bool == true, let text = result["stdout"] as? String else { return nil }
        return text.trimmingCharacters(in: .newlines)
    }

    private func isAlive() -> Bool {
        if let process { return process.isRunning }
        guard let pid, let signature else { return false }
        return Self.processSignature(pid) == signature
    }

    func start() throws {
        if elevated {
            let result = privilegedRunner(launchCommand)
            try check(result, fallback: "管理员授权失败或已取消")
            guard let text = result["stdout"] as? String,
                  let launchedPID = Int32(text.trimmingCharacters(in: .whitespacesAndNewlines)), launchedPID > 1 else {
                throw failure("未取得核心进程号")
            }
            pid = launchedPID
            // Allow nohup/env to exec before recording the executable identity.
            usleep(200_000)
            signature = Self.processSignature(launchedPID)
            guard signature != nil else { throw failure("核心启动后立即退出，请查看运行日志") }
        } else {
            let p = Process()
            p.executableURL = URL(fileURLWithPath: corePath)
            p.arguments = ["-c", configPath, "--rpc-portal", "127.0.0.1:\(rpcPort)"]
            var env = ProcessInfo.processInfo.environment
            env["PATH"] = (env["PATH"] ?? "") + ":/opt/homebrew/bin:/usr/local/bin"
            env["RUST_LOG"] = logLevel
            p.environment = env
            let log = try FileHandle(forWritingTo: URL(fileURLWithPath: logPath))
            try log.seekToEnd()
            p.standardOutput = log
            p.standardError = log
            p.standardInput = FileHandle.nullDevice
            do { try p.run() } catch { try? log.close(); throw error }
            logHandle = log
            process = p
            pid = p.processIdentifier
        }
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + 0.5, repeating: 1)
        timer.setEventHandler { [weak self] in
            guard let self, !self.isAlive() else { return }
            self.finish(self.process?.terminationStatus ?? 1)
        }
        monitor = timer
        timer.resume()
    }

    func stop() throws {
        if finished { return }
        if !isAlive() { finish(0); return }
        if let process {
            process.terminate()
            let deadline = Date().addingTimeInterval(1.2)
            while process.isRunning && Date() < deadline { usleep(20_000) }
            if process.isRunning { kill(process.processIdentifier, SIGKILL) }
            process.waitUntilExit()
        } else if let pid, let signature {
            // Recheck the process identity in the privileged shell before sending signals.
            let command = """
            alive() {
              [ "$(/bin/ps -p \(pid) -o lstart= -o command=)" = \(Self.quote(signature)) ] || return 1
              case "$(/bin/ps -p \(pid) -o stat=)" in *Z*|'') return 1;; esac
              return 0
            }
            if alive; then /bin/kill -TERM \(pid) || exit 1; fi
            i=0
            while alive && [ "$i" -lt 30 ]; do /bin/sleep 0.1; i=$((i+1)); done
            if alive; then /bin/kill -KILL \(pid) || exit 1; fi
            i=0
            while alive && [ "$i" -lt 20 ]; do /bin/sleep 0.1; i=$((i+1)); done
            if alive; then echo '核心未能停止' >&2; exit 1; fi
            """
            try check(privilegedRunner(command), fallback: "停止核心失败或管理员授权已取消")
        }
        guard !isAlive() else { throw failure("核心仍在运行，请重试断开") }
        finish(0)
    }

    private func finish(_ code: Int32) {
        guard !finished else { return }
        finished = true
        monitor?.cancel()
        monitor = nil
        try? logHandle?.close()
        logHandle = nil
        onExit?(code)
    }

    private func check(_ result: [String: Any], fallback: String) throws {
        guard result["ok"] as? Bool == true else {
            let detail = (result["error"] as? String) ?? (result["stderr"] as? String) ?? ""
            throw failure(detail.isEmpty ? fallback : detail)
        }
    }

    private func failure(_ message: String) -> NSError {
        NSError(domain: "EasyTier", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }
}
