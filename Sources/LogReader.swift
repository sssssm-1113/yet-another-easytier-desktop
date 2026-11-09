import Foundation

enum LogReader {
    static func read(_ url: URL, offset: Int, limit: Int = 65_536) -> [String: Any] {
        guard let handle = try? FileHandle(forReadingFrom: url) else { return ["data": "", "offset": offset] }
        defer { try? handle.close() }
        let size = (try? handle.seekToEnd()) ?? 0
        let requested = UInt64(max(0, offset))
        let start = requested > size ? 0 : requested
        try? handle.seek(toOffset: start)
        var data = handle.readData(ofLength: limit)
        let bytes = [UInt8](data)
        if !bytes.isEmpty {
            var lead = bytes.count - 1
            while lead > 0 && bytes[lead] & 0xC0 == 0x80 { lead -= 1 }
            let byte = bytes[lead]
            let width = (0xC2...0xDF).contains(byte) ? 2 : (0xE0...0xEF).contains(byte) ? 3 : (0xF0...0xF4).contains(byte) ? 4 : 1
            if bytes.count - lead < width { data.removeLast(bytes.count - lead) }
        }
        return ["data": String(decoding: data, as: UTF8.self), "offset": Int(start) + data.count,
                "reset": requested > size]
    }
}
