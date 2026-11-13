import UIKit
import WebKit
import AVFoundation
import UniformTypeIdentifiers
import Network

// MARK: - The Windows XP disk kept on the phone (every change Windows makes is written into it)

enum GameFiles {
    static var dir: URL {
        let d = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("winxp", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }
    static var disk: URL { dir.appendingPathComponent("xp.img") }
    static var diskSize: Int64 {
        (try? FileManager.default.attributesOfItem(atPath: disk.path)[.size] as? NSNumber)?.int64Value ?? 0
    }
    static func ready() -> Bool { diskSize >= 64 << 20 }

    // a new empty disk for installing XP (sparse: takes space only as Windows fills it)
    static func newDisk(gb: Int) throws {
        closeDisk()
        try? FileManager.default.removeItem(at: disk)
        FileManager.default.createFile(atPath: disk.path, contents: nil)
        let h = try FileHandle(forWritingTo: disk)
        try h.truncate(atOffset: UInt64(gb) << 30)
        try h.close()
    }

    // writes from the emulator, applied in order; the page is told which ones are on disk
    static let writeQ = DispatchQueue(label: "disk-writes")
    static var writeHandle: FileHandle?
    static weak var web: WKWebView?
    static var lastSeq = 0
    static var ackPending = false
    static func write(offset: UInt64, data: Data, seq: Int) {
        writeQ.async {
            if writeHandle == nil { writeHandle = try? FileHandle(forWritingTo: disk) }
            if let h = writeHandle {
                h.seek(toFileOffset: offset)
                h.write(data)
            }
            lastSeq = seq
            if !ackPending {
                ackPending = true
                writeQ.asyncAfter(deadline: .now() + 0.02) {
                    ackPending = false
                    let s = lastSeq
                    DispatchQueue.main.async { web?.evaluateJavaScript("window.__wAck && __wAck(\(s))") }
                }
            }
        }
    }
    static func flush() { writeQ.sync { writeHandle?.synchronizeFile() } }
    static func closeDisk() { writeQ.sync { try? writeHandle?.close(); writeHandle = nil } }
}

final class Preparer: NSObject {
    var finished: (String?) -> Void = { _ in }
    var needSource: () -> Void = {}
    func run() { if GameFiles.ready() { finished(nil) } else { needSource() } }

    // a ready XP disk picked in the Files app (.img / .raw / .bin / .hdd)
    func importPicked(_ urls: [URL]) -> String? {
        guard let u = urls.first(where: { ["img", "raw", "bin", "hdd", "ima"].contains($0.pathExtension.lowercased()) }) else {
            return "اختر ملف قرص (.img) — ملف ISO يُستخدم من زر التثبيت"
        }
        GameFiles.closeDisk()
        let fm = FileManager.default
        try? fm.removeItem(at: GameFiles.disk)
        do { try fm.moveItem(at: u, to: GameFiles.disk) } catch {
            do { try fm.copyItem(at: u, to: GameFiles.disk) } catch { return error.localizedDescription }
        }
        return GameFiles.ready() ? nil : "الملف صغير جداً ليكون قرص Windows"
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
            file = name == "xp.img" ? GameFiles.disk : GameFiles.dir.appendingPathComponent(name)
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


// MARK: - Internet for Windows: a Wisp server inside the app (v86 NE2000 -> phone network)

final class WispBridge {
    weak var web: WKWebView?
    private let q = DispatchQueue(label: "wisp")
    private var conns: [UInt32: NWConnection] = [:]
    private var got: [UInt32: Int] = [:]
    private var out: [String] = []
    private var flushing = false
    private let window: UInt32 = 128

    private func frame(_ type: UInt8, _ id: UInt32, _ payload: Data) -> Data {
        var d = Data([type, UInt8(id & 0xff), UInt8(id >> 8 & 0xff), UInt8(id >> 16 & 0xff), UInt8(id >> 24 & 0xff)])
        d.append(payload); return d
    }
    private func u32(_ v: UInt32) -> Data { Data([UInt8(v & 0xff), UInt8(v >> 8 & 0xff), UInt8(v >> 16 & 0xff), UInt8(v >> 24 & 0xff)]) }

    private func emit(_ d: Data) {
        out.append(d.base64EncodedString())
        if flushing { return }
        flushing = true
        q.asyncAfter(deadline: .now() + 0.004) {
            let batch = self.out; self.out = []; self.flushing = false
            let js = "window.__wispRecv && __wispRecv([\"" + batch.joined(separator: "\",\"") + "\"])"
            DispatchQueue.main.async { self.web?.evaluateJavaScript(js) }
        }
    }

    func open() {
        q.async {
            self.conns.values.forEach { $0.cancel() }
            self.conns = [:]; self.got = [:]
            self.emit(self.frame(3, 0, self.u32(self.window)))
        }
    }

    func incoming(_ b64: String) {
        guard let d = Data(base64Encoded: b64), d.count >= 5 else { return }
        q.async { self.handle([UInt8](d)) }
    }

    private func close(_ id: UInt32, reason: UInt8) {
        guard let c = conns.removeValue(forKey: id) else { return }
        got[id] = nil
        c.cancel()
        emit(frame(4, id, Data([reason])))
    }

    private func handle(_ b: [UInt8]) {
        let id = UInt32(b[1]) | UInt32(b[2]) << 8 | UInt32(b[3]) << 16 | UInt32(b[4]) << 24
        switch b[0] {
        case 1: // CONNECT
            guard b.count >= 8 else { return }
            let udp = b[5] == 2
            let port = UInt16(b[6]) | UInt16(b[7]) << 8
            let host = String(decoding: b[8...], as: UTF8.self)
            guard let p = NWEndpoint.Port(rawValue: port), !host.isEmpty else {
                emit(frame(4, id, Data([0x42]))); return
            }
            let c = NWConnection(host: NWEndpoint.Host(host), port: p, using: udp ? .udp : .tcp)
            conns[id] = c; got[id] = 0
            c.stateUpdateHandler = { [weak self] st in
                guard let self = self else { return }
                switch st {
                case .ready: self.receive(id, c, udp: udp)
                case .failed: self.close(id, reason: 0x44)
                case .waiting: self.close(id, reason: 0x44)
                case .cancelled: self.close(id, reason: 0x02)
                default: break
                }
            }
            c.start(queue: q)
        case 2: // DATA
            guard let c = conns[id] else { return }
            c.send(content: Data(b[5...]), completion: .contentProcessed { _ in })
            let n = (got[id] ?? 0) + 1
            got[id] = n
            if n % 64 == 0 { emit(frame(3, id, u32(window))) }
        case 4: // CLOSE from Windows
            if let c = conns.removeValue(forKey: id) { got[id] = nil; c.cancel() }
        default: break
        }
    }

    private func receive(_ id: UInt32, _ c: NWConnection, udp: Bool) {
        if udp {
            c.receiveMessage { [weak self] data, _, _, err in
                guard let self = self, self.conns[id] != nil else { return }
                if let d = data, !d.isEmpty { self.emit(self.frame(2, id, d)) }
                if err != nil { self.close(id, reason: 0x02) } else { self.receive(id, c, udp: true) }
            }
            return
        }
        c.receive(minimumIncompleteLength: 1, maximumLength: 16384) { [weak self] data, _, done, err in
            guard let self = self, self.conns[id] != nil else { return }
            if let d = data, !d.isEmpty { self.emit(self.frame(2, id, d)) }
            if done || err != nil { self.close(id, reason: 0x02) } else { self.receive(id, c, udp: false) }
        }
    }

    // DNS for Windows (v86 asks DNS-over-HTTPS; done here so the page needs no CORS)
    func dns(id: Int, query b64: String) {
        guard let q = Data(base64Encoded: b64) else { return }
        let servers = ["https://cloudflare-dns.com/dns-query", "https://dns.google/dns-query"]
        func ask(_ i: Int) {
            guard i < servers.count, let u = URL(string: servers[i]) else { answer(nil); return }
            var r = URLRequest(url: u, timeoutInterval: 8)
            r.httpMethod = "POST"
            r.setValue("application/dns-message", forHTTPHeaderField: "Content-Type")
            r.setValue("application/dns-message", forHTTPHeaderField: "Accept")
            r.httpBody = q
            URLSession.shared.dataTask(with: r) { d, resp, _ in
                if let d = d, (resp as? HTTPURLResponse)?.statusCode == 200, !d.isEmpty { answer(d) } else { ask(i + 1) }
            }.resume()
        }
        func answer(_ d: Data?) {
            let s = d.map { "\"" + $0.base64EncodedString() + "\"" } ?? "null"
            DispatchQueue.main.async { self.web?.evaluateJavaScript("window.__dohDone && __dohDone(\(id), \(s))") }
        }
        ask(0)
    }
}

// MARK: - UI

final class GameViewController: UIViewController, WKScriptMessageHandler, WKUIDelegate, UIDocumentPickerDelegate {
    var web: WKWebView!
    let preparer = Preparer()
    let wisp = WispBridge()

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
        GameFiles.web = web
        preparer.needSource = { [weak self] in
            self?.web.evaluateJavaScript("window.lf2NeedSource && lf2NeedSource('')")
        }
        preparer.finished = { [weak self] err in
            if let err = err {
                let e = err.replacingOccurrences(of: "\"", with: "'")
                self?.web.evaluateJavaScript("window.lf2Error && lf2Error(\"\(e)\")")
            } else {
                self?.web.evaluateJavaScript("window.__netOff = \(UserDefaults.standard.bool(forKey: "netOff")); window.lf2Ready && lf2Ready(\(GameFiles.diskSize))")
            }
        }
        web.load(URLRequest(url: URL(string: "lf2://app/index.html")!))
    }

    func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let cmd = body["cmd"] as? String else { return }
        if cmd == "prepare" { DispatchQueue.main.async { self.preparer.run() } }
        if cmd == "newdisk" {
            let gb = (body["gb"] as? NSNumber)?.intValue ?? 8
            do {
                try GameFiles.newDisk(gb: gb)
                web.evaluateJavaScript("window.xpNewDiskDone && xpNewDiskDone(\(GameFiles.diskSize))")
            } catch {
                web.evaluateJavaScript("window.lf2Error && lf2Error('تعذّر إنشاء القرص: \(error.localizedDescription.replacingOccurrences(of: "'", with: " "))')")
            }
        }
        if cmd == "pick" { DispatchQueue.main.async { self.pickFiles() } }
        if cmd == "net", let on = body["on"] as? Bool {
            UserDefaults.standard.set(!on, forKey: "netOff")
            GameFiles.flush()
            web.reload()
        }
        if cmd == "wisp_open" { wisp.web = web; wisp.open() }
        if cmd == "wisp", let d = body["d"] as? String { wisp.incoming(d) }
        if cmd == "doh", let id = body["id"] as? NSNumber, let d = body["d"] as? String { wisp.web = web; wisp.dns(id: id.intValue, query: d) }
        if cmd == "w", let o = body["o"] as? NSNumber, let d = body["d"] as? String, let data = Data(base64Encoded: d) {
            GameFiles.write(offset: o.uint64Value, data: data, seq: (body["s"] as? NSNumber)?.intValue ?? 0)
        }
        if cmd == "deletedisk" {
            let a = UIAlertController(title: "حذف قرص Windows XP؟",
                                      message: "سيُحذف القرص وكل ما بداخله، وتعود لشاشة التثبيت أو اختيار قرص جديد.",
                                      preferredStyle: .alert)
            a.addAction(UIAlertAction(title: "إلغاء", style: .cancel))
            a.addAction(UIAlertAction(title: "حذف", style: .destructive) { _ in
                GameFiles.closeDisk()
                try? FileManager.default.removeItem(at: GameFiles.disk)
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
        web.evaluateJavaScript("window.lf2Progress && lf2Progress('جارِ نسخ القرص… (قد يأخذ دقيقة)', 0.5)")
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

