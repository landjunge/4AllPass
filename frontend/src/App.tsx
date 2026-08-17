import { useState } from 'react'
import { webauthnPrfAvailable } from './lib/webauthnCapabilities.ts'

function App() {
  const [masterPassword, setMasterPassword] = useState('')
  const [prfSupported] = useState(() => webauthnPrfAvailable())

  // NOTE: this is UI scaffolding only. Master-Password derivation
  // (Argon2id -> Master Envelope, crypto-protocol.md §4) and the WebAuthn
  // PRF unlock flow (src/lib/webauthnPrf.ts, docs/webauthn-prf.md) are
  // wired as library functions but not yet connected to a running vault —
  // there is no account/session backend endpoint to unlock against yet.
  function handleMasterPasswordUnlock(event: React.FormEvent) {
    event.preventDefault()
  }

  return (
    <main className="lock-screen">
      <div className="lock-card">
        <img src="/icon.svg" alt="" width={56} height={56} className="brand-icon" />
        <h1>4AllPass</h1>
        <p className="tagline">Self-hosted Zero-Knowledge password manager.</p>

        <form className="unlock-form" onSubmit={handleMasterPasswordUnlock}>
          <label htmlFor="master-password">Master Password</label>
          <input
            id="master-password"
            type="password"
            autoComplete="current-password"
            placeholder="Enter your Master Password"
            value={masterPassword}
            onChange={(event) => setMasterPassword(event.target.value)}
          />
          <button type="submit" className="primary" disabled={masterPassword.length === 0}>
            Unlock vault
          </button>
        </form>

        <div className="divider">
          <span>or</span>
        </div>

        <button type="button" className="secondary" disabled={!prfSupported}>
          Unlock with device biometrics
        </button>
        {!prfSupported && (
          <p className="hint">
            This browser has no WebAuthn PRF support. Falls back to largeBlob or a
            UV-gated local store when configured — Master Password unlock always works.
          </p>
        )}

        <p className="footnote">
          The server never sees your Master Password, Vault Key, or plaintext entries.
        </p>
      </div>
    </main>
  )
}

export default App
