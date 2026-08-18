import { useCallback, useEffect, useState } from 'react'
import { webauthnPrfAvailable } from './lib/webauthnCapabilities.ts'
import {
  AccountAuthError,
  createAccountAuthClient,
  type AccountUser,
} from './lib/accountAuth.ts'

// Same-origin by default, which is the self-hosted case. A split deployment
// sets VITE_API_BASE_URL and must list that origin in FOURALLPASS_CORS_ORIGINS.
const auth = createAccountAuthClient({ baseUrl: import.meta.env.VITE_API_BASE_URL ?? '' })

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="lock-screen">
      <div className="lock-card">
        <img src="/icon.svg" alt="" width={56} height={56} className="brand-icon" />
        <h1>4AllPass</h1>
        {children}
      </div>
    </main>
  )
}

/**
 * Account sign-in. This is the *only* thing on this screen that talks to the
 * backend about a credential, and the credential it sends is the account
 * password — never the Master Password.
 */
function SignInCard({ onSignedIn }: { onSignedIn: (account: AccountUser) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (mode === 'register') {
        await auth.register(email, password)
      }
      onSignedIn(await auth.login(email, password))
    } catch (caught) {
      setError(
        caught instanceof AccountAuthError ? caught.message : 'could not reach the server',
      )
    } finally {
      // The password never leaves this component and never outlives the submit.
      setPassword('')
      setBusy(false)
    }
  }

  return (
    <Shell>
      <p className="tagline">Sign in to your account to sync encrypted vault data.</p>

      <form className="unlock-form" onSubmit={handleSubmit}>
        <label htmlFor="account-email">E-mail</label>
        <input
          id="account-email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />

        <label htmlFor="account-password">Account password</label>
        <input
          id="account-password"
          type="password"
          autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />

        <button
          type="submit"
          className="primary"
          disabled={busy || email.length === 0 || password.length === 0}
        >
          {mode === 'register' ? 'Create account' : 'Sign in'}
        </button>
      </form>

      {error && <p className="error">{error}</p>}

      <button
        type="button"
        className="secondary"
        style={{ marginTop: 16 }}
        onClick={() => {
          setMode(mode === 'login' ? 'register' : 'login')
          setError(null)
        }}
      >
        {mode === 'login' ? 'Create an account instead' : 'I already have an account'}
      </button>

      <p className="footnote">
        Your account password is not your Master Password. It signs you in; it never
        decrypts anything.
      </p>
    </Shell>
  )
}

/**
 * The vault lock screen. Reached only after sign-in, and still entirely
 * client-side: the Master Password and the Vault Key stay in this tab.
 */
function VaultLockCard({
  account,
  onSignedOut,
}: {
  account: AccountUser
  onSignedOut: () => void
}) {
  const [masterPassword, setMasterPassword] = useState('')
  const [prfSupported] = useState(() => webauthnPrfAvailable())

  // NOTE: Master-Password derivation (Argon2id -> Master Envelope,
  // crypto-protocol.md §4) and the WebAuthn PRF unlock flow
  // (src/lib/webauthnPrf.ts) are wired as library functions but not yet
  // connected to a vault — snapshot fetch and commit are the next backend
  // milestone.
  function handleMasterPasswordUnlock(event: React.FormEvent) {
    event.preventDefault()
  }

  return (
    <Shell>
      <p className="tagline">Signed in as {account.email}.</p>

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

      <button
        type="button"
        className="secondary"
        style={{ marginTop: 10 }}
        onClick={() => {
          void auth.logout().finally(onSignedOut)
        }}
      >
        Sign out of this account
      </button>

      <p className="footnote">
        The server never sees your Master Password, Vault Key, or plaintext entries.
      </p>
    </Shell>
  )
}

function App() {
  // `undefined` while the session is still being checked, `null` for signed
  // out. Authentication state is asked of the server rather than remembered,
  // because the session cookie is not readable from script.
  const [account, setAccount] = useState<AccountUser | null | undefined>(undefined)

  const refresh = useCallback(() => {
    auth
      .currentUser()
      .then(setAccount)
      .catch(() => setAccount(null))
  }, [])

  useEffect(refresh, [refresh])

  if (account === undefined) {
    return (
      <Shell>
        <p className="tagline">Checking your session…</p>
      </Shell>
    )
  }

  if (account === null) {
    return <SignInCard onSignedIn={setAccount} />
  }

  return <VaultLockCard account={account} onSignedOut={() => setAccount(null)} />
}

export default App
