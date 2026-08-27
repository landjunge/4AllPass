# iOS Skeleton for Grok Build

> Prompt-ready spec for generating the first iOS client of 4AllPass.
> Goal: a clean, modern SwiftUI skeleton that reuses the existing crypto core and can grow into a real CredentialProvider / AutoFill extension without becoming throwaway code.

## 1. Stack (non-negotiable)

- **Language:** Swift only. No Objective-C.
- **UI:** SwiftUI (iOS 17+).
- **Build:** Xcode project / Swift Package Manager, multi-target.
- **DI:** Simple protocol-based DI or a tiny container; no heavy framework required for v1.
- **Min iOS:** 17. Target: latest stable.
- **Architecture:** MVVM + unidirectional data flow. ViewModels expose `@Published` / `Observable` state, views are stateless and observe state.

## 2. Target layout

```
4allpass-ios/
├── 4AllPass.xcodeproj
├── 4AllPass/                          # app target
│   ├── App/
│   ├── UI/
│   │   ├── OnboardingView.swift
│   │   ├── UnlockView.swift
│   │   ├── VaultListView.swift
│   │   ├── CredentialDetailView.swift
│   │   └── SettingsView.swift
│   ├── Domain/
│   └── DI/
├── 4AllPassCore/                      # SPM package: platform-independent crypto + vault logic
│   ├── Sources/4AllPassCore/
│   │   ├── Crypto/
│   │   └── Vault/
│   └── Tests/4AllPassCoreTests/
├── 4AllPassAutoFill/                  # CredentialProvider extension target
│   ├── CredentialProviderViewController.swift
│   ├── Info.plist                     # NSExtensionPointIdentifier = com.apple.authentication-services-credential-provider-ui
│   └── 4AllPassAutoFill.entitlements
└── 4AllPass.entitlements              # app entitlements (Keychain access groups, etc.)
```

### `4AllPassCore` package

- Reuse the existing crypto package from the desktop/Tauri repo as-is where possible (Argon2id, AES-256-GCM, envelopes, key hierarchy).
- Expose a small, pure Swift API:
  - `Vault.open(masterPassword:)` → `VaultSession`
  - `VaultSession.unlock()` / `lock()`
  - `VaultSession.getCredential(id:)` / `putCredential(entry:)`
  - `VaultSession.rotateDeviceKey()` (for hard revoke)
- No UIKit / iOS dependencies in `4AllPassCore`. It must compile and test on Linux/macOS via SPM.
- Port or wrap the Rust crypto via a thin Swift bridge only if a pure-Swift port is not feasible — prefer pure Swift first.

### App target (`4AllPass`)

- SwiftUI screens: `OnboardingView`, `UnlockView`, `VaultListView`, `CredentialDetailView`, `SettingsView`.
- Navigation via `NavigationStack`.
- Biometric unlock via `LocalAuthentication` (`LAContext`).
- Local settings via `Keychain` (no plaintext `UserDefaults` for secrets).
- Store the vault file in the app container; never in iCloud unless explicitly opted in later.

### `4AllPassAutoFill` extension

- `CredentialProviderViewController : ASCredentialProviderViewController`
  - `prepareCredentialList(for:)` → detect service identifiers, build credential list.
  - `provideCredentialWithoutUserInteraction(for:)` → return a `ASPasswordCredential` when allowed.
  - `prepareInterfaceToProvideCredential(for:)` → show UI to pick / confirm.
- Registered with:
  - `NSExtensionPointIdentifier = com.apple.authentication-services-credential-provider-ui`
  - Entitlements: `com.apple.developer.authentication-services.autofill-credential-provider = true`
- The extension talks to `4AllPassCore` only through the `VaultSession` API — never touches crypto internals directly.
- Shared container / App Group so the extension can read the vault the app wrote.

## 3. Security constraints (must hold)

- Vault key is random, never derived from the master password (matches `docs/crypto/key-derivation.md`).
- Server (if any) sees only ciphertext.
- AutoFill extension runs in its own sandbox; credentials are decrypted only in-memory for the duration of a fill.
- No plaintext credentials in logs, no `print` / `os_log` of secrets.
- Biometric gate (`LAContext.evaluatePolicy`) before any credential is surfaced to the UI or AutoFill.
- Keychain items use `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` (or stricter); no iCloud sync of secrets by default.
- Hard revoke = rotate device key + invalidate old Keychain items.

## 4. Apple-specific gates (plan for them, don't fake them)

- **Developer Program:** $99/year. Required for signing, TestFlight, App Store.
- **AutoFill entitlement:** request `com.apple.developer.authentication-services.autofill-credential-provider` in the Developer portal. No extra fee, but review can take weeks. Without it, no system-level AutoFill.
- **Keychain access groups:** declare an App Group + Keychain access group so app and extension share the vault.
- **Notarization:** not required for the App Store build, but required if you also ship a direct download.
- **Review:** Apple tests AutoFill themselves. Test on real devices (iPhone + iPad), multiple iOS versions, Safari + third-party browsers.

## 5. What Grok Build should produce first

1. The multi-target Xcode project with empty SwiftUI screens.
2. `4AllPassCore` SPM package with the vault API stubbed and unit-testable.
3. `4AllPassAutoFill` extension skeleton that returns a dummy `ASPasswordCredential`.
4. A `README.md` in the project root explaining how to build, run on a simulator/device, enable the AutoFill extension in Settings → Passwords, and request the entitlement.

## 6. Out of scope for v1

- App Store signing, distribution pipeline, CI.
- Cloud sync, multi-device, iCloud Keychain.
- Agent-access broker on mobile (desktop-only for now).
- Widgets, watchOS, macOS (Catalyst) clients.

## 7. Reference docs in this repo

- `docs/architecture/adr/ADR-009-mobile-client.md`
- `docs/autofill-v1.md`
- `docs/crypto/key-derivation.md`, `docs/crypto/envelopes.md`
- `docs/security-boundary.md`
- `docs/threat-model.md`
- `docs/android-skeleton-grok-build.md` (sibling spec — keep the two consistent)
