import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    PLATFORM_AUTH_PORT: 3000,
    DATABASE_URL: 'postgres://test@localhost/test',
    REDIS_URL: 'redis://localhost:6379',
    PLATFORM_JWT_SECRET: 'test_secret_at_least_32_characters_long_ok',
    PLATFORM_JWT_REFRESH_DAYS: 30,
    EXPECTED_APP_ID: 'platform',
    LOG_LEVEL: 'silent',
  },
}))

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('../lib/db.js', () => ({
  pool: { connect: vi.fn() },
  setTenantContext: vi.fn(),
  withTenantTransaction: vi.fn(),
}))

vi.mock('../lib/redis.js', () => ({
  redis: { setex: vi.fn(), get: vi.fn(), del: vi.fn(), keys: vi.fn() },
  publish: vi.fn(),
}))

// El appGuard real está envuelto con fastify-plugin (fp) para que su hook
// onRequest aplique globalmente y no quede encapsulado en el plugin. El mock
// debe hacer lo mismo; si no, req.identity nunca se setea en rutas hermanas
// (logout, logout-all, /me/sessions) y el handler revienta con 500.
vi.mock('../plugins/app-guard.js', async () => {
  const fp = (await import('fastify-plugin')).default
  return {
    appGuard: fp(async (fastify) => {
      fastify.decorateRequest('identity', null)
      // El guard real usa preHandler (corre tras el routing), por eso una ruta
      // desconocida llega al notFoundHandler (404) antes que el guard. Imitarlo
      // aquí mantiene el comportamiento real (404 en ruta inexistente).
      fastify.addHook('preHandler', async (req, reply) => {
        if (req.routeOptions?.config?.public) return
        const auth = req.headers.authorization
        if (!auth?.startsWith('Bearer ')) {
          return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Missing token' } })
        }
        req.identity = {
          userId:   '11111111-1111-1111-1111-111111111111',
          appId:    'yoga-studio',
          tenantId: '00000000-0000-0000-0000-000000000001',
          role:     'user',
        }
      })
    }),
    requireRole: () => async () => {},
  }
})

vi.mock('../services/auth.service.js')
vi.mock('../services/oauth.service.js')

import { createApp } from '../app.js'
import * as authService from '../services/auth.service.js'
import * as oauthService from '../services/oauth.service.js'
import { ConflictError, UnauthorizedError } from '@apphub/platform-sdk/errors'

const APP_ID       = 'yoga-studio'
const TENANT_ID    = '00000000-0000-0000-0000-000000000001'
const USER_ID      = '11111111-1111-1111-1111-111111111111'
const RESET_TOKEN  = '33333333-3333-3333-3333-333333333333'
const REFRESH_TOKEN = '44444444-4444-4444-4444-444444444444'

let app
beforeEach(async () => {
  app = createApp()
  await app.ready()
})
afterEach(async () => {
  vi.clearAllMocks()
  await app.close()
})

// ── Health ────────────────────────────────────────────────────────────────────

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ status: 'ok', service: 'platform-auth' })
  })
})

// ── Register ─────────────────────────────────────────────────────────────────

describe('POST /v1/auth/register', () => {
  const valid = { appId: APP_ID, tenantId: TENANT_ID, email: 'a@test.com', password: 'password123' }

  it('returns 201 with created user', async () => {
    authService.register.mockResolvedValue({ id: USER_ID, email: valid.email, role: 'user' })
    const res = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: valid })
    expect(res.statusCode).toBe(201)
    expect(res.json().data).toMatchObject({ id: USER_ID, email: valid.email })
  })

  it('returns 409 when email already registered', async () => {
    authService.register.mockRejectedValue(new ConflictError('Email already registered'))
    const res = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: valid })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('CONFLICT')
  })

  it('returns 422 when email is invalid', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { ...valid, email: 'not-an-email' } })
    expect(res.statusCode).toBe(422)
  })

  it('returns 422 when password is too short', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { ...valid, password: 'short' } })
    expect(res.statusCode).toBe(422)
  })

  it('returns 422 when tenantId is not a UUID', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { ...valid, tenantId: 'not-a-uuid' } })
    expect(res.statusCode).toBe(422)
  })

  it('returns 422 when appId is missing', async () => {
    const { appId: _, ...noApp } = valid
    const res = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: noApp })
    expect(res.statusCode).toBe(422)
  })

  it('error genérico (no AppError/Zod) → 500 INTERNAL_ERROR (rama unhandled del errorHandler)', async () => {
    authService.register.mockRejectedValue(new Error('db exploded'))
    const res = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: valid })
    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe('INTERNAL_ERROR')
  })
})

// ── Login ─────────────────────────────────────────────────────────────────────

describe('POST /v1/auth/login', () => {
  const valid = { appId: APP_ID, tenantId: TENANT_ID, email: 'a@test.com', password: 'password123' }

  it('returns 200 with access and refresh tokens', async () => {
    authService.login.mockResolvedValue({ accessToken: 'at', refreshToken: 'rt', userId: USER_ID, role: 'user' })
    const res = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: valid })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toMatchObject({ accessToken: 'at', refreshToken: 'rt', userId: USER_ID })
  })

  it('returns 401 on invalid credentials', async () => {
    authService.login.mockRejectedValue(new UnauthorizedError('Invalid credentials'))
    const res = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: valid })
    expect(res.statusCode).toBe(401)
  })

  it('returns 401 when account is locked', async () => {
    authService.login.mockRejectedValue(new UnauthorizedError('Account locked. Try again later.'))
    const res = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: valid })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.message).toMatch(/locked/)
  })

  it('returns 422 when email is missing', async () => {
    const { email: _, ...noEmail } = valid
    const res = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: noEmail })
    expect(res.statusCode).toBe(422)
  })

  it('returns 422 when tenantId is not a UUID', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { ...valid, tenantId: 'bad' } })
    expect(res.statusCode).toBe(422)
  })
})

// ── Refresh ───────────────────────────────────────────────────────────────────

describe('POST /v1/auth/refresh', () => {
  const valid = { appId: APP_ID, tenantId: TENANT_ID, userId: USER_ID, refreshToken: REFRESH_TOKEN }

  it('returns 200 with new tokens', async () => {
    authService.refresh.mockResolvedValue({ accessToken: 'new-at', refreshToken: 'new-rt' })
    const res = await app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: valid })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toMatchObject({ accessToken: 'new-at', refreshToken: 'new-rt' })
  })

  it('returns 401 on invalid or expired refresh token', async () => {
    authService.refresh.mockRejectedValue(new UnauthorizedError('Invalid or expired refresh token'))
    const res = await app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: valid })
    expect(res.statusCode).toBe(401)
  })

  it('returns 422 when refreshToken is not a UUID', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { ...valid, refreshToken: 'not-uuid' } })
    expect(res.statusCode).toBe(422)
  })

  it('returns 422 when userId is not a UUID', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { ...valid, userId: 'bad' } })
    expect(res.statusCode).toBe(422)
  })
})

// ── Logout ────────────────────────────────────────────────────────────────────

describe('POST /v1/auth/logout', () => {
  it('returns 200 and invalidates the given refresh token', async () => {
    authService.logout.mockResolvedValue({ revoked: 1 })
    const res = await app.inject({
      method: 'POST', url: '/v1/auth/logout',
      headers: { authorization: 'Bearer at' },
      payload: { refreshToken: REFRESH_TOKEN },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual({ revoked: 1 })
    expect(authService.logout).toHaveBeenCalledWith(expect.objectContaining({
      userId: USER_ID, appId: APP_ID, tenantId: TENANT_ID, refreshToken: REFRESH_TOKEN,
    }))
  })

  it('returns 401 without Bearer token', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/auth/logout', payload: { refreshToken: REFRESH_TOKEN } })
    expect(res.statusCode).toBe(401)
  })

  it('returns 422 when refreshToken is not a UUID', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/auth/logout',
      headers: { authorization: 'Bearer at' },
      payload: { refreshToken: 'not-uuid' },
    })
    expect(res.statusCode).toBe(422)
  })
})

describe('POST /v1/auth/logout-all', () => {
  it('returns 200 and invalidates all sessions', async () => {
    authService.logoutAll.mockResolvedValue({ revoked: 3 })
    const res = await app.inject({
      method: 'POST', url: '/v1/auth/logout-all',
      headers: { authorization: 'Bearer at' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual({ revoked: 3 })
    expect(authService.logoutAll).toHaveBeenCalledWith(expect.objectContaining({
      userId: USER_ID, appId: APP_ID, tenantId: TENANT_ID,
    }))
  })

  it('returns 401 without Bearer token', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/auth/logout-all' })
    expect(res.statusCode).toBe(401)
  })
})

// ── Forgot password ───────────────────────────────────────────────────────────

describe('POST /v1/auth/forgot-password', () => {
  const valid = { appId: APP_ID, tenantId: TENANT_ID, email: 'a@test.com' }

  it('returns 200 with generic message regardless of whether email exists', async () => {
    authService.forgotPassword.mockResolvedValue(undefined)
    const res = await app.inject({ method: 'POST', url: '/v1/auth/forgot-password', payload: valid })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.message).toContain('reset link')
  })

  it('returns 422 when email is invalid', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/auth/forgot-password', payload: { ...valid, email: 'bad' } })
    expect(res.statusCode).toBe(422)
  })
})

// ── Reset password ────────────────────────────────────────────────────────────

describe('POST /v1/auth/reset-password', () => {
  const valid = { token: RESET_TOKEN, newPassword: 'newpassword123' }

  it('returns 200 on successful reset', async () => {
    authService.resetPassword.mockResolvedValue(undefined)
    const res = await app.inject({ method: 'POST', url: '/v1/auth/reset-password', payload: valid })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.message).toContain('reset successfully')
  })

  it('returns 401 on invalid or expired reset token', async () => {
    authService.resetPassword.mockRejectedValue(new UnauthorizedError('Invalid or expired reset token'))
    const res = await app.inject({ method: 'POST', url: '/v1/auth/reset-password', payload: valid })
    expect(res.statusCode).toBe(401)
  })

  it('returns 422 when newPassword is too short', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/auth/reset-password', payload: { token: RESET_TOKEN, newPassword: 'short' } })
    expect(res.statusCode).toBe(422)
  })

  it('returns 422 when token is not a UUID', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/auth/reset-password', payload: { token: 'bad-token', newPassword: 'newpassword123' } })
    expect(res.statusCode).toBe(422)
  })
})

// ── Internal validate ─────────────────────────────────────────────────────────

describe('GET /internal/validate', () => {
  it('returns 401 when Authorization header is missing', async () => {
    const res = await app.inject({ method: 'GET', url: '/internal/validate' })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe('UNAUTHORIZED')
  })

  it('returns 200 with decoded identity on valid token', async () => {
    authService.validateToken.mockReturnValue({
      userId: USER_ID, appId: APP_ID, tenantId: TENANT_ID, subTenantId: null, role: 'user', email: 'a@test.com',
    })
    const res = await app.inject({ method: 'GET', url: '/internal/validate', headers: { authorization: 'Bearer valid.jwt.token' } })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toMatchObject({ userId: USER_ID, appId: APP_ID, role: 'user' })
  })

  it('returns 401 when token is invalid or expired', async () => {
    authService.validateToken.mockImplementation(() => { throw new UnauthorizedError('Invalid or expired token') })
    const res = await app.inject({ method: 'GET', url: '/internal/validate', headers: { authorization: 'Bearer bad.jwt' } })
    expect(res.statusCode).toBe(401)
  })
})

// ── OAuth routes ──────────────────────────────────────────────────────────────

describe('POST /v1/auth/oauth/google', () => {
  it('returns 200 with tokens on valid Google credential', async () => {
    oauthService.loginWithGoogle.mockResolvedValue({ accessToken: 'at', refreshToken: 'rt', userId: USER_ID, role: 'user' })
    const res = await app.inject({
      method: 'POST', url: '/v1/auth/oauth/google',
      payload: { appId: APP_ID, tenantId: TENANT_ID, credential: 'google-id-token' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.accessToken).toBe('at')
  })

  it('returns 422 when credential is missing', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/auth/oauth/google',
      payload: { appId: APP_ID, tenantId: TENANT_ID },
    })
    expect(res.statusCode).toBe(422)
  })
})

describe('POST /v1/auth/oauth/facebook', () => {
  it('returns 200 with tokens on valid Facebook accessToken', async () => {
    oauthService.loginWithFacebook.mockResolvedValue({ accessToken: 'at', refreshToken: 'rt', userId: USER_ID, role: 'user' })
    const res = await app.inject({
      method: 'POST', url: '/v1/auth/oauth/facebook',
      payload: { appId: APP_ID, tenantId: TENANT_ID, accessToken: 'fb-access-token' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.accessToken).toBe('at')
  })

  it('returns 422 when accessToken is missing', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/auth/oauth/facebook',
      payload: { appId: APP_ID, tenantId: TENANT_ID },
    })
    expect(res.statusCode).toBe(422)
  })
})

// ── Not found ─────────────────────────────────────────────────────────────────

describe('Unknown route', () => {
  it('returns 404 with NOT_FOUND error code', async () => {
    // Con Bearer (autenticado) la ruta inexistente llega al notFoundHandler.
    // Sin token, el guard global devuelve 401 antes — igual que en producción.
    const res = await app.inject({ method: 'GET', url: '/v1/auth/does-not-exist', headers: { authorization: 'Bearer at' } })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe('NOT_FOUND')
  })
})
