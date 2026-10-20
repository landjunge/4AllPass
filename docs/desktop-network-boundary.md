# Local bundled desktop network boundary (E04 / H2)

This slice narrows the bundled desktop's local transport profile. It does not
approve a package, arbitrary remote storage, HIBP, OS egress isolation or the
separate H4 entitlements. Account/vault authentication and cryptography are
unchanged. The existing H3 window/command ACL remains in force.

## Webview connections

The production `connect-src` is:

```
'self' ipc: http://ipc.localhost http://127.0.0.1:8788
```

The exact loopback origin retains the optional local HTTP broker path. There is
no production frontend WebSocket implementation; arbitrary loopback ports and
all `ws:` destinations are removed. IPC schemes are explicit. Other CSP
directives, including the existing WASM token, automatic Tauri asset CSP
modifications and macOS entitlements remain unchanged.

Default desktop API calls use the existing main-only `sidecar_http` command,
not browser fetch. The human UI stays on bundled assets. Rust HTTP is outside
Webview CSP, so its separate target checks below are necessary.

## Fixed native API transport

The public command accepts method/path/headers/body, never a target URL or
port. Its only normal destination is `http://127.0.0.1:8788`. The internal test
helper substitutes an owned ephemeral port while retaining that literal host.
No production-configurable transport adapter or new IPC command is introduced.

`sidecar_target.rs` separates query data, rejects raw controls/space, fragments
and raw backslashes/encoded path separators, parses through the existing `tauri::Url`
reexport and checks the resulting scheme, literal host, core port, absent
userinfo and normalized `/api/v1` or `/api/v1/…` path. The same parsed URL is
passed to `ureq::Agent::request_url`; a raw prefix alone is insufficient because
raw or encoded dot segments can normalize outside the API. Encoded delimiters
in query values are ordinary data. Regular encoded path parameters such as
spaces, plus/equal signs, percent and UTF-8 remain supported; existing frontend
credential paths use base64url IDs rather than encoded slash separators.
This is this fixed core route's contract, not a universal URL sanitizer.

The agent has `redirects(0)`. Absolute and relative 3xx responses return their
existing status/body; they do not make a second request or forward headers to a
different listener. Existing method selection, Host/Content-Length stripping,
timeout and status/body representation remain. No live credentials are used in
tests; the two-listener test includes only an explicitly synthetic auth marker.

## Supported profiles and limits

| Profile/function | Current boundary |
| --- | --- |
| Default bundled local API | Main-only native command to the fixed local API; ordinary setup/port ownership remains separate. |
| Optional local broker | Exact HTTP127.0.0.1:8788 retained. CSP permission alone does not prove broker CORS, pairing, transport success or a fresh authenticated peer/unlock. In particular macOS `tauri://localhost` versus backend HTTP(S)tauri.localhost CORS still needs its own acceptance. |
| Custom remote storage setting | UI accepts HTTPS or loopback HTTP origins. Arbitrary HTTPS was already blocked by native CSP; incidental arbitrary local-port browser access is now removed. Generic native selfhost is not accepted by this local profile. It needs a separately reviewed exact trusted origin/build profile and matching transport/CORS/RP policy. A UI string does not authorize `https:` or `http://127.0.0.1:*`. Browser-hosted PWA is a different profile. |
| HIBP vault health | Automatic range lookup exists, but native HTTPS remains blocked and the hook skips errors. No HIBP host is newly allowed. An opt-in supported profile needs separate disclosure/transport/compatibility review. H1 account registration remains offline. |
| Development helper/HMR | Vite/Node ports and HMR are outside this production profile. |

## Executable isolated checks

On macOS:

```sh
python3 scripts/test-native-network-boundary.py --output /private/new-h2-evidence
python3 scripts/test-native-command-acl.py --check-product --output /private/h3-regression
```

The H2 runner builds the same opt-in H3 binary with an additional
`native-network-probe` feature. There is one real command contract, handler,
window builder and ACL oracle. The extra JS hook exists only in that test
feature; the plain H3 invocation makes no network connections. Release builds
reject the inherited native test feature, and the ordinary startup entry still
refuses it. No normal sidecar/tray setup or port8788 inspection occurs.

A private dist copies the shipped prompt page/JS. Three real Incognito
WKWebViews keep all33 command/event checks and the real Deny→Rust event. An
owned `127.0.0.1:0` synthetic HTTP/WebSocket listener receives no auth/cookies.
A private config overlay restores only the original connect-src wildcard:
all three windows must get the fixed HTTP body and a real WebSocket open.
The actual product policy must instead produce connect-src violation events
for both URLs and zero listener requests, while all33 ACL outcomes remain
correct. Receipts, listener counters and process exit must agree. Windows,
native process, empty fixture, private dist and listener are cleaned up.

Ordinary Rust unit tests use actual loopback listeners and the same internal
request function for 301/302/303/307/308 GET/POST redirects, relative redirects,
200/204/401, path escapes and real credential/query compatibility shapes.
They never contact8788. The native CSP run does not substitute for normal
startup/unlock/import, backend broker CORS, hardware/PRF, remote profiles,
cross-platform builds, installed packages or entitlement acceptance.
