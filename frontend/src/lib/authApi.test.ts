import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'

import { AuthApiError, fetchCurrentUser, login, logout, register } from './authApi.ts'

type FetchArgs = { url: string; init: RequestInit | undefined }

const realFetch = globalThis.fetch
const calls: FetchArgs[] = []

function mockFetch(status: number, body?: unknown) {
  calls.length = 0
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    return new Response(body === undefined ? null : JSON.stringify(body), { status })
  }) as typeof fetch
}

afterEach(() => {
  globalThis.fetch = realFetch
})

const user = { id: 'u-1', email: 'a@example.com', created_at: '2026-08-18T00:00:00Z' }

test('login posts credentials with include and returns the user', async () => {
  mockFetch(200, user)
  const result = await login('a@example.com', 'account password')
  assert.deepEqual(result, user)

  assert.equal(calls.length, 1)
  assert.ok(calls[0].url.endsWith('/auth/login'))
  // The HttpOnly session cookie only flows when credentials are included.
  assert.equal(calls[0].init?.credentials, 'include')
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
    email: 'a@example.com',
    password: 'account password',
  })
})

test('register surfaces backend error detail', async () => {
  mockFetch(409, { detail: 'email already registered' })
  await assert.rejects(
    register('a@example.com', 'account password'),
    (error: unknown) =>
      error instanceof AuthApiError &&
      error.status === 409 &&
      error.message === 'email already registered',
  )
})

test('fetchCurrentUser maps 401 to null instead of throwing', async () => {
  mockFetch(401, { detail: 'not authenticated' })
  assert.equal(await fetchCurrentUser(), null)
})

test('logout tolerates the empty 204 response', async () => {
  mockFetch(204)
  await logout()
  assert.equal(calls[0].init?.method, 'POST')
  assert.equal(calls[0].init?.credentials, 'include')
})
