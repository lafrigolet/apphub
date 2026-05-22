// Tests del servicio OAuth (Google + Facebook). El verify del id_token /
// access_token se mockea — aquí cubrimos:
//   - resolveProviderConfig: prefiere DB, cae a env si DB vacía.
//   - loginWithGoogle: token inválido → 401, no configurado → 501.
//   - loginWithFacebook: token rechazado por Facebook → 401, no
//     configurado → 501.
//   - Pending approval: el caller recibe PENDING_APPROVAL 403 cuando el
//     tenant requiere aprobación y el user es nuevo (no autotoken).
//   - User existente vía email → link a la connection (no se crea otro user).

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: {
    PLATFORM_JWT_SECRET: 'test_secret_at_least_32_characters_long_ok',
    PLATFORM_JWT_REFRESH_DAYS: 30,
    NODE_ENV: 'test',
    GOOGLE_CLIENT_ID: 'env-google-client-id',
    FACEBOOK_APP_ID: 'env-fb-app',
    FACEBOOK_APP_SECRET: 'env-fb-secret',
  },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../lib/db.js', () => ({
  pool: { connect: vi.fn() },
  withTransaction: vi.fn(),
  setTenantContext: vi.fn(),
  withTenantTransaction: vi.fn(),
}))
vi.mock('../lib/redis.js', () => ({
  redis: { setex: vi.fn() },
  publish: vi.fn(),
}))
vi.mock('uuid', () => ({ v4: vi.fn(() => 'new-user-uuid') }))
vi.mock('../repositories/oauth.repository.js')
vi.mock('../repositories/oauth-providers.repository.js')

// Mock del client Google: verifyIdToken devuelve un ticket con payload.
const { googleVerifyMock } = vi.hoisted(() => ({ googleVerifyMock: vi.fn() }))
vi.mock('google-auth-library', () => ({
  OAuth2Client: vi.fn().mockImplementation(() => ({
    verifyIdToken: googleVerifyMock,
  })),
}))

// auth.service.tenantRequiresApproval — mockeamos para no abrir DB real.
vi.mock('../services/auth.service.js', () => ({
  tenantRequiresApproval: vi.fn().mockResolvedValue(false),
}))

import { loginWithGoogle, loginWithFacebook } from '../services/oauth.service.js'
import { pool, withTransaction } from '../lib/db.js'
import { redis, publish } from '../lib/redis.js'
import * as oauthRepo     from '../repositories/oauth.repository.js'
import * as providersRepo from '../repositories/oauth-providers.repository.js'
import { tenantRequiresApproval } from '../services/auth.service.js'

const APP    = 'aikikan'
const TENANT = '00000000-0000-0000-0000-000000000001'

function mockClient() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }
}

beforeEach(() => {
  vi.clearAllMocks()
  const c = mockClient()
  pool.connect.mockResolvedValue(c)
  withTransaction.mockImplementation(async (_p, fn) => fn(c))
  tenantRequiresApproval.mockResolvedValue(false)
})

// ── Google ────────────────────────────────────────────────────────────

describe('loginWithGoogle — config', () => {
  it('501 OAUTH_NOT_CONFIGURED si no hay credenciales (ni DB ni env)', async () => {
    providersRepo.getProviderConfig.mockResolvedValue(null)
    // Sobreescribimos env via mock para este caso — pero más simple: si
    // resolveProviderConfig retorna null, falla. Como env tiene GOOGLE_CLIENT_ID,
    // necesitamos vaciar tanto la DB como el env. Usamos vi.doMock para reset.
    vi.resetModules()
    vi.doMock('../lib/env.js', () => ({
      env: {
        PLATFORM_JWT_SECRET: 'test_secret_at_least_32_characters_long_ok',
        PLATFORM_JWT_REFRESH_DAYS: 30, NODE_ENV: 'test',
      },
    }))
    vi.doMock('../lib/logger.js', () => ({ logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
    vi.doMock('../lib/db.js', () => ({ pool: { connect: vi.fn().mockResolvedValue(mockClient()) }, withTransaction: vi.fn() }))
    vi.doMock('../lib/redis.js', () => ({ redis: { setex: vi.fn() }, publish: vi.fn() }))
    vi.doMock('../repositories/oauth.repository.js', () => ({ findConnectionByProvider: vi.fn() }))
    vi.doMock('../repositories/oauth-providers.repository.js', () => ({
      getProviderConfig: vi.fn().mockResolvedValue(null),
    }))
    vi.doMock('../services/auth.service.js', () => ({ tenantRequiresApproval: vi.fn() }))

    const mod = await import('../services/oauth.service.js')
    await expect(mod.loginWithGoogle({ appId: APP, tenantId: TENANT, credential: 'x' }))
      .rejects.toMatchObject({ code: 'OAUTH_NOT_CONFIGURED', statusCode: 501 })
  })

  it('cae al env GOOGLE_CLIENT_ID cuando la DB no tiene config', async () => {
    providersRepo.getProviderConfig.mockResolvedValue(null)
    // Token rechazado por google (no importa el resultado — verificamos que llegó al verify).
    googleVerifyMock.mockRejectedValueOnce(new Error('bad token'))
    await expect(
      loginWithGoogle({ appId: APP, tenantId: TENANT, credential: 'tok' }),
    ).rejects.toMatchObject({ code: 'INVALID_OAUTH_TOKEN', statusCode: 401 })
    expect(googleVerifyMock).toHaveBeenCalledWith({ idToken: 'tok', audience: 'env-google-client-id' })
  })

  it('usa la config de DB con prioridad sobre env', async () => {
    providersRepo.getProviderConfig.mockResolvedValue({
      clientId: 'db-google-id', clientSecret: null, enabled: true,
    })
    googleVerifyMock.mockRejectedValueOnce(new Error('x'))
    await expect(loginWithGoogle({ appId: APP, tenantId: TENANT, credential: 'tok' }))
      .rejects.toThrow()
    expect(googleVerifyMock).toHaveBeenCalledWith({ idToken: 'tok', audience: 'db-google-id' })
  })
})

describe('loginWithGoogle — flow', () => {
  beforeEach(() => {
    providersRepo.getProviderConfig.mockResolvedValue({
      clientId: 'cid', clientSecret: null, enabled: true,
    })
    googleVerifyMock.mockResolvedValue({
      getPayload: () => ({
        sub: 'google-uid-123', email: 'user@gmail.com',
        name: 'Eva', picture: 'https://avatar.x/eva',
      }),
    })
  })

  it('credential rechazada por Google → INVALID_OAUTH_TOKEN 401', async () => {
    googleVerifyMock.mockRejectedValueOnce(new Error('bad token'))
    await expect(
      loginWithGoogle({ appId: APP, tenantId: TENANT, credential: 'x' }),
    ).rejects.toMatchObject({ code: 'INVALID_OAUTH_TOKEN', statusCode: 401 })
  })

  it('user nuevo en tenant SIN approval requirement → emite tokens + user.registered', async () => {
    oauthRepo.findConnectionByProvider.mockResolvedValue(null)
    oauthRepo.findByEmailForOAuth.mockResolvedValue(null)
    oauthRepo.createUserWithOAuth.mockResolvedValue({
      id: 'new-user-uuid', app_id: APP, tenant_id: TENANT, sub_tenant_id: null,
      email: 'user@gmail.com', role: 'user', pending_approval: false,
    })

    const r = await loginWithGoogle({ appId: APP, tenantId: TENANT, credential: 'tok' })

    expect(r.userId).toBe('new-user-uuid')
    expect(typeof r.accessToken).toBe('string')
    expect(typeof r.refreshToken).toBe('string')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'user.registered' }))
    expect(redis.setex).toHaveBeenCalled()
  })

  it('user nuevo + tenant requiere approval → PENDING_APPROVAL 403 (no tokens)', async () => {
    tenantRequiresApproval.mockResolvedValue(true)
    oauthRepo.findConnectionByProvider.mockResolvedValue(null)
    oauthRepo.findByEmailForOAuth.mockResolvedValue(null)
    oauthRepo.createUserWithOAuth.mockResolvedValue({
      id: 'new-user-uuid', app_id: APP, tenant_id: TENANT, sub_tenant_id: null,
      email: 'user@gmail.com', role: 'user', pending_approval: true,
    })

    await expect(loginWithGoogle({ appId: APP, tenantId: TENANT, credential: 'tok' }))
      .rejects.toMatchObject({ code: 'PENDING_APPROVAL', statusCode: 403 })
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'auth.signup.requested' }))
    expect(redis.setex).not.toHaveBeenCalled()
  })

  it('user existente vía email → link a connection, NO crea otro user', async () => {
    oauthRepo.findConnectionByProvider.mockResolvedValue(null)
    oauthRepo.findByEmailForOAuth.mockResolvedValue({
      id: 'existing-uid', app_id: APP, tenant_id: TENANT, sub_tenant_id: null,
      email: 'user@gmail.com', role: 'user',
    })

    const r = await loginWithGoogle({ appId: APP, tenantId: TENANT, credential: 'tok' })
    expect(r.userId).toBe('existing-uid')
    expect(oauthRepo.upsertConnection).toHaveBeenCalled()
    expect(oauthRepo.createUserWithOAuth).not.toHaveBeenCalled()
  })

  it('connection ya existente → no crea user, devuelve tokens', async () => {
    oauthRepo.findConnectionByProvider.mockResolvedValue({
      user_id: 'returning-user', app_id: APP, tenant_id: TENANT, sub_tenant_id: null,
      user_email: 'user@gmail.com', role: 'user',
    })

    const r = await loginWithGoogle({ appId: APP, tenantId: TENANT, credential: 'tok' })
    expect(r.userId).toBe('returning-user')
    expect(oauthRepo.upsertConnection).toHaveBeenCalled()
    expect(oauthRepo.createUserWithOAuth).not.toHaveBeenCalled()
  })
})

// ── Facebook ──────────────────────────────────────────────────────────

describe('loginWithFacebook — config', () => {
  it('501 si NO hay clientId/clientSecret', async () => {
    providersRepo.getProviderConfig.mockResolvedValue(null)
    vi.resetModules()
    vi.doMock('../lib/env.js', () => ({
      env: { PLATFORM_JWT_SECRET: 'a'.repeat(32), PLATFORM_JWT_REFRESH_DAYS: 30, NODE_ENV: 'test' },
    }))
    vi.doMock('../lib/logger.js', () => ({ logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
    vi.doMock('../lib/db.js', () => ({ pool: { connect: vi.fn().mockResolvedValue(mockClient()) }, withTransaction: vi.fn() }))
    vi.doMock('../lib/redis.js', () => ({ redis: { setex: vi.fn() }, publish: vi.fn() }))
    vi.doMock('../repositories/oauth.repository.js', () => ({}))
    vi.doMock('../repositories/oauth-providers.repository.js', () => ({
      getProviderConfig: vi.fn().mockResolvedValue(null),
    }))
    vi.doMock('../services/auth.service.js', () => ({ tenantRequiresApproval: vi.fn() }))

    const mod = await import('../services/oauth.service.js')
    await expect(mod.loginWithFacebook({ appId: APP, tenantId: TENANT, accessToken: 'x' }))
      .rejects.toMatchObject({ code: 'OAUTH_NOT_CONFIGURED', statusCode: 501 })
  })
})

describe('loginWithFacebook — verify', () => {
  beforeEach(() => {
    providersRepo.getProviderConfig.mockResolvedValue({
      clientId: 'fb-id', clientSecret: 'fb-secret', enabled: true,
    })
  })

  it('rechaza access_token inválido (debug_token.is_valid=false)', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ json: async () => ({ data: { is_valid: false } }) })

    await expect(
      loginWithFacebook({ appId: APP, tenantId: TENANT, accessToken: 'bad' }),
    ).rejects.toMatchObject({ code: 'INVALID_OAUTH_TOKEN', statusCode: 401 })
  })

  it('happy path: emite tokens cuando profile válido', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ json: async () => ({ data: { is_valid: true } }) })
      .mockResolvedValueOnce({ json: async () => ({ id: 'fb-uid', name: 'Eva', email: 'eva@x' }) })

    oauthRepo.findConnectionByProvider.mockResolvedValue(null)
    oauthRepo.findByEmailForOAuth.mockResolvedValue(null)
    oauthRepo.createUserWithOAuth.mockResolvedValue({
      id: 'new-user-uuid', app_id: APP, tenant_id: TENANT,
      email: 'eva@x', role: 'user', pending_approval: false,
    })

    const r = await loginWithFacebook({ appId: APP, tenantId: TENANT, accessToken: 'good' })
    expect(r.userId).toBe('new-user-uuid')
    expect(typeof r.accessToken).toBe('string')
  })

  it('profile sin id (Facebook rare edge) → INVALID_OAUTH_TOKEN', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ json: async () => ({ data: { is_valid: true } }) })
      .mockResolvedValueOnce({ json: async () => ({}) })   // sin id

    await expect(
      loginWithFacebook({ appId: APP, tenantId: TENANT, accessToken: 'tok' }),
    ).rejects.toMatchObject({ code: 'INVALID_OAUTH_TOKEN' })
  })
})
