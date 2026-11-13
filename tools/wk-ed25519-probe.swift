import Cocoa
import WebKit

final class Probe: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate {
    var window: NSWindow!
    var web: WKWebView!
    var done = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "probe")
        web = WKWebView(frame: NSRect(x: 0, y: 0, width: 480, height: 320), configuration: config)
        web.navigationDelegate = self
        window = NSWindow(contentRect: NSRect(x: 120, y: 120, width: 480, height: 320),
                          styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.title = "WK Ed25519 probe"
        window.contentView = web
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        web.loadHTMLString(Self.html, baseURL: URL(string: "https://localhost/"))
        DispatchQueue.main.asyncAfter(deadline: .now() + 20) { self.finish(["ok": false, "error": "timeout"]) }
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any] else {
            finish(["ok": false, "error": "unprintable"]); return
        }
        if body["stage"] != nil { return }
        finish(body)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        finish(["ok": false, "error": "navigation_failed: \(error.localizedDescription)"])
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        finish(["ok": false, "error": "provisional_failed: \(error.localizedDescription)"])
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        finish(["ok": false, "error": "content_process_exit"])
    }

    private func finish(_ payload: [String: Any]) {
        guard !done else { return }
        done = true
        let data = try? JSONSerialization.data(withJSONObject: payload)
        try? data?.write(to: URL(fileURLWithPath: "/tmp/wk-ed25519-result.json"))
        NSApp.terminate(nil)
    }

    static let html = #"""
<!doctype html><meta charset="utf-8">
<script>
(async () => {
  const fromHex = (h) => new Uint8Array(h.match(/.{2}/g).map((x) => parseInt(x, 16)));
  const toHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  const post = (o) => webkit.messageHandlers.probe.postMessage(Object.assign({secureContext: window.isSecureContext, userAgent: navigator.userAgent}, o));
  post({stage: "js-start"});
  try {
    const seed = fromHex("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60");
    const pub = fromHex("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a");
    const expected = "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b";
    const verifyPub = await crypto.subtle.importKey("raw", pub, "Ed25519", false, ["verify"]);
    const attempts = {};
    const tryVariant = async (name, der) => {
      try {
        const key = await crypto.subtle.importKey("pkcs8", der, "Ed25519", false, ["sign"]);
        const sig = new Uint8Array(await crypto.subtle.sign("Ed25519", key, new Uint8Array(0)));
        const ver = await crypto.subtle.verify("Ed25519", verifyPub, sig, new Uint8Array(0));
        attempts[name] = {signatureHex: toHex(sig), rfc: toHex(sig) === expected, verifies: ver};
      } catch (e) { attempts[name] = {error: String(e)}; }
    };
    const seedOnly = new Uint8Array([...fromHex("302e020100300506032b657004220420"), ...seed]);
    const seedPub = new Uint8Array([...fromHex("304c020100300506032b65700440"), ...seed, ...pub]);
    const withPub = new Uint8Array([...fromHex("304f020101300506032b6570812100"), ...seed, ...pub]);
    await tryVariant("seed32", seedOnly);
    await tryVariant("seed_pub64", seedPub);
    await tryVariant("v2_with_pub", withPub);
    const rfc = Object.values(attempts).some((a) => a.rfc && a.verifies);
    const pair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
    const spki = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
    const msg = new TextEncoder().encode("wk-ed25519-selftest");
    const own = new Uint8Array(await crypto.subtle.sign("Ed25519", pair.privateKey, msg));
    const selfTest = await crypto.subtle.verify("Ed25519", pair.publicKey, own, msg);
    const exported = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
    const reimported = await crypto.subtle.importKey("pkcs8", exported, "Ed25519", false, ["sign"]);
    const round = new Uint8Array(await crypto.subtle.sign("Ed25519", reimported, msg));
    const roundTrip = toHex(round) === toHex(own) && await crypto.subtle.verify("Ed25519", pair.publicKey, round, msg);
    post({ok: rfc && selfTest && roundTrip, rfcVector: rfc, selfTest: selfTest, roundTrip: roundTrip, attempts: attempts, publicKeyHex: toHex(spki)});
  } catch (error) { post({ok: false, error: String(error)}); }
})();
</script>
"""#
}

let app = NSApplication.shared
let probe = Probe()
app.delegate = probe
app.setActivationPolicy(.regular)
app.run()
