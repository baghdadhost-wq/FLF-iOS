import UIKit
import WebKit
import AVFoundation
import Compression
import UniformTypeIdentifiers

// MARK: - Game files kept on the phone (downloaded once)

enum GameFiles {
    static let mirrors = [
        "https://raw.githubusercontent.com/Cludes/r-lf2-web/master/",
        "https://cludes.github.io/r-lf2-web/",
        "https://github.com/Cludes/r-lf2-web/raw/master/",
    ]
    static let parts = ["windows95.img.part1.gz", "windows95.img.part2.gz", "windows95.img.part3.gz"]
    static let state = "win95-lf2-default.bin.zst"
    static let diskSize: Int64 = 209_715_200
    static let approxDownload: Double = 94_677_470

    static var dir: URL {
        let d = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("lf2", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }
    static var disk: URL { dir.appendingPathComponent("windows95.img") }
    static var stateFile: URL { dir.appendingPathComponent(state) }

    // CRC32 of the good unpacked disk (also stored in the gzip trailer of part3)
    static let diskCRC: UInt32 = 0xe86a8b44
    static var okMark: URL { dir.appendingPathComponent("windows95.img.ok") }

    static func sizeOK() -> Bool {
        let fm = FileManager.default
        guard let a = try? fm.attributesOfItem(atPath: disk.path),
              (a[.size] as? NSNumber)?.int64Value == diskSize,
              let b = try? fm.attributesOfItem(atPath: stateFile.path),
              ((b[.size] as? NSNumber)?.int64Value ?? 0) > 1_000_000 else { return false }
        return true
    }
    // full build: the disk is shipped inside the app (folder "game"), checked on the build machine
    static var bundledDisk: URL? {
        let u = Bundle.main.resourceURL!.appendingPathComponent("game/windows95.img")
        guard let a = try? FileManager.default.attributesOfItem(atPath: u.path),
              (a[.size] as? NSNumber)?.int64Value == diskSize else { return nil }
        return u
    }
    // the disk Windows really uses; every change Windows makes is written back into it
    static var userDisk: URL { dir.appendingPathComponent("user.img") }
    static var liveDisk: URL { bundledDisk != nil ? userDisk : disk }
    static func ensureUserDisk() {
        guard let b = bundledDisk else { return }
        let fm = FileManager.default
        let sz = (try? fm.attributesOfItem(atPath: userDisk.path)[.size] as? NSNumber)?.int64Value ?? 0
        if sz == diskSize { return }
        try? fm.removeItem(at: userDisk)
        try? fm.copyItem(at: b, to: userDisk)     // APFS clone: instant, no extra space until Windows writes
    }

    // writes coming from the emulator, applied in order on one queue
    static let writeQ = DispatchQueue(label: "disk-writes")
    static var writeHandle: FileHandle?
    static func write(offset: UInt64, data: Data) {
        writeQ.async {
            if writeHandle == nil { writeHandle = try? FileHandle(forWritingTo: liveDisk) }
            guard let h = writeHandle, offset + UInt64(data.count) <= UInt64(diskSize) else { return }
            h.seek(toFileOffset: offset)
            h.write(data)
        }
    }
    static func flush() { writeQ.sync { writeHandle?.synchronizeFile() } }
    static func closeDisk() { writeQ.sync { try? writeHandle?.close(); writeHandle = nil } }

    static func ready() -> Bool {
        if bundledDisk != nil { ensureUserDisk(); return true }
        return sizeOK() && FileManager.default.fileExists(atPath: okMark.path)
    }

    // read the whole disk and compare its checksum; writes the "ok" mark when it matches
    static func verifyDisk(progress: (Double) -> Void = { _ in }) -> Bool {
        guard let h = try? FileHandle(forReadingFrom: disk) else { return false }
        defer { try? h.close() }
        var c = CRC32()
        var done: Int64 = 0
        while true {
            let d = autoreleasepool { h.readData(ofLength: 4 << 20) }
            if d.isEmpty { break }
            c.update(d); done += Int64(d.count)
            progress(Double(done) / Double(diskSize))
        }
        guard done == diskSize, c.value == diskCRC else { return false }
        FileManager.default.createFile(atPath: okMark.path, contents: Data("ok".utf8))
        return true
    }
}

struct CRC32 {
    static let table: [UInt32] = (0..<256).map { i -> UInt32 in
        var c = UInt32(i)
        for _ in 0..<8 { c = (c & 1) != 0 ? 0xEDB88320 ^ (c >> 1) : c >> 1 }
        return c
    }
    private var crc: UInt32 = 0xFFFFFFFF
    mutating func update(_ d: Data) {
        d.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in update(raw) }
    }
    mutating func update(_ raw: UnsafeRawBufferPointer) {
        var c = crc
        CRC32.table.withUnsafeBufferPointer { t in
            for b in raw { c = t[Int((c ^ UInt32(b)) & 0xFF)] ^ (c >> 8) }
        }
        crc = c
    }
    var value: UInt32 { crc ^ 0xFFFFFFFF }
}

final class Preparer: NSObject {
    var report: (String, Double?) -> Void = { _, _ in }
    var finished: (String?) -> Void = { _ in }
    private var observation: NSKeyValueObservation?
    private var doneBytes: Double = 0

    var needSource: () -> Void = {}

    func run() {
        if GameFiles.ready() { finished(nil); return }
        if GameFiles.sizeOK() {
            // disk from an older version or picked from Files: check it once before booting
            report("جارِ فحص سلامة القرص…", 0)
            DispatchQueue.global(qos: .userInitiated).async {
                let good = GameFiles.verifyDisk { f in DispatchQueue.main.async { self.report("جارِ فحص سلامة القرص…", f) } }
                DispatchQueue.main.async {
                    if good { self.finished(nil); return }
                    try? FileManager.default.removeItem(at: GameFiles.disk)
                    self.report("القرص كان تالفاً، سيُعاد تجهيزه…", nil)
                    if self.haveLocalParts() { self.unpack(self.localParts()) } else { self.needSource() }
                }
            }
            return
        }
        if haveLocalParts() { unpack(localParts()); return }
        needSource()
    }

    func haveLocalParts() -> Bool {
        let fm = FileManager.default
        let partsOK = GameFiles.parts.allSatisfy { fm.fileExists(atPath: GameFiles.dir.appendingPathComponent($0 + ".dl").path) }
        let stateOK = fm.fileExists(atPath: GameFiles.stateFile.path) ||
            fm.fileExists(atPath: GameFiles.dir.appendingPathComponent(GameFiles.state + ".dl").path)
        return partsOK && stateOK
    }
    func localParts() -> [URL] {
        let st = FileManager.default.fileExists(atPath: GameFiles.stateFile.path) ? GameFiles.stateFile
            : GameFiles.dir.appendingPathComponent(GameFiles.state + ".dl")
        return GameFiles.parts.map { GameFiles.dir.appendingPathComponent($0 + ".dl") } + [st]
    }

    // files picked in the Files app: .gz parts, the .zst state, or an already unpacked windows95.img
    func importPicked(_ urls: [URL]) -> String? {
        let fm = FileManager.default
        for u in urls {
            let n = u.lastPathComponent.lowercased()
            var dest: URL?
            if n.hasSuffix(".zst") { dest = GameFiles.stateFile }
            else if n.hasSuffix(".img") { dest = GameFiles.disk }
            else if n.contains(".gz") {
                for (i, part) in GameFiles.parts.enumerated() where n.contains("part\(i + 1)") {
                    dest = GameFiles.dir.appendingPathComponent(part + ".dl")
                }
            }
            guard let d = dest else { continue }
            try? fm.removeItem(at: d)
            do { try fm.moveItem(at: u, to: d) } catch {
                do { try fm.copyItem(at: u, to: d) } catch { return error.localizedDescription }
            }
        }
        if GameFiles.sizeOK() || haveLocalParts() { return nil }
        var missing: [String] = []
        let hasImg = ((try? fm.attributesOfItem(atPath: GameFiles.disk.path)[.size] as? NSNumber)?.int64Value ?? 0) == GameFiles.diskSize
        if !hasImg {
            for p in GameFiles.parts where !fm.fileExists(atPath: GameFiles.dir.appendingPathComponent(p + ".dl").path) { missing.append(p) }
        }
        if !fm.fileExists(atPath: GameFiles.stateFile.path) { missing.append(GameFiles.state) }
        return "ناقص: " + missing.joined(separator: "، ")
    }

    func startDownload() {
        doneBytes = 0
        downloadAll(GameFiles.parts + [GameFiles.state], index: 0, collected: [])
    }

    private func downloadAll(_ names: [String], index: Int, collected: [URL]) {
        if index >= names.count {
            unpack(collected)
            return
        }
        var cached = GameFiles.dir.appendingPathComponent(names[index] + ".dl")
        if names[index] == GameFiles.state && FileManager.default.fileExists(atPath: GameFiles.stateFile.path) {
            cached = GameFiles.stateFile
        }
        if let sz = (try? FileManager.default.attributesOfItem(atPath: cached.path)[.size] as? NSNumber)?.doubleValue, sz > 100_000 {
            doneBytes += sz
            downloadAll(names, index: index + 1, collected: collected + [cached])
            return
        }
        download(name: names[index], mirror: 0) { [weak self] url, err in
            guard let self = self else { return }
            guard let url = url else { DispatchQueue.main.async { self.finished(err ?? "download failed") }; return }
            self.downloadAll(names, index: index + 1, collected: collected + [url])
        }
    }

    private func download(name: String, mirror: Int, done: @escaping (URL?, String?) -> Void) {
        guard mirror < GameFiles.mirrors.count,
              let url = URL(string: GameFiles.mirrors[mirror] + name) else {
            done(nil, "تعذّر الوصول إلى ملفات اللعبة. تأكد من الإنترنت.")
            return
        }
        let base = doneBytes
        let task = URLSession.shared.downloadTask(with: url) { [weak self] tmp, resp, err in
            guard let self = self else { return }
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            let size = (try? FileManager.default.attributesOfItem(atPath: tmp?.path ?? "")[.size] as? NSNumber)?.doubleValue ?? 0
            guard err == nil, code == 200, let tmp = tmp, size > 100_000 else {
                self.download(name: name, mirror: mirror + 1, done: done)
                return
            }
            let dest = GameFiles.dir.appendingPathComponent(name + ".dl")
            try? FileManager.default.removeItem(at: dest)
            do { try FileManager.default.moveItem(at: tmp, to: dest) } catch {
                done(nil, error.localizedDescription); return
            }
            self.doneBytes = base + size
            done(dest, nil)
        }
        observation = task.progress.observe(\.completedUnitCount) { [weak self] p, _ in
            guard let self = self else { return }
            let frac = (base + Double(p.completedUnitCount)) / GameFiles.approxDownload
            DispatchQueue.main.async { self.report("جارِ تحميل اللعبة… (مرة واحدة فقط)", min(frac, 1) * 0.85) }
        }
        task.resume()
    }

    private func unpack(_ files: [URL]) {
        DispatchQueue.main.async { self.report("جارِ فك الضغط…", 0.86) }
        DispatchQueue.global(qos: .userInitiated).async {
            let gz = Array(files.prefix(GameFiles.parts.count))
            let stateDl = files.last!
            let tmp = GameFiles.dir.appendingPathComponent("windows95.img.tmp")
            try? FileManager.default.removeItem(at: GameFiles.okMark)
            do {
                // put the saved state in place first (also used by the in-page fallback)
                if stateDl != GameFiles.stateFile && FileManager.default.fileExists(atPath: stateDl.path) {
                    try? FileManager.default.removeItem(at: GameFiles.stateFile)
                    try FileManager.default.moveItem(at: stateDl, to: GameFiles.stateFile)
                }
                try Preparer.gunzip(gz, to: tmp) { frac in
                    DispatchQueue.main.async { self.report("جارِ فك الضغط…", 0.86 + frac * 0.13) }
                }
                let fm = FileManager.default
                try? fm.removeItem(at: GameFiles.disk)
                try fm.moveItem(at: tmp, to: GameFiles.disk)
                fm.createFile(atPath: GameFiles.okMark.path, contents: Data("ok".utf8))
                gz.forEach { try? fm.removeItem(at: $0) }
                DispatchQueue.main.async {
                    if GameFiles.ready() { self.finished(nil) } else { self.finished("unpack:الملف غير مكتمل") }
                }
            } catch {
                try? FileManager.default.removeItem(at: tmp)
                DispatchQueue.main.async { self.finished("unpack:" + error.localizedDescription) }
            }
        }
    }

    struct GzError: Error, LocalizedError {
        let msg: String
        var errorDescription: String? { msg }
    }

    // gunzip several files that together form one .gz stream (raw DEFLATE after the gzip header)
    static func gunzip(_ inputs: [URL], to out: URL, progress: (Double) -> Void) throws {
        let fm = FileManager.default
        try? fm.removeItem(at: out)
        fm.createFile(atPath: out.path, contents: nil)
        let outH = try FileHandle(forWritingTo: out)
        defer { try? outH.close() }

        let stream = UnsafeMutablePointer<compression_stream>.allocate(capacity: 1)
        defer { stream.deallocate() }
        guard compression_stream_init(stream, COMPRESSION_STREAM_DECODE, COMPRESSION_ZLIB) != COMPRESSION_STATUS_ERROR else {
            throw GzError(msg: "zlib init")
        }
        defer { compression_stream_destroy(stream) }

        let dstSize = 1 << 20
        let dst = UnsafeMutablePointer<UInt8>.allocate(capacity: dstSize)
        defer { dst.deallocate() }
        var headerSkipped = false
        var ended = false
        var written: Int64 = 0
        var crc = CRC32()

        func pump(_ data: Data, finalize: Bool) throws {
            try data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
                let base = raw.bindMemory(to: UInt8.self).baseAddress ?? UnsafePointer<UInt8>(bitPattern: 1)!
                stream.pointee.src_ptr = base
                stream.pointee.src_size = raw.count
                // keep calling while input remains OR the decoder still hands out output
                // (it can hold decoded data back even after all input is consumed)
                var idle = 0
                while true {
                    stream.pointee.dst_ptr = dst
                    stream.pointee.dst_size = dstSize
                    let st = compression_stream_process(stream, finalize ? Int32(COMPRESSION_STREAM_FINALIZE.rawValue) : 0)
                    if st == COMPRESSION_STATUS_ERROR { throw GzError(msg: "خطأ في فك الضغط") }
                    let n = dstSize - stream.pointee.dst_size
                    if n > 0 {
                        crc.update(UnsafeRawBufferPointer(start: dst, count: n))
                        outH.write(Data(bytes: dst, count: n)); written += Int64(n)
                    }
                    if st == COMPRESSION_STATUS_END { ended = true; return }
                    if n == 0 && stream.pointee.src_size == 0 {
                        idle += 1
                        if !finalize || idle >= 3 { break }
                    } else { idle = 0 }
                }
            }
        }

        for url in inputs {
            let h = try FileHandle(forReadingFrom: url)
            defer { try? h.close() }
            while !ended {
                var chunk = h.readData(ofLength: 1 << 20)
                if chunk.isEmpty { break }
                if !headerSkipped {
                    let b = [UInt8](chunk.prefix(1024))
                    guard b.count > 10, b[0] == 0x1f, b[1] == 0x8b else { throw GzError(msg: "ليس ملف gzip") }
                    let flg = b[3]
                    var i = 10
                    if flg & 4 != 0 { i += 2 + Int(b[10]) + Int(b[11]) << 8 }
                    if flg & 8 != 0 { while b[i] != 0 { i += 1 }; i += 1 }
                    if flg & 16 != 0 { while b[i] != 0 { i += 1 }; i += 1 }
                    if flg & 2 != 0 { i += 2 }
                    chunk = chunk.subdata(in: i..<chunk.count)
                    headerSkipped = true
                }
                try pump(chunk, finalize: false)
                progress(Double(written) / Double(GameFiles.diskSize))
            }
        }
        if !ended { try pump(Data([0]).prefix(0), finalize: true) }
        guard written == GameFiles.diskSize else { throw GzError(msg: "حجم غير صحيح \(written)") }
        // compare with the CRC32 stored in the gzip trailer (last 8 bytes: CRC32, size)
        var expect = GameFiles.diskCRC
        if let last = inputs.last, let h = try? FileHandle(forReadingFrom: last) {
            let end = h.seekToEndOfFile()
            if end >= 8 {
                h.seek(toFileOffset: end - 8)
                let t = [UInt8](h.readData(ofLength: 4))
                if t.count == 4 { expect = UInt32(t[0]) | UInt32(t[1]) << 8 | UInt32(t[2]) << 16 | UInt32(t[3]) << 24 }
            }
            try? h.close()
        }
        guard crc.value == expect else { throw GzError(msg: "فحص السلامة فشل (CRC)") }
    }
}

// MARK: - Local server for the page (bundle files + downloaded disk, with Range support)

final class SchemeHandler: NSObject, WKURLSchemeHandler {
    let www = Bundle.main.resourceURL!.appendingPathComponent("www")

    static let mime: [String: String] = [
        "html": "text/html", "js": "application/javascript", "wasm": "application/wasm",
        "css": "text/css", "png": "image/png", "bin": "application/octet-stream",
        "zst": "application/octet-stream", "img": "application/octet-stream",
    ]

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        var path = url.path.removingPercentEncoding ?? url.path
        if path.hasPrefix("/") { path.removeFirst() }
        if path.isEmpty { path = "index.html" }

        let file: URL
        if path.hasPrefix("disk/") {
            let name = String(path.dropFirst(5))
            if name == "windows95.img" { GameFiles.ensureUserDisk(); file = GameFiles.liveDisk }
            else { file = GameFiles.dir.appendingPathComponent(name) }
        } else {
            file = www.appendingPathComponent(path)
        }
        let type = SchemeHandler.mime[file.pathExtension.lowercased()] ?? "application/octet-stream"

        guard let h = try? FileHandle(forReadingFrom: file),
              let total = (try? FileManager.default.attributesOfItem(atPath: file.path)[.size] as? NSNumber)?.int64Value else {
            let r = HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: [:])!
            task.didReceive(r); task.didReceive(Data()); task.didFinish(); return
        }
        defer { try? h.close() }

        var start: Int64 = 0
        var end: Int64 = total - 1
        var status = 200
        var headers = ["Content-Type": type, "Accept-Ranges": "bytes", "Access-Control-Allow-Origin": "*",
                       "Cache-Control": "no-store"]
        if let range = task.request.value(forHTTPHeaderField: "Range"), range.hasPrefix("bytes=") {
            let p = range.dropFirst(6).split(separator: "-", omittingEmptySubsequences: false)
            if let s = Int64(p.first ?? "") {
                start = s
                if p.count > 1, let e = Int64(p[1]) { end = min(e, total - 1) }
            } else if p.count > 1, let suffix = Int64(p[1]) {
                start = max(0, total - suffix)
            }
            if start <= end {
                status = 206
                headers["Content-Range"] = "bytes \(start)-\(end)/\(total)"
            } else { start = 0; end = total - 1 }
        }
        let length = max(0, end - start + 1)
        headers["Content-Length"] = String(length)
        let isHead = task.request.httpMethod == "HEAD"
        task.didReceive(HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!)
        if !isHead && length > 0 {
            h.seek(toFileOffset: UInt64(start))
            var remaining = length
            while remaining > 0 {
                let n = Int(min(remaining, 4 << 20))
                let d = h.readData(ofLength: n)
                if d.isEmpty { break }
                task.didReceive(d)
                remaining -= Int64(d.count)
            }
        }
        task.didFinish()
    }
    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

// MARK: - UI

final class GameViewController: UIViewController, WKScriptMessageHandler, WKUIDelegate, UIDocumentPickerDelegate {
    var web: WKWebView!
    let preparer = Preparer()

    override func loadView() {
        let cfg = WKWebViewConfiguration()
        cfg.setURLSchemeHandler(SchemeHandler(), forURLScheme: "lf2")
        cfg.allowsInlineMediaPlayback = true
        cfg.mediaTypesRequiringUserActionForPlayback = []
        cfg.userContentController.add(self, name: "lf2")
        web = WKWebView(frame: .zero, configuration: cfg)
        web.uiDelegate = self
        web.isOpaque = false
        web.backgroundColor = .black
        web.scrollView.isScrollEnabled = false
        web.scrollView.bounces = false
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.allowsLinkPreview = false
        if #available(iOS 16.4, *) { web.isInspectable = true }
        view = web
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        preparer.report = { [weak self] text, frac in
            let f = frac.map { String($0) } ?? "null"
            let t = text.replacingOccurrences(of: "\"", with: "'")
            self?.web.evaluateJavaScript("window.lf2Progress && lf2Progress(\"\(t)\", \(f))")
        }
        preparer.needSource = { [weak self] in
            self?.web.evaluateJavaScript("window.lf2NeedSource && lf2NeedSource('')")
        }
        preparer.finished = { [weak self] err in
            if let err = err {
                let e = err.replacingOccurrences(of: "\"", with: "'")
                self?.web.evaluateJavaScript("window.lf2Error && lf2Error(\"\(e)\")")
            } else {
                self?.web.evaluateJavaScript("window.lf2Ready && lf2Ready(\(GameFiles.diskSize))")
            }
        }
        web.load(URLRequest(url: URL(string: "lf2://app/index.html")!))
    }

    func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let cmd = body["cmd"] as? String else { return }
        if cmd == "prepare" { DispatchQueue.main.async { self.preparer.run() } }
        if cmd == "download" { DispatchQueue.main.async { self.preparer.startDownload() } }
        if cmd == "pick" { DispatchQueue.main.async { self.pickFiles() } }
        if cmd == "w", let o = body["o"] as? NSNumber, let d = body["d"] as? String, let data = Data(base64Encoded: d) {
            GameFiles.write(offset: o.uint64Value, data: data)
        }
        if cmd == "reset" {
            GameFiles.closeDisk()
            try? FileManager.default.removeItem(at: GameFiles.dir)
            DispatchQueue.main.async { self.preparer.run() }
        }
        if cmd == "factory" {
            let a = UIAlertController(title: "استعادة Windows الأصلي؟",
                                      message: "سيتم حذف كل التغييرات والملفات التي حفظتها داخل Windows والعودة إلى النسخة الأصلية.",
                                      preferredStyle: .alert)
            a.addAction(UIAlertAction(title: "إلغاء", style: .cancel))
            a.addAction(UIAlertAction(title: "استعادة", style: .destructive) { _ in
                GameFiles.closeDisk()
                if GameFiles.bundledDisk != nil {
                    try? FileManager.default.removeItem(at: GameFiles.userDisk)
                } else {
                    try? FileManager.default.removeItem(at: GameFiles.dir)
                }
                self.web.reload()
            })
            present(a, animated: true)
        }
    }

    func pickFiles() {
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.item], asCopy: true)
        picker.allowsMultipleSelection = true
        picker.delegate = self
        present(picker, animated: true)
    }
    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        web.evaluateJavaScript("window.lf2Progress && lf2Progress('جارِ نسخ الملفات…', 0.5)")
        DispatchQueue.global(qos: .userInitiated).async {
            let err = self.preparer.importPicked(urls)
            DispatchQueue.main.async {
                if let err = err {
                    let e = err.replacingOccurrences(of: "\"", with: "'")
                    self.web.evaluateJavaScript("window.lf2NeedSource && lf2NeedSource(\"\(e)\")")
                } else {
                    self.preparer.run()
                }
            }
        }
    }
    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        web.evaluateJavaScript("window.lf2NeedSource && lf2NeedSource('')")
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(a, animated: true)
    }

    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
    override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge { .all }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .landscape }
}

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [.mixWithOthers])
        try? AVAudioSession.sharedInstance().setActive(true)
        let w = UIWindow(frame: UIScreen.main.bounds)
        w.rootViewController = GameViewController()
        w.backgroundColor = .black
        w.makeKeyAndVisible()
        window = w
        return true
    }
    func applicationDidEnterBackground(_ application: UIApplication) { GameFiles.flush() }
    func applicationWillTerminate(_ application: UIApplication) { GameFiles.flush() }
}
