import Foundation
import Darwin

// A private, per-app-lifetime channel. The helper verifies the connecting peer PID.
final class PrivilegeSession {
    private let lock = NSLock()
    let corePath: String
    private let instancesPath: String
    init(corePath: String, instancesPath: String) { self.corePath = corePath; self.instancesPath = instancesPath }
    private var connection: Int32 = -1
    private var authorization: Process?

    #if PRIVILEGE_TESTING
    var testing = false
    #endif
    deinit { closeSession() }
    private func failure(_ message: String) -> NSError {
        NSError(domain: "EasyTier.Authorization", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }
    func closeSession() {
        lock.lock(); defer { lock.unlock() }
        if connection >= 0 { _ = Darwin.shutdown(connection, SHUT_RDWR); Darwin.close(connection); connection = -1 }
    }
    func prepare() throws {
        lock.lock(); defer { lock.unlock() }
        try prepareLocked()
    }
    private func prepareLocked() throws {
        if connection >= 0 { return }
        let dir = "/tmp/et-" + UUID().uuidString
        try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        defer { try? FileManager.default.removeItem(atPath: dir) }
        let path = dir + "/socket"
        let listener = socket(AF_UNIX, SOCK_STREAM, 0)
        guard listener >= 0 else { throw failure("无法创建授权通道") }
        defer { Darwin.close(listener) }
        var address = sockaddr_un(); address.sun_family = sa_family_t(AF_UNIX); address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
        guard path.utf8.count < MemoryLayout.size(ofValue: address.sun_path) else { throw failure("授权通道路径过长") }
        withUnsafeMutableBytes(of: &address.sun_path) { dest in path.utf8CString.withUnsafeBytes { src in dest.copyBytes(from: src) } }
        let bound = withUnsafePointer(to: &address) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(listener, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) } }
        guard bound == 0, listen(listener, 1) == 0 else { throw failure("无法监听授权通道") }
        let executable = Bundle.main.executablePath ?? CommandLine.arguments[0]
        let command = "\(CoreRuntime.quote(executable)) --privileged-session \(CoreRuntime.quote(path)) \(getpid()) \(getuid()) \(CoreRuntime.quote(corePath)) \(CoreRuntime.quote(instancesPath))"
        let p = Process(); p.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        p.arguments = ["-e", CoreRuntime.administratorScript(command)]
        p.standardInput = FileHandle.nullDevice; p.standardOutput = FileHandle.nullDevice; p.standardError = FileHandle.nullDevice
        #if PRIVILEGE_TESTING
        if testing {
            p.executableURL = URL(fileURLWithPath: executable)
            p.arguments = ["--privileged-session", path, String(getpid()), String(getuid()), corePath, instancesPath]
        }
        #endif
        try p.run(); authorization = p
        while true {
            var fds = pollfd(fd: listener, events: Int16(POLLIN), revents: 0)
            let result = poll(&fds, 1, 200)
            if result > 0 {
                let fd = accept(listener, nil, nil)
                guard fd >= 0 else { throw failure("授权通道连接失败") }
                var uid: uid_t = 0, gid: gid_t = 0
                #if PRIVILEGE_TESTING
                let expectedUID: uid_t = testing ? getuid() : 0
                #else
                let expectedUID: uid_t = 0
                #endif
                guard getpeereid(fd, &uid, &gid) == 0, uid == expectedUID else { Darwin.close(fd); throw failure("授权进程身份验证失败") }
                var noPipe: Int32 = 1
                _ = setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &noPipe, socklen_t(MemoryLayout<Int32>.size))
                connection = fd; return
            }
            if result < 0 && errno != EINTR { throw failure("授权通道等待失败") }
            if !p.isRunning { throw failure("管理员授权失败或已取消") }
        }
    }
    func request(_ request: [String: Any]) throws -> [String: Any] {
        lock.lock(); defer { lock.unlock() }
        try prepareLocked()
        let data = try JSONSerialization.data(withJSONObject: request) + Data([10])
        do {
            try PrivilegeWire.writeAll(connection, data)
            guard let response = try PrivilegeWire.readLine(connection),
                  let value = try JSONSerialization.jsonObject(with: response) as? [String: Any] else { throw failure("授权进程响应无效") }
            return value
        } catch {
            if connection >= 0 { Darwin.close(connection); connection = -1 }
            throw error
        }
    }
}

enum PrivilegeWire {
    static func writeAll(_ fd: Int32, _ data: Data) throws {
        var offset = 0
        while offset < data.count {
            let n = data.withUnsafeBytes { send(fd, $0.baseAddress!.advanced(by: offset), data.count - offset, 0) }
            if n < 0 && errno == EINTR { continue }
            guard n > 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }; offset += n
        }
    }
    static func readLine(_ fd: Int32) throws -> Data? {
        var data = Data(), byte: UInt8 = 0
        while data.count < 65536 {
            let n = recv(fd, &byte, 1, 0)
            if n < 0 && errno == EINTR { continue }
            if n == 0 { return nil }
            guard n > 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
            if byte == 10 { return data }; data.append(byte)
        }
        throw NSError(domain: "EasyTier.Authorization", code: 2)
    }
}

// Runs only as an authenticated child, and only over the socket owned by its launching app.
enum PrivilegeHelper {
    static func run(_ args: [String]) -> Int32 {
        guard args.count == 7, let parent = Int32(args[3]), let user = UInt32(args[4]) else { return 2 }
        #if !PRIVILEGE_TESTING
        guard getuid() == 0 else { return 2 }
        #endif
        let path = args[2], core = args[5], base = URL(fileURLWithPath: args[6]).standardizedFileURL.path
        let fd = socket(AF_UNIX, SOCK_STREAM, 0); guard fd >= 0 else { return 3 }
        defer { Darwin.close(fd) }
        var address = sockaddr_un(); address.sun_family = sa_family_t(AF_UNIX); address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
        guard path.utf8.count < MemoryLayout.size(ofValue: address.sun_path) else { return 3 }
        withUnsafeMutableBytes(of: &address.sun_path) { dest in path.utf8CString.withUnsafeBytes { src in dest.copyBytes(from: src) } }
        let connected = withUnsafePointer(to: &address) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) } }
        guard connected == 0 else { return 3 }
        var peerUID: uid_t = 0, peerGID: gid_t = 0, peerPID: pid_t = 0
        var length = socklen_t(MemoryLayout<pid_t>.size)
        guard getpeereid(fd, &peerUID, &peerGID) == 0, peerUID == user,
              getsockopt(fd, SOL_LOCAL, LOCAL_PEERPID, &peerPID, &length) == 0, peerPID == parent else { return 4 }
        // Freeze the chosen executable for this session in a directory unavailable to the user.
        // A later replacement of the user-writable app/core must not change what runs as root.
        let staging = URL(fileURLWithPath: "/private/tmp", isDirectory: true).appendingPathComponent("et-core-" + UUID().uuidString, isDirectory: true)
        let frozenCore = staging.appendingPathComponent("easytier-core")
        do {
            try FileManager.default.createDirectory(at: staging, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
            try FileManager.default.copyItem(at: URL(fileURLWithPath: core).resolvingSymlinksInPath(), to: frozenCore)
            try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: frozenCore.path)
        } catch { try? FileManager.default.removeItem(at: staging); return 5 }
        defer { try? FileManager.default.removeItem(at: staging) }
        // A broken app connection must not leave privileged cores running.
        signal(SIGPIPE, SIG_IGN)
        var children: [String: Process] = [:]
        func stop(_ p: Process) {
            guard p.isRunning else { return }
            p.terminate(); let deadline = Date().addingTimeInterval(2)
            while p.isRunning && Date() < deadline { usleep(20_000) }
            if p.isRunning { kill(p.processIdentifier, SIGKILL) }; p.waitUntilExit()
        }
        defer { for p in children.values { stop(p) } }
        while let line = try? PrivilegeWire.readLine(fd) {
            guard let req = try? JSONSerialization.jsonObject(with: line) as? [String: Any],
                  let action = req["action"] as? String, let id = req["id"] as? String,
                  id.range(of: "^[A-Za-z0-9-]{1,128}$", options: .regularExpression) != nil else { break }
            var response: [String: Any] = ["ok": false, "error": "无效请求"]
            if action == "stop" {
                if let p = children.removeValue(forKey: id) { stop(p) }
                response = ["ok": true]
            } else if action == "start", children[id]?.isRunning != true,
                      let port = req["port"] as? Int, (1024...65535).contains(port),
                      let level = req["level"] as? String, ["error", "warn", "info", "debug", "trace"].contains(level) {
                let dir = base + "/" + id
                let config = dir + "/config.toml", log = dir + "/core.log"
                // Refuse symlinked directories/files; the helper never accepts shell commands.
                let canonicalDir = URL(fileURLWithPath: dir).resolvingSymlinksInPath().path
                let canonicalBase = URL(fileURLWithPath: base).resolvingSymlinksInPath().path
                if canonicalDir == canonicalBase + "/" + id {
                    let configFD = open(config, O_RDONLY | O_NOFOLLOW)
                    let logFD = open(log, O_WRONLY | O_APPEND | O_NOFOLLOW)
                    if configFD >= 0 && logFD >= 0 {
                        Darwin.close(configFD)
                        let output = FileHandle(fileDescriptor: logFD, closeOnDealloc: true)
                        let p = Process(); p.executableURL = frozenCore
                        p.arguments = ["-c", config, "--rpc-portal", "127.0.0.1:\(port)"]
                        var env = ProcessInfo.processInfo.environment; env["RUST_LOG"] = level; p.environment = env
                        p.currentDirectoryURL = URL(fileURLWithPath: dir); p.standardInput = FileHandle.nullDevice
                        p.standardOutput = output; p.standardError = output
                        do { try p.run(); children[id] = p; response = ["ok": true, "pid": Int(p.processIdentifier)] }
                        catch { response = ["ok": false, "error": error.localizedDescription] }
                    } else {
                        if configFD >= 0 { Darwin.close(configFD) }; if logFD >= 0 { Darwin.close(logFD) }
                        response = ["ok": false, "error": "无法安全打开网络配置或日志"]
                    }
                }
            }
            guard let data = try? JSONSerialization.data(withJSONObject: response),
                  (try? PrivilegeWire.writeAll(fd, data + Data([10]))) != nil else { break }
        }
        return 0
    }
}
