# E04 / H2 — local bundled network boundary

20 October2026. Source slice on integrated H3-main49256b3. Author tests below;
independent review/PR checks/integration remain gates. No package, normal8788
startup, hardware/PRF, generic selfhost or fullE04/H4 acceptance is claimed.

## Changed contract

The exact local CSP permits self, explicit IPC and HTTP127.0.0.1:8788, without
arbitrary loopback ports or WS. No external HIBP/HTTPS host is newly allowed.
Native API transport separately parses its fixed target with existing tauri::Url,
checks the normalized exact loopback/core-port/API path and passes that same
URL to ureq. Redirects0 prevents absolute and relative follow-ups. No new target
URL/port argument or own command, dependency, entitlement or permission.
Query values and regular percent-encoded path parameters remain data; fragments,
raw/encoded path escapes and ambiguous path separators are refused.

## Actual native evidence

`python3 scripts/test-native-network-boundary.py --output <new-private-folder>`
extends the SAME H3 test binary/real handler/window builder/compiled ACL. Both
modes use private shipped prompt assets, three real Incognito WKWebViews and a
fresh empty browser fixture before/instead of all normal sidecar/tray setup.

- Original connect-src wildcard restored only in a private config overlay:
  all three windows read the fixed HTTP body and open the synthetic WebSocket;
  listener records3HTTP+3WS, no Authorization/Cookie headers. Native exit0.
- Actual product CSP: all three windows record real connect-src violation events
  for HTTP and WS; listener records0HTTP/0WS. Native exit0.
- BOTH modes preserve33/33 actual command/event ACL outcomes and the actual
  shipped prompt Deny→Rust event. No mocked/noop command or replacement app.
- Separate plain H3 runner remains33/33, network extension absent in all windows,
  empty fixture; the ordinary H3 feature creates no HTTP/WS probe socket.

`native-results.json` retains the exact H2 outcomes/violation URLs, actual ACL
counts, real decision event and listener observations. Full33-row receipts and
build/native logs remain privately in h2-product-native-final. First diagnostic
private WS fixture used HTTP/1.0 and failed its open oracle despite receiving
handshakes; that receipt is preserved and NOT counted. Final fixture uses a
proper HTTP/1.1 handshake, and both final modes satisfy their complete oracle.

## Transport and compatibility evidence

- Ordinary feature build (no native test feature), real Rust tests:41 passed,
  including prior34,6 new transport tests and the delayed-header fixture regression. Synthetic own-listener tests cover
 301/302/303/307/308 GET/POST without second-listener/auth disclosure, relative
 redirects,200/204/401, raw/encoded dot escapes, encoded separators/backslashes,
 fragments/substrings, regular base64url credential paths, encoded UTF-8/percent
 data and queries containing another listener URL without contacting it.
- The same six tests compiled with the actual pre-fix function body from49256b3
  in a private NON-Git copy (only test core-port parameter/wrapper added):4 fail,
 2 pass, exit101; exact candidate6 pass. Three failures expose redirect/path
 gaps; the fourth includes newly supported API-root query syntax. No endpoint
 hook substitutes a fake transport. Logs/source copies remain in private
 h2-private-native/unit-red-green.
- Earlier isolated real original sidecar function: five GET redirect types reach
  a second owned listener and a relative redirect escapes the API path. Private
 redirects0 returns original3xx and zero follow-ups. Raw dot traversal likewise
 reached outside the API; the committed normalized-target guard closes it.
- Frontend226/226 and typecheck pass. No UI changes. These tests cover existing
 routing/cache unlock/import logic, not a full installed native human workflow.

Final native source digests were compared to the current files after runtime
freeze. SHA256SUMS preserves full source fingerprints without secret-shaped
JSON assignments; JSON references it. Build locks/dependencies are unchanged.
All fixture listeners, test processes/windows, private dist and empty browser
fixtures were stopped/removed. No8788 request/listen/reap or user profile/DB,
credential, grant, tunnel, service or installed app mutation.

Exact profile support and remaining remote-storage/HIBP/broker-CORS/normal-use/
package/H4 limits: [desktop network contract](../../desktop-network-boundary.md).

## Rebase identity

Rebased onto AP04/KDF-doc main `2bfe0c677ceda1352db98201dc568067600dccfe`.
Before the fixture correction below, the complete src-tauri tree and both network Python files remained byte-identical
to tested source pin `9caf825e53d1e1eb28f540a0899b996ef9d7d85f`; frontend is
also unchanged. SHA256SUMS matches committed files. Only documentation conflict
context was reconciled, preserving main's other milestone rows. No native rerun
is inferred from a docs rebase. Official Gitleaks8.24.3 over the entire own PR
history reports zero findings/exit0; no scan rules or exclusions changed.

## Independent-review fixture correction

Root's first parallel normal-feature run exposed37 passes/3 fixture failures
(UnexpectedEOF/status-line EINVAL), while a serial6-test run passed. Root then
measured Darwin accepted-socket flags: O_NONBLOCK inherited from the listener.
This was test-harness instability, not a product-network defect. The fixture now
explicitly sets accepted sockets blocking before read_timeout.

The regression connects an owned TCP client, delays headers30ms and requires
a complete200 fixture response. Compiling the actual std-only fixture/test with
only that fix line removed fails exit101; the fixed file passes exit0. The full
normal-feature suite now passes41/41 in parallel. Private before/after and
parallel logs: h2-fixture-delayed-headers. All product/native-probe/command/ACL/
CSP files and both network scripts remain byte-identical to41866db; only the
unit-only fixture and evidence changed. SHA256SUMS updates that one test file.
Independent review and fresh PR CI remain required; no new native run or package
acceptance is inferred from this fixture-only repair.
