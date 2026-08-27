# Android Skeleton for Grok Build

> Prompt-ready spec for generating the first Android client of 4AllPass.
> Goal: a clean, modern Kotlin/Compose skeleton that reuses the existing crypto core and can grow into a real AutofillService without becoming throwaway code.

## 1. Stack (non-negotiable)

- **Language:** Kotlin only. No Java, no XML layouts.
- **UI:** Jetpack Compose (Material 3).
- **Build:** Gradle (Kotlin DSL), multi-module.
- **DI:** Hilt.
- **Min SDK:** 26 (Android 8.0). Target SDK: latest stable.
- **Architecture:** MVVM + unidirectional data flow. ViewModels expose `StateFlow`, UI is stateless and observes state.

## 2. Module layout

```
4allpass-android/
├── settings.gradle.kts
├── build.gradle.kts
├── gradle/
└── wrapper/
├── app/                      # UI, navigation, entry points
│   ├── src/main/AndroidManifest.xml
│   ├── src/main/java/.../ui/
│   └── src/main/java/.../di/
├── core/                     # platform-independent crypto + vault logic
│   ├── src/main/java/.../crypto/
│   ├── src/main/java/.../vault/
│   └── src/test/                 # unit tests, test vectors
└── autofill/                 # AutofillService + dataset builders
    ├── src/main/AndroidManifest.xml   # service registration
    ├── src/main/java/.../autofill/
    └── src/main/res/xml/autofill_service.xml
```

### `core` module

- Reuse the existing crypto package from the desktop/Tauri repo as-is where possible (Argon2id, AES-256-GCM, envelopes, key hierarchy).
- Expose a small, pure Kotlin API:
  - `Vault.open(masterPassword)` → `VaultSession`
  - `VaultSession.unlock()` / `lock()`
  - `VaultSession.getCredential(id)` / `putCredential(entry)`
  - `VaultSession.rotateDeviceKey()` (for hard revoke)
- No Android dependencies in `core`. It must compile and test on the JVM.
- Port or wrap the Rust crypto via JNI only if a pure-Kotlin port is not feasible — prefer pure Kotlin first.

### `app` module

- Compose screens: `OnboardingScreen`, `UnlockScreen`, `VaultListScreen`, `CredentialDetailScreen`, `SettingsScreen`.
- Navigation via Compose Navigation.
- Biometric unlock via `BiometricPrompt` (AndroidX Biometric).
- Local settings via `EncryptedSharedPreferences` (AndroidX Security).
- Hilt modules for repositories and use-cases.

### `autofill` module

- `FourAllPassAutofillService : AutofillService`
  - `onFillRequest(FillRequest)` → detect login fields, build `FillResponse` with datasets.
  - `onSaveRequest(SaveRequest)` → offer to save new credentials (optional for v1).
- Registered in its own `AndroidManifest.xml` with:
  - `android.permission.BIND_AUTOFILL_SERVICE`
  - `<service android:name=".autofill.FourAllPassAutofillService" ...>`
  - `<meta-data android:name="android.autofill" android:resource="@xml/autofill_service" />`
- `autofill_service.xml` describes the service (label, settings activity).
- The service talks to `core` only through the `VaultSession` API — never touches crypto internals directly.

## 3. Security constraints (must hold)

- Vault key is random, never derived from the master password (matches `docs/crypto/key-derivation.md`).
- Server (if any) sees only ciphertext.
- Autofill service runs in its own process sandbox; credentials are decrypted only in-memory for the duration of a fill.
- No plaintext credentials in logs, no `Log.d` of secrets.
- Biometric gate before any credential is surfaced to the UI or autofill.

## 4. What Grok Build should produce first

1. The three-module Gradle project with empty Compose screens.
2. `core` module with the vault API stubbed and unit-testable.
3. `autofill` module with a working `AutofillService` skeleton that returns a dummy dataset.
4. A `README.md` in the project root explaining how to build, install on a device, and enable the autofill service in system settings.

## 5. Out of scope for v1

- Play Store signing, keystore, release pipeline.
- iOS / Apple Keychain entitlements.
- Cloud sync, multi-device.
- Agent-access broker on mobile (desktop-only for now).

## 6. Reference docs in this repo

- `docs/architecture/adr/ADR-009-mobile-client.md`
- `docs/autofill-v1.md`
- `docs/crypto/key-derivation.md`, `docs/crypto/envelopes.md`
- `docs/security-boundary.md`
- `docs/threat-model.md`
