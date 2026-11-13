// Real macOS WKWebView Ed25519/PKCS#8 probe. No install, no OS changes.
// Prints one JSON line and exits. Run: swift tools/wk-ed25519-probe.swift
import Cocoa
import WebKit

final class Handler: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        webView.evaluateJavaScript("JSON.stringify({secure: window.isSecureContext, ua: navigator.userAgent})") { result, error in
            print("{\"stage\":\"didFinish\",\"result\":\(result.map { String(describing: $0) } ?? "nil"),\"error\":\(error.map { String(describing: $0) } ?? "nil")}")
            fflush(stdout)
        }
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        if let data = try? JSONSerialization.data(withJSONObject: message.body),
           let text = String(data: data, encoding: .utf8) {
            print(text)
        } else {
            print("{\"ok\":false,\"error\":\"unprintable message\"}")
        }
        fflush(stdout)
        exit(0)
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)

let config = WKWebViewConfiguration()
let handler = Handler()
config.userContentController.add(handler, name: "probe")
let web = WKWebView(frame: NSRect(x: 0, y: 0, width: 320, height: 200), configuration: config)
web.navigationDelegate = handler
let window = NSWindow(
    contentRect: NSRect(x: 0, y: 0, width: 320, height: 200),
    styleMask: [.borderless],
    backing: .buffered,
    defer: false
)
window.contentView = web
window.makeKeyAndOrderFront(nil)
app.activate(ignoringOtherApps: true)

let html = #"""
<!doctype html><meta charset="utf-8"><title>probe</title>
<script>
(async () => {
  const fromHex = (h) => new Uint8Array(h.match(/.{2}/g).map((x) => parseInt(x, 16)));
  const toHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  const prefix = fromHex("302e020100300506032b657004220420");
  try {
    const seed = fromHex("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60");
    const der = new Uint8Array(prefix.length + seed.length);
    der.set(prefix); der.set(seed, prefix.length);
    const key = await crypto.subtle.importKey("pkcs8", der, "Ed25519", false, ["sign"]);
    const sig = new Uint8Array(await crypto.subtle.sign("Ed25519", key, new Uint8Array(0)));
    const pub = await crypto.subtle.importKey(
      "raw",
      fromHex("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a"),
      "Ed25519", false, ["verify"]);
    const verified = await crypto.subtle.verify("Ed25519", pub, sig, new Uint8Array(0));
    webkit.messageHandlers.probe.postMessage({
      ok: verified && toHex(sig) === "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b",
      signatureHex: toHex(sig),
      userAgent: navigator.userAgent,
      secureContext: window.isSecureContext
    });
  } catch (error) {
    webkit.messageHandlers.probe.postMessage({ ok: false, error: String(error), userAgent: navigator.userAgent });
  }
})();
</script>
"""#
app.finishLaunching()
DispatchQueue.main.async {
    web.loadHTMLString(html, baseURL: URL(string: "https://localhost/"))
}
DispatchQueue.main.asyncAfter(deadline: .now() + 15) {
    print("{\"ok\":false,\"error\":\"timeout\"}")
    fflush(stdout)
    exit(2)
}
app.run()
