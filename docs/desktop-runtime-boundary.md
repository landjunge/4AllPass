# macOS hardened runtime: measured local profile

The source entitlement profile retains only network client/server. It removes
`allow-jit`, `allow-unsigned-executable-memory` and `disable-library-validation`.
The existing `hardenedRuntime: true` remains.

Each exception was absent during the same actual native WKWebView journey:
account signup, vault creation, recovery-kit download, lock/master unlock,
synthetic CSV preview/confirmation and a second unlock. Both parent and
PyInstaller core were signed with runtime and the exact two-key source plist.
Existing JS Argon2id `mobile_safe` and a separate WASM42 engine check passed.
No crypto, capability, dependency or browser profile changed. See the
[dated evidence](evidence/h4-runtime-20261020/STATUS.md).

This supports removal for the measured Intel/macOS profile, not every JIT
tier, hardware PRF, archived Python library or release artifact. Network
entitlements without App Sandbox do not establish an OS egress sandbox.

`scripts/check-release-license.py --built` keeps deep/strict app signature
verification and inspects both `CFBundleExecutable` and the final bundled
`Contents/MacOS/fourallpass-core`. Each requires a valid signature, the actual
CodeDirectory runtime bit and none of the three enabled exceptions. Valid
adhoc signing alone is insufficient. The pre-bundle PyInstaller input cannot
satisfy the final bundled-core check.

Eight `scripts/test_macos_runtime_policy.py` methods use real codesign on private
copies: runtime acceptance, missing signature, adhoc without runtime, each of
the three exceptions, and good parent/unhardened core. Mac desktop CI runs
these before bundling. Other systems skip the seven native methods. Program
identifiers and paths cannot supply the runtime flag: only one actual
CodeDirectory line is accepted.

This gate supports the current separate thin Intel and Apple Silicon artifacts.
Universal/fat executables are explicitly refused: a default codesign display
only describes the host architecture and cannot establish all slices. It does
not silently accept another unhardened architecture. Universal support needs
its own future per-architecture policy and native candidate acceptance.

The gate records hashes and effective flags. It does not prove Developer ID,
notarization, provenance, updates or an installed version. Historical installed
app/core signatures were only `0x2 (adhoc)`; their bytes remain unchanged. A new
release candidate still needs its own package gate and normal native journey.

DE: Drei Code-Ausnahmen entfallen nach echter nativer Prüfung. Das Paket-Gate
prüft Hauptprogramm und gebündelten Core getrennt. Die installierte App ist
damit weder aktualisiert noch nachträglich gehärtet oder notarisiert.
