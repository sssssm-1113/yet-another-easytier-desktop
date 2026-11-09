import Foundation
import Darwin

func require(_ condition: @autoclosure () -> Bool, _ message: String) {
    guard condition() else { fputs("FAIL: \(message)\n", stderr); exit(1) }
    print("PASS: \(message)")
}

@main struct NativeTests {
    static func main() throws {
        let fm = FileManager.default
        let dir = fm.temporaryDirectory.appendingPathComponent("et-native-tests-\(UUID().uuidString) quote's space")
        try fm.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: dir) }
        let python = CommandLine.arguments[1]
        let mock = dir.appendingPathComponent("mock-core")
        let body = """
        #!\(python)
        import os, pathlib, signal, sys, time
        config = pathlib.Path(sys.argv[sys.argv.index('-c') + 1])
        mode = config.read_text()
        config.with_suffix('.pid').write_text(str(os.getpid()))
        print('核心已启动 # test', flush=True)
        if 'stubborn' in mode: signal.signal(signal.SIGTERM, signal.SIG_IGN)
        if 'exit' in mode:
            time.sleep(0.4)
            sys.exit(7)
        while True: time.sleep(0.1)
        """
        try body.write(to: mock, atomically: true, encoding: .utf8)
        try fm.setAttributes([.posixPermissions: 0o700], ofItemAtPath: mock.path)

        let result = Shell.run(python, ["-c", "import sys;sys.stdout.write('a'*1048576);sys.stderr.write('b'*1048576)"], timeout: 5)
        require(result["ok"] as? Bool == true, "large stdout and stderr finish without pipe deadlock")
        require((result["stdout"] as? String)?.count == 1_048_576 && (result["stderr"] as? String)?.count == 1_048_576, "large output is complete on both streams")
        let timeoutPID = dir.appendingPathComponent("timeout.pid")
        let start = Date()
        let timeout = Shell.run(python, ["-c", "import os,signal,time;open(\(String(reflecting: timeoutPID.path)),'w').write(str(os.getpid()));signal.signal(signal.SIGTERM,signal.SIG_IGN);time.sleep(20)"], timeout: 0.4)
        require(timeout["error"] != nil && Date().timeIntervalSince(start) < 3, "timeout escalates to kill when TERM is ignored")
        let timedPID = Int32(try String(contentsOf: timeoutPID, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines))!
        require(!CoreRuntime.processExists(timedPID), "timed-out child is reaped")
        let ps = Shell.run("/bin/ps", ["-axo", "pid=,uid="])
        let rootPID = (ps["stdout"] as? String ?? "").split(separator: "\n").compactMap { line -> Int32? in
            let values = line.split(whereSeparator: { $0.isWhitespace })
            guard values.count == 2, values[1] == "0", let pid = Int32(values[0]), pid > 1 else { return nil }
            return pid
        }.first
        if let rootPID { require(CoreRuntime.processExists(rootPID), "EPERM is treated as a live root process") }

        func fixture(_ name: String, mode: String, elevated: Bool, runner: ((String) -> [String: Any])? = nil) throws -> (CoreRuntime, URL) {
            let config = dir.appendingPathComponent(name + ".toml")
            try mode.write(to: config, atomically: true, encoding: .utf8)
            let log = dir.appendingPathComponent(name + ".log")
            fm.createFile(atPath: log.path, contents: nil)
            let runtime = CoreRuntime(profileId: name, corePath: mock.path, configPath: config.path, logPath: log.path,
                                      rpcPort: 15888, logLevel: "info", elevated: elevated, privilegedRunner: runner)
            return (runtime, config.deletingPathExtension().appendingPathExtension("pid"))
        }
        func waitPID(_ file: URL) throws -> Int32 {
            for _ in 0..<100 {
                if let text = try? String(contentsOf: file, encoding: .utf8), let pid = Int32(text.trimmingCharacters(in: .whitespacesAndNewlines)) { return pid }
                usleep(20_000)
            }
            throw NSError(domain: "test", code: 1, userInfo: [NSLocalizedDescriptionKey: "mock PID missing"])
        }
        let (direct, directPIDFile) = try fixture("direct", mode: "stubborn", elevated: false)
        try direct.queue.sync { try direct.start() }
        let directPID = try waitPID(directPIDFile)
        defer { if CoreRuntime.processExists(directPID) { kill(directPID, SIGKILL) } }
        require(CoreRuntime.processExists(directPID), "direct mock is running")
        try direct.queue.sync { try direct.stop() }
        require(!CoreRuntime.processExists(directPID), "direct stop waits for a TERM-resistant core to exit")

        var allowStop = false
        var privilegedCalls = 0
        let (elevated, elevatedPIDFile) = try fixture("elevated", mode: "normal", elevated: true) { command in
            privilegedCalls += 1
            if privilegedCalls > 1 && !allowStop { return ["ok": false, "stderr": "authorization cancelled"] }
            return Shell.run("/usr/bin/osascript", ["-e", CoreRuntime.administratorScript(command).replacingOccurrences(of: " with administrator privileges", with: "")], timeout: 15)
        }
        require(!elevated.launchCommand.contains("nohup") && elevated.launchCommand.contains("trap"), "privileged launch avoids macOS nohup console detachment")
        try elevated.queue.sync { try elevated.start() }
        let elevatedPID = try waitPID(elevatedPIDFile)
        defer { if CoreRuntime.processExists(elevatedPID) { kill(elevatedPID, SIGKILL) } }
        do { try elevated.queue.sync { try elevated.stop() }; require(false, "cancelled authorization must throw") }
        catch { require(CoreRuntime.processExists(elevatedPID), "cancelled authorization leaves core owned and running") }
        allowStop = true
        try elevated.queue.sync { try elevated.stop() }
        let state = Shell.run("/bin/ps", ["-p", String(elevatedPID), "-o", "stat="])["stdout"] as? String ?? ""
        require(state.isEmpty || state.contains("Z"), "privileged launch records actual core PID and retry stops it")

        let (exiting, _) = try fixture("exit", mode: "exit", elevated: false)
        let exited = DispatchSemaphore(value: 0)
        var exitCode: Int32 = 0
        exiting.onExit = { exitCode = $0; exited.signal() }
        try exiting.queue.sync { try exiting.start() }
        require(exited.wait(timeout: .now() + 4) == .success && exitCode == 7, "monitor reports actual direct exit status")

        let log = dir.appendingPathComponent("unicode.log")
        let original = "a汉字🙂b\n" + String(repeating: "日志\n", count: 100)
        try original.write(to: log, atomically: true, encoding: .utf8)
        var offset = 0, combined = ""
        for _ in 0..<1000 {
            let chunk = LogReader.read(log, offset: offset, limit: 8)
            let next = chunk["offset"] as! Int
            if next == offset { break }
            combined += chunk["data"] as! String
            offset = next
        }
        require(combined == original, "bounded log reads retain split Chinese and emoji characters")
        try Data([0xff]).write(to: log)
        require(LogReader.read(log, offset: 0)["offset"] as? Int == 1, "invalid UTF-8 does not stall log cursor")
        require(LogReader.read(log, offset: 999)["reset"] as? Bool == true, "log truncation resets cursor")
        print("Native regression suite passed")
    }
}
