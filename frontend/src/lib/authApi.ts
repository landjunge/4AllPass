/**
 * Account-authentication client — session plumbing only.
 *
 * Authentication ≠ vault decryption (docs/backend-security.md): this module
 * establishes and tears down a *server session* for sync/authorization. It
 * never touches the Master Password, Vault Key, Device Key, DWK, or PRF
 * output — vault decryption state lives entirely in the crypto layer
 * (`@4allpass/crypto`) and is deliberately not imported here.
 *
 * The session is carried by an HttpOnly cookie set by the backend, so:
 * - every request uses `credentials: 'include'`,
 * - nothing is written to localStorage/sessionStorage,
 * - JavaScript (including this module) can never read the token.
 */

// Optional chaining keeps this importable outside Vite (e.g. node test runner).
const API_BASE: string =
  (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_API_BASE_URL ??
  'http://localhost:8000'

export interface AuthUser {
  id: string
  email: string
  created_at: string
}

export class AuthApiError extends Error {
  readonly status: number

  constructor(status: number, detail: string) {
    super(detail)
    this.name = 'AuthApiError'
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  })
  if (!response.ok) {
    let detail = response.statusText
    try {
      const body = (await response.json()) as { detail?: string }
      if (typeof body.detail === 'string') detail = body.detail
    } catch {
      // non-JSON error body: keep statusText
    }
    throw new AuthApiError(response.status, detail)
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export function register(email: string, password: string): Promise<AuthUser> {
  return request<AuthUser>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

export function login(email: string, password: string): Promise<AuthUser> {
  return request<AuthUser>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

export function logout(): Promise<void> {
  return request<void>('/auth/logout', { method: 'POST' })
}

/** Returns the authenticated user, or null when no valid session exists. */
export async function fetchCurrentUser(): Promise<AuthUser | null> {
  try {
    return await request<AuthUser>('/auth/me')
  } catch (error) {
    if (error instanceof AuthApiError && error.status === 401) return null
    throw error
  }
}
