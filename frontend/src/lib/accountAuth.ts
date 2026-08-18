/**
 * 4AllPass — account authentication client (docs/backend-security-boundary.md).
 *
 * This module is the whole of the client's authentication state, and it is
 * deliberately almost empty:
 *
 *   Authentication:  user -> backend session  (an HttpOnly cookie, held by the browser)
 *   Vault:           encrypted data -> client-side crypto -> plaintext
 *
 * The two never meet. Signing in does not unlock a vault and cannot: the
 * server never receives the Master Password, and the session cookie has no
 * relationship to the Vault Key (crypto-protocol.md, Hard Invariant #5).
 *
 * There is no token to store. The session token lives in a cookie the browser
 * will not let script read, so this module keeps nothing in `localStorage`,
 * `sessionStorage` or a module-level variable — "am I signed in?" is answered
 * by asking the server, not by trusting something we wrote down. The only
 * requirement on every request is `credentials: 'include'`, so the cookie is
 * actually sent.
 *
 * `fetch` is injectable so the whole client is unit-testable without a
 * browser, in the same spirit as the pure core of `webauthnPrf.ts`.
 */

export interface AccountUser {
  id: string
  email: string
  isActive: boolean
  createdAt: string
}

export class AccountAuthError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'AccountAuthError'
    this.status = status
  }
}

export interface AccountAuthClientOptions {
  /** Origin of the API. Empty (the default) means same-origin, which is the self-hosted case. */
  baseUrl?: string
  fetchImpl?: typeof fetch
}

export interface AccountAuthClient {
  register(email: string, password: string): Promise<AccountUser>
  login(email: string, password: string): Promise<AccountUser>
  logout(): Promise<void>
  logoutEverywhere(): Promise<void>
  /** The signed-in account, or `null` when there is no live session. */
  currentUser(): Promise<AccountUser | null>
}

interface RawAccountUser {
  id: string
  email: string
  is_active: boolean
  created_at: string
}

function toAccountUser(raw: RawAccountUser): AccountUser {
  return {
    id: raw.id,
    email: raw.email,
    isActive: raw.is_active,
    createdAt: raw.created_at,
  }
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown }
    if (typeof body.detail === 'string') return body.detail
    if (Array.isArray(body.detail)) return 'the request was rejected as malformed'
  } catch {
    // A non-JSON error body carries nothing worth surfacing.
  }
  return `request failed with status ${response.status}`
}

export function createAccountAuthClient(
  options: AccountAuthClientOptions = {},
): AccountAuthClient {
  const baseUrl = (options.baseUrl ?? '').replace(/\/+$/, '')
  const fetchImpl = options.fetchImpl ?? globalThis.fetch

  async function call(path: string, init: RequestInit = {}): Promise<Response> {
    return fetchImpl(`${baseUrl}${path}`, {
      ...init,
      // The session cookie is the credential. Without this the browser sends
      // nothing and every authenticated call is a 401.
      credentials: 'include',
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    })
  }

  async function postCredentials(path: string, email: string, password: string) {
    const response = await call(path, {
      method: 'POST',
      // The password goes in the body, over TLS, and is never written anywhere
      // else on this side — not to storage, not to a URL, not to a log.
      body: JSON.stringify({ email, password }),
    })
    if (!response.ok) throw new AccountAuthError(response.status, await errorMessage(response))
    return toAccountUser((await response.json()) as RawAccountUser)
  }

  return {
    register: (email, password) => postCredentials('/auth/register', email, password),

    login: (email, password) => postCredentials('/auth/login', email, password),

    async logout() {
      const response = await call('/auth/logout', { method: 'POST' })
      if (!response.ok) throw new AccountAuthError(response.status, await errorMessage(response))
    },

    async logoutEverywhere() {
      const response = await call('/auth/logout-all', { method: 'POST' })
      if (!response.ok) throw new AccountAuthError(response.status, await errorMessage(response))
    },

    async currentUser() {
      const response = await call('/auth/me')
      // 401 is the ordinary "not signed in" answer, not a failure to report.
      if (response.status === 401) return null
      if (!response.ok) throw new AccountAuthError(response.status, await errorMessage(response))
      return toAccountUser((await response.json()) as RawAccountUser)
    },
  }
}
