import UIKit
import WebKit
import AVFoundation
import Network

// Serves the bundled game folder over a custom scheme (flf://app/...) so the
// game behaves like it is on a web server (RequireJS, audio seeking, storage).
final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {
    let root: URL
    init(root: URL) { self.root = root }

    static let mime: [String: String] = [
        "html": "text/html", "htm": "text/html", "js": "application/javascript",
        "css": "text/css", "json": "application/json", "png": "image/png",
        "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif", "bmp": "image/bmp",
        "svg": "image/svg+xml", "mp3": "audio/mpeg", "m4a": "audio/mp4", "ogg": "audio/ogg",
        "wav": "audio/wav", "ac3": "audio/ac3", "txt": "text/plain", "ico": "image/x-icon",
        "woff": "font/woff", "woff2": "font/woff2", "ttf": "font/ttf"
    ]

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        var path = url.path.removingPercentEncoding ?? url.path
        if path.hasPrefix("/") { path.removeFirst() }
        // built-in LAN "lobby server" (see web/lan)
        let aliases = ["protocol": "lan/protocol.json", "lobby": "lan/lobby.html", "lan-transport.js": "lan/lan-transport.js"]
        if let a = aliases[path] { path = a }
        let file = root.appendingPathComponent(path).standardizedFileURL
        guard file.path.hasPrefix(root.standardizedFileURL.path),
              let data = try? Data(contentsOf: file, options: .mappedIfSafe) else {
            let r = HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: [:])!
            task.didReceive(r); task.didReceive(Data()); task.didFinish(); return
        }
        let type = BundleSchemeHandler.mime[file.pathExtension.lowercased()] ?? "application/octet-stream"
        var headers = ["Content-Type": type, "Accept-Ranges": "bytes",
                       "Access-Control-Allow-Origin": "*", "Cache-Control": "no-cache"]
        var body = data
        var status = 200
        if let range = task.request.value(forHTTPHeaderField: "Range"), range.hasPrefix("bytes=") {
            let parts = range.dropFirst(6).split(separator: "-", omittingEmptySubsequences: false)
            let total = data.count
            var start = Int(parts.first ?? "") ?? 0
            var end = parts.count > 1 ? (Int(parts[1]) ?? total - 1) : total - 1
            if parts.first?.isEmpty == true, let suffix = Int(parts.count > 1 ? parts[1] : "") {
                start = max(0, total - suffix); end = total - 1
            }
            end = min(end, total - 1)
            if start <= end && total > 0 {
                body = data.subdata(in: start..<(end + 1))
                status = 206
                headers["Content-Range"] = "bytes \(start)-\(end)/\(total)"
            }
        }
        headers["Content-Length"] = String(body.count)
        let resp = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
        task.didReceive(resp)
        task.didReceive(body)
        task.didFinish()
    }
    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}


// MARK: - LAN multiplayer link (two phones on the same Wi-Fi)

final class LanLink {
    weak var web: WKWebView?
    private var listener: NWListener?
    private var conn: NWConnection?
    private var browser: NWBrowser?
    private var found: [String: NWEndpoint] = [:]
    private var buffer = Data()
    private let port: NWEndpoint.Port = 47474
    private let q = DispatchQueue(label: "flf.lan")

    private func params() -> NWParameters {
        let tcp = NWProtocolTCP.Options()
        tcp.noDelay = true
        let p = NWParameters(tls: nil, tcp: tcp)
        p.includePeerToPeer = true
        return p
    }

    private func js(_ code: String) {
        DispatchQueue.main.async { self.web?.evaluateJavaScript(code, completionHandler: nil) }
    }
    private func event(_ dict: [String: Any]) {
        guard let d = try? JSONSerialization.data(withJSONObject: dict), let s = String(data: d, encoding: .utf8) else { return }
        js("window.__lan && __lan.event(\(s))")
    }

    func handle(_ body: [String: Any]) {
        switch body["cmd"] as? String ?? "" {
        case "host": q.async { self.host() }
        case "join": q.async { self.join(host: body["host"] as? String, service: body["service"] as? String) }
        case "browse": q.async { self.browse() }
        case "send": if let s = body["data"] as? String { q.async { self.send(s) } }
        case "stop": q.async { self.stop() }
        default: break
        }
    }

    private func stop() {
        conn?.cancel(); conn = nil
        listener?.cancel(); listener = nil
        browser?.cancel(); browser = nil
        buffer = Data()
    }

    private func host() {
        stop()
        do {
            let l = try NWListener(using: params(), on: port)
            l.service = NWListener.Service(name: UIDevice.current.name, type: "_flf._tcp")
            l.newConnectionHandler = { [weak self] c in
                guard let self = self else { return }
                if self.conn != nil { c.cancel(); return }
                self.use(c)
            }
            l.stateUpdateHandler = { [weak self] st in
                switch st {
                case .ready: self?.event(["type": "hosting", "ips": LanLink.localIPs()])
                case .failed(let e): self?.event(["type": "error", "msg": "تعذّرت الاستضافة: \(e)"])
                default: break
                }
            }
            l.start(queue: q)
            listener = l
        } catch {
            event(["type": "error", "msg": "تعذّرت الاستضافة: \(error)"])
        }
    }

    private func browse() {
        browser?.cancel()
        let b = NWBrowser(for: .bonjour(type: "_flf._tcp", domain: nil), using: params())
        b.browseResultsChangedHandler = { [weak self] results, _ in
            guard let self = self else { return }
            self.found = [:]
            var hosts: [[String: Any]] = []
            for r in results {
                if case let .service(name, _, _, _) = r.endpoint {
                    self.found[name] = r.endpoint
                    hosts.append(["name": name])
                }
            }
            self.event(["type": "found", "hosts": hosts])
        }
        b.start(queue: q)
        browser = b
    }

    private func join(host: String?, service: String?) {
        conn?.cancel(); conn = nil
        let ep: NWEndpoint
        if let s = service, let e = found[s] { ep = e }
        else if let h = host, !h.isEmpty { ep = .hostPort(host: NWEndpoint.Host(h), port: port) }
        else { event(["type": "error", "msg": "اكتب عنوان المضيف"]); return }
        use(NWConnection(to: ep, using: params()))
    }

    private func use(_ c: NWConnection) {
        conn = c
        buffer = Data()
        c.stateUpdateHandler = { [weak self] st in
            guard let self = self else { return }
            switch st {
            case .ready:
                self.browser?.cancel(); self.browser = nil
                self.event(["type": "connected"])
                self.receive()
            case .waiting(let e):
                self.event(["type": "error", "msg": "بانتظار الشبكة… \(e.localizedDescription)"])
            case .failed(let e):
                self.event(["type": "error", "msg": "فشل الاتصال: \(e.localizedDescription)"])
                self.event(["type": "closed"])
                if self.conn === c { self.conn = nil }
            case .cancelled:
                if self.conn === c { self.conn = nil }
            default: break
            }
        }
        c.start(queue: q)
    }

    private func receive() {
        guard let c = conn else { return }
        c.receive(minimumIncompleteLength: 1, maximumLength: 1 << 16) { [weak self] data, _, done, err in
            guard let self = self else { return }
            if let d = data, !d.isEmpty {
                self.buffer.append(d)
                while let i = self.buffer.firstIndex(of: 10) {
                    let line = Data(self.buffer[self.buffer.startIndex..<i])
                    self.buffer = Data(self.buffer[self.buffer.index(after: i)..<self.buffer.endIndex])
                    if let s = String(data: line, encoding: .utf8),
                       let arr = try? JSONSerialization.data(withJSONObject: [s]),
                       let lit = String(data: arr, encoding: .utf8) {
                        self.js("window.__lan && __lan.recv(\(lit)[0])")
                    }
                }
            }
            if done || err != nil {
                self.event(["type": "closed"])
                return
            }
            self.receive()
        }
    }

    private func send(_ s: String) {
        var d = Data(s.utf8)
        d.append(10)
        conn?.send(content: d, completion: .contentProcessed { _ in })
    }

    static func localIPs() -> [String] {
        var out: [String] = []
        var ifaddr: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&ifaddr) == 0, let first = ifaddr else { return out }
        defer { freeifaddrs(ifaddr) }
        for p in sequence(first: first, next: { $0.pointee.ifa_next }) {
            let ifa = p.pointee
            guard let sa = ifa.ifa_addr, sa.pointee.sa_family == UInt8(AF_INET) else { continue }
            let name = String(cString: ifa.ifa_name)
            guard name.hasPrefix("en") || name.hasPrefix("bridge") else { continue }
            var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            if getnameinfo(sa, socklen_t(sa.pointee.sa_len), &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST) == 0 {
                let ip = String(cString: host)
                if !ip.hasPrefix("169.254") && !out.contains(ip) { out.append(ip) }
            }
        }
        return out
    }
}

final class GameViewController: UIViewController, WKUIDelegate, WKScriptMessageHandler {
    var web: WKWebView!
    let lan = LanLink()

    func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "lan", let body = message.body as? [String: Any] { lan.handle(body) }
    }

    override func loadView() {
        let cfg = WKWebViewConfiguration()
        let root = Bundle.main.resourceURL!.appendingPathComponent("www")
        cfg.setURLSchemeHandler(BundleSchemeHandler(root: root), forURLScheme: "flf")
        cfg.allowsInlineMediaPlayback = true
        cfg.mediaTypesRequiringUserActionForPlayback = []
        cfg.websiteDataStore = .default()
        if let js = try? String(contentsOf: root.appendingPathComponent("lan/lan-bridge.js"), encoding: .utf8) {
            cfg.userContentController.addUserScript(
                WKUserScript(source: js, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        cfg.userContentController.add(self, name: "lan")
        for name in ["flf-touch.js", "tournament.js", "stage.js"] {
            if let js = try? String(contentsOf: root.appendingPathComponent(name), encoding: .utf8) {
                cfg.userContentController.addUserScript(
                    WKUserScript(source: js, injectionTime: .atDocumentStart, forMainFrameOnly: true))
            }
        }
        web = WKWebView(frame: .zero, configuration: cfg)
        web.uiDelegate = self
        lan.web = web
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
        web.load(URLRequest(url: URL(string: "flf://app/F/F.LF/game/game.html")!))
    }

    // keep alert() popups from the game working
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
        // play game sound even when the ringer/silent switch is on silent
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
