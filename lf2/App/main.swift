import UIKit
import WebKit
import AVFoundation
import Compression

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

    static func ready() -> Bool {
        let fm = FileManager.default
        guard let a = try? fm.attributesOfItem(atPath: disk.path),
              (a[.size] as? NSNumber)?.int64Value == diskSize,
              let b = try? fm.attributesOfItem(atPath: stateFile.path),
              ((b[.size] as? NSNumber)?.int64Value ?? 0) > 1_000_000 else { return false }
        return true
    }
}

final class Preparer: NSObject {
    var report: (String, Double?) -> Void = { _, _ in }
    var finished: (String?) -> Void = { _ in }
    private var observation: NSKeyValueObservation?
    private var doneBytes: Double = 0

    func run() {
        if GameFiles.ready() { finished(nil); return }
        doneBytes = 0
        downloadAll(GameFiles.parts + [GameFiles.state], index: 0, collected: [])
    }

    private func downloadAll(_ names: [String], index: Int, collected: [URL]) {
        if index >= names.count {
            unpack(collected)
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
            do {
                try Preparer.gunzip(gz, to: tmp) { frac in
                    DispatchQueue.main.async { self.report("جارِ فك الضغط…", 0.86 + frac * 0.13) }
                }
                let fm = FileManager.default
                try? fm.removeItem(at: GameFiles.disk)
                try fm.moveItem(at: tmp, to: GameFiles.disk)
                try? fm.removeItem(at: GameFiles.stateFile)
                try fm.moveItem(at: stateDl, to: GameFiles.stateFile)
                gz.forEach { try? fm.removeItem(at: $0) }
                DispatchQueue.main.async {
                    if GameFiles.ready() { self.finished(nil) } else { self.finished("الملف غير مكتمل") }
                }
            } catch {
                DispatchQueue.main.async { self.finished(error.localizedDescription) }
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

        func pump(_ data: Data, finalize: Bool) throws {
            try data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
                let base = raw.bindMemory(to: UInt8.self).baseAddress ?? UnsafePointer<UInt8>(bitPattern: 1)!
                stream.pointee.src_ptr = base
                stream.pointee.src_size = raw.count
                repeat {
                    stream.pointee.dst_ptr = dst
                    stream.pointee.dst_size = dstSize
                    let st = compression_stream_process(stream, finalize ? Int32(COMPRESSION_STREAM_FINALIZE.rawValue) : 0)
                    if st == COMPRESSION_STATUS_ERROR { throw GzError(msg: "خطأ في فك الضغط") }
                    let n = dstSize - stream.pointee.dst_size
                    if n > 0 { outH.write(Data(bytes: dst, count: n)); written += Int64(n) }
                    if st == COMPRESSION_STATUS_END { ended = true; return }
                } while stream.pointee.src_size > 0 || stream.pointee.dst_size == 0
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
        if !ended { try pump(Data(), finalize: true) }
        guard written == GameFiles.diskSize else { throw GzError(msg: "حجم غير صحيح \(written)") }
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
            file = GameFiles.dir.appendingPathComponent(String(path.dropFirst(5)))
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
        var headers = ["Content-Type": type, "Accept-Ranges": "bytes", "Access-Control-Allow-Origin": "*"]
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

final class GameViewController: UIViewController, WKScriptMessageHandler, WKUIDelegate {
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
        if cmd == "reset" {
            try? FileManager.default.removeItem(at: GameFiles.dir)
            DispatchQueue.main.async { self.preparer.run() }
        }
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
}
