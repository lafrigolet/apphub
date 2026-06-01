// internalRoutes — endpoints internos (owners bootstrap, magic-link, activate,
// request-membership) que consume tenant-config sobre la red docker. Mockea
// el authService entero y verifica delegación + status + ramas tenantId.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import { ZodError } from 'zod'

vi.mock('../lib/env.js', () => ({
  env: {
    NODE_ENV: 'test', LOG_LEVEL: 'silent',
    DATABASE_URL: 'postgres://test@localhost/test', REDIS_URL: 'redis://localhost:6379',
    PLATFORM_JWT_SECRET: 'test_secret_at_least_32_characters_long_ok',
    PLATFORM_JWT_REFRESH_DAYS: 30, EXPECTED_APP_ID: 'platform',
  },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../lib/db.js', () => ({
  pool: { connect: vi.fn() }, setTenantContext: vi.fn(), withTenantTransaction: vi.fn(),
}))
vi.mock('../lib/redis.js', () => ({
  redis: { setex: vi.fn(), get: vi.fn(), del: vi.fn(), keys: vi.fn() }, publish: vi.fn(),
}))
vi.mock('../services/auth.service.js')

import { authRoutes, internalRoutes } from '../routes/auth.routes.js'
import * as authService from '../services/auth.service.js'

async function buildApp() {
  const app = Fastify({ logger: false, ignoreTrailingSlash: true })
  const zodCompiler = ({ schema }) => (data) => {
    if (schema?.safeParse) {
      const r = schema.safeParse(data)
      return r.success ? { value: r.data } : { error: r.error }
    }
    return { value: data }
  }
  app.setValidatorCompiler(zodCompiler)
  app.setSerializerCompiler(() => (d) => JSON.stringify(d))
  await app.register(authRoutes, { prefix: '/v1/auth' })
  await app.register(internalRoutes, { prefix: '/internal' })
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError || err.code === 'FST_ERR_VALIDATION') {
      return reply.status(422).send({ error: { code: 'VALIDATION_ERROR' } })
    }
    if (err.statusCode) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR' } })
  })
  await app.ready()
  return app
}

let app
beforeEach(async () => { vi.clearAllMocks(); app = await buildApp() })
afterEach(async () => { await app.close() })

const TENANT = '22222222-2222-2222-2222-222222222222'
const UID    = '11111111-1111-1111-1111-111111111111'
const json = { 'Content-Type': 'application/json' }

// ── public auth routes no cubiertos por auth.routes.test ─────────────

describe('POST /v1/auth/request-membership', () => {
  it('201', async () => {
    authService.requestMembership.mockResolvedValue({ status: 'pending' })
    const res = await app.inject({
      method: 'POST', url: '/v1/auth/request-membership', headers: json,
      payload: { appId: 'aikikan', tenantId: TENANT, email: 'a@x.com', displayName: 'Ana' },
    })
    expect(res.statusCode).toBe(201)
    expect(authService.requestMembership).toHaveBeenCalled()
  })
})

describe('POST /v1/auth/request-magic-link', () => {
  it('mensaje silencioso', async () => {
    authService.requestMagicLink.mockResolvedValue()
    const res = await app.inject({
      method: 'POST', url: '/v1/auth/request-magic-link', headers: json,
      payload: { email: 'a@x.com' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.message).toMatch(/enlace de acceso/)
  })
})

describe('POST /v1/auth/login-with-magic-link', () => {
  it('devuelve tokens', async () => {
    authService.loginWithMagicLink.mockResolvedValue({ accessToken: 'a' })
    const res = await app.inject({
      method: 'POST', url: '/v1/auth/login-with-magic-link', headers: json,
      payload: { token: 'a'.repeat(20) },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.accessToken).toBe('a')
  })
})

describe('POST /v1/auth/activate', () => {
  it('devuelve sesión', async () => {
    authService.activate.mockResolvedValue({ accessToken: 'a', userId: UID })
    const res = await app.inject({
      method: 'POST', url: '/v1/auth/activate', headers: json,
      payload: { token: 'a'.repeat(20), password: 'password123' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.userId).toBe(UID)
  })
})

// ── internalRoutes ───────────────────────────────────────────────────

describe('GET /internal/validate', () => {
  it('sin token → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/internal/validate' })
    expect(res.statusCode).toBe(401)
  })

  it('token válido → identity', async () => {
    authService.validateToken.mockReturnValue({ userId: UID })
    const res = await app.inject({
      method: 'GET', url: '/internal/validate', headers: { Authorization: 'Bearer good' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.userId).toBe(UID)
  })

  it('token inválido → 401', async () => {
    authService.validateToken.mockImplementation(() => { throw new Error('bad') })
    const res = await app.inject({
      method: 'GET', url: '/internal/validate', headers: { Authorization: 'Bearer bad' },
    })
    expect(res.statusCode).toBe(401)
  })
})

describe('POST /internal/auth/owners', () => {
  it('201 → createOwnerWithActivation', async () => {
    authService.createOwnerWithActivation.mockResolvedValue({ userId: UID, plainToken: 'tok' })
    const res = await app.inject({
      method: 'POST', url: '/internal/auth/owners', headers: json,
      payload: { appId: 'aikikan', tenantId: TENANT, email: 'o@x.com', displayName: 'Owner' },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().data.plainToken).toBe('tok')
  })
})

describe('POST /internal/auth/owners/reissue', () => {
  it('200 → reissueActivationForOwner', async () => {
    authService.reissueActivationForOwner.mockResolvedValue({ userId: UID, plainToken: 'new' })
    const res = await app.inject({
      method: 'POST', url: '/internal/auth/owners/reissue', headers: json,
      payload: { userId: UID },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.plainToken).toBe('new')
  })
})

describe('GET /internal/auth/owners/state', () => {
  it('sin tenantId → data null', async () => {
    const res = await app.inject({ method: 'GET', url: '/internal/auth/owners/state' })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toBeNull()
    expect(authService.getOwnerState).not.toHaveBeenCalled()
  })

  it('con tenantId → owner state', async () => {
    authService.getOwnerState.mockResolvedValue({ id: 'owner-1' })
    const res = await app.inject({ method: 'GET', url: `/internal/auth/owners/state?tenantId=${TENANT}` })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.id).toBe('owner-1')
  })
})

describe('DELETE /internal/auth/owners', () => {
  it('sin tenantId → deleted 0', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/internal/auth/owners' })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual({ deleted: 0 })
    expect(authService.deletePendingOwner).not.toHaveBeenCalled()
  })

  it('con tenantId → deletePendingOwner', async () => {
    authService.deletePendingOwner.mockResolvedValue({ deleted: 2 })
    const res = await app.inject({ method: 'DELETE', url: `/internal/auth/owners?tenantId=${TENANT}` })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual({ deleted: 2 })
  })
})

describe('GET /internal/auth/admins/count', () => {
  it('sin tenantId → 0', async () => {
    const res = await app.inject({ method: 'GET', url: '/internal/auth/admins/count' })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toBe(0)
    expect(authService.countAdmins).not.toHaveBeenCalled()
  })

  it('con tenantId → count', async () => {
    authService.countAdmins.mockResolvedValue(5)
    const res = await app.inject({ method: 'GET', url: `/internal/auth/admins/count?tenantId=${TENANT}` })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toBe(5)
  })
})
