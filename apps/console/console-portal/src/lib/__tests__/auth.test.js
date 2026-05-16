/**
 * Unit tests for src/lib/auth.js
 *
 * The portal sends just { email, password }. The backend resolves (app_id,
 * tenant_id) from the email. These tests cover the request body and the
 * response-handling edge cases.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../api', () => ({
  api: { post: vi.fn() },
}))

import { api } from '../api'
import { login, logout, getToken, getIdentity, APP_ID } from '../auth'

// ── helpers ───────────────────────────────────────────────────────────────

function makeJwt(payload) {
  const hdr  = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/=+$/, '')
  const body = btoa(JSON.stringify(payload)).replace(/=+$/, '')
  return `${hdr}.${body}.sig`
}

function tokenResponse(overrides = {}) {
  const payload = {
    sub:       '11111111-1111-1111-1111-111111111111',
    app_id:    overrides.app_id    ?? APP_ID,
    tenant_id: overrides.tenant_id ?? '10000000-0000-0000-0000-000000000001',
    role:      overrides.role      ?? 'owner',
    email:     overrides.email     ?? 'pedro@tiendaana.com',
    exp:       overrides.exp       ?? Math.floor(Date.now() / 1000) + 600,
  }
  return { data: { accessToken: makeJwt(payload), refreshToken: 'r', userId: payload.sub, role: payload.role } }
}

beforeEach(() => { localStorage.clear(); api.post.mockReset() })
afterEach(() => localStorage.clear())

// ── login() body construction ────────────────────────────────────────────

describe('login() body construction', () => {
  it('sends only email + password (no appId/tenantId); backend resolves the tenant', async () => {
    api.post.mockResolvedValueOnce(tokenResponse())
    await login({ email: 'pedro@tiendaana.com', password: 'p' })
    expect(api.post).toHaveBeenCalledWith('/api/auth/login', {
      email:    'pedro@tiendaana.com',
      password: 'p',
    })
  })

  it('works identically for a staff email (backend resolves it to platform/PLATFORM_TENANT)', async () => {
    api.post.mockResolvedValueOnce(tokenResponse({ app_id: 'platform', role: 'super_admin' }))
    await login({ email: 'ana@voragine.local', password: 'p' })
    expect(api.post).toHaveBeenCalledWith('/api/auth/login', {
      email:    'ana@voragine.local',
      password: 'p',
    })
  })
})

// ── login() response handling ────────────────────────────────────────────

describe('login() response handling', () => {
  it('stores the token in localStorage and returns the identity', async () => {
    api.post.mockResolvedValueOnce(tokenResponse())
    const identity = await login({ email: 'pedro@tiendaana.com', password: 'p' })
    expect(localStorage.getItem('apphub.token')).toBeTruthy()
    expect(identity).toMatchObject({ email: 'pedro@tiendaana.com', role: 'owner', appId: APP_ID })
  })

  it('bubbles up the error when the API rejects with 401', async () => {
    api.post.mockRejectedValueOnce(Object.assign(new Error('Invalid credentials'), { status: 401 }))
    await expect(login({ email: 'x@x', password: 'wrong' }))
      .rejects.toMatchObject({ message: 'Invalid credentials', status: 401 })
    expect(localStorage.getItem('apphub.token')).toBeNull()
  })

  it('throws when the response is missing accessToken', async () => {
    api.post.mockResolvedValueOnce({ data: {} })
    await expect(login({ email: 'x@x', password: 'p' })).rejects.toThrow(/sin token/)
  })

  it('accepts responses with accessToken at the top level', async () => {
    const payload = { app_id: APP_ID, tenant_id: '10000000-0000-0000-0000-000000000001', role: 'owner', email: 'x@x', sub: '1' }
    api.post.mockResolvedValueOnce({ accessToken: makeJwt(payload), refreshToken: 'r' })
    const id = await login({ email: 'x@x', password: 'p' })
    expect(id).toMatchObject({ email: 'x@x' })
  })
})

// ── getIdentity() / getToken() / logout() ────────────────────────────────

describe('getIdentity()', () => {
  it('returns null when no token is stored', () => {
    expect(getIdentity()).toBeNull()
  })

  it('decodes a stored JWT into an identity object', () => {
    localStorage.setItem('apphub.token', makeJwt({
      sub: 'u1', app_id: APP_ID, tenant_id: 't1', role: 'owner', email: 'a@b', exp: Math.floor(Date.now() / 1000) + 60,
    }))
    expect(getIdentity()).toEqual({
      userId: 'u1', appId: APP_ID, tenantId: 't1', role: 'owner', email: 'a@b',
    })
  })

  it('returns null and clears the token when expired', () => {
    localStorage.setItem('apphub.token', makeJwt({
      sub: 'u1', app_id: APP_ID, tenant_id: 't1', role: 'owner', email: 'a@b',
      exp: Math.floor(Date.now() / 1000) - 1,
    }))
    expect(getIdentity()).toBeNull()
    expect(getToken()).toBeNull()
  })

  it('returns null and clears the token when the JWT is malformed', () => {
    localStorage.setItem('apphub.token', 'not.a.valid.token')
    expect(getIdentity()).toBeNull()
    expect(getToken()).toBeNull()
  })
})

describe('logout()', () => {
  it('removes the token from localStorage', () => {
    localStorage.setItem('apphub.token', makeJwt({ sub: 'u', app_id: APP_ID, tenant_id: 't', role: 'owner', email: 'a@b', exp: 9999999999 }))
    logout()
    expect(getToken()).toBeNull()
  })
})
