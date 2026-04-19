import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://test@localhost/test',
    REDIS_URL: 'redis://localhost:6379',
    YOGA_JWT_SECRET: 'super-secret-test-key-32-chars-min',
    YOGA_JWT_REFRESH_DAYS: 30,
    YOGA_TENANT_ID: '00000000-0000-0000-0000-000000000001',
    YOGA_SUB_TENANT_ID: undefined,
    LOG_LEVEL: 'silent',
    YOGA_AUTH_PORT: 3010,
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

vi.mock('../services/auth.service.js', () => ({
  register: vi.fn(),
  login: vi.fn(),
  refresh: vi.fn(),
  forgotPassword: vi.fn(),
  resetPassword: vi.fn(),
  validateToken: vi.fn(),
}))

import { createApp } from '../app.js'
import * as authService from '../services/auth.service.js'

const USER_ID = '11111111-1111-1111-1111-111111111111'

let app
beforeEach(async () => {
  app = createApp()
  await app.ready()
})
afterEach(async () => {
  await app.close()
  vi.clearAllMocks()
})

describe('GET /health', () => {
  it('returns ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe('ok')
  })
})

describe('POST /v1/auth/register', () => {
  it('returns 201 with user data on success', async () => {
    authService.register.mockResolvedValue({ id: USER_ID, email: 'test@yoga.com', role: 'alumno' })

    const res = await app.inject({
      method: 'POST', url: '/v1/auth/register',
      payload: { email: 'test@yoga.com', password: 'password123' },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().data.email).toBe('test@yoga.com')
  })

  it('returns 422 on invalid email', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/auth/register',
      payload: { email: 'not-an-email', password: 'password123' },
    })
    expect(res.statusCode).toBe(422)
    expect(res.json().error.code).toBe('VALIDATION_ERROR')
  })

  it('returns 422 on short password', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/auth/register',
      payload: { email: 'test@yoga.com', password: 'short' },
    })
    expect(res.statusCode).toBe(422)
  })

  it('returns 409 when email already exists', async () => {
    const { ConflictError } = await import('../utils/errors.js')
    authService.register.mockRejectedValue(new ConflictError('Email already registered'))

    const res = await app.inject({
      method: 'POST', url: '/v1/auth/register',
      payload: { email: 'taken@yoga.com', password: 'password123' },
    })

    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('CONFLICT')
  })
})

describe('POST /v1/auth/login', () => {
  it('returns 200 with tokens on success', async () => {
    authService.login.mockResolvedValue({
      accessToken: 'acc', refreshToken: 'ref',
      user: { id: USER_ID, email: 'test@yoga.com', role: 'alumno' },
    })

    const res = await app.inject({
      method: 'POST', url: '/v1/auth/login',
      payload: { email: 'test@yoga.com', password: 'password123' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data.accessToken).toBe('acc')
  })

  it('returns 401 on invalid credentials', async () => {
    const { UnauthorizedError } = await import('../utils/errors.js')
    authService.login.mockRejectedValue(new UnauthorizedError('Invalid credentials'))

    const res = await app.inject({
      method: 'POST', url: '/v1/auth/login',
      payload: { email: 'test@yoga.com', password: 'wrong' },
    })

    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe('UNAUTHORIZED')
  })

  it('returns 422 on missing email', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/auth/login',
      payload: { password: 'password123' },
    })
    expect(res.statusCode).toBe(422)
  })
})

describe('POST /v1/auth/refresh', () => {
  it('returns new tokens', async () => {
    authService.refresh.mockResolvedValue({ accessToken: 'new-acc', refreshToken: 'new-ref' })

    const res = await app.inject({
      method: 'POST', url: '/v1/auth/refresh',
      payload: { userId: USER_ID, refreshToken: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data.accessToken).toBe('new-acc')
  })

  it('returns 422 when userId is not uuid', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/auth/refresh',
      payload: { userId: 'not-uuid', refreshToken: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
    })
    expect(res.statusCode).toBe(422)
  })
})

describe('POST /v1/auth/forgot-password', () => {
  it('returns 200 with generic message regardless of outcome', async () => {
    authService.forgotPassword.mockResolvedValue(undefined)

    const res = await app.inject({
      method: 'POST', url: '/v1/auth/forgot-password',
      payload: { email: 'test@yoga.com' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data.message).toContain('reset link')
  })
})

describe('POST /v1/auth/reset-password', () => {
  it('returns 200 on successful reset', async () => {
    authService.resetPassword.mockResolvedValue(undefined)

    const res = await app.inject({
      method: 'POST', url: '/v1/auth/reset-password',
      payload: { token: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', newPassword: 'NewPass123!' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data.message).toContain('reset successfully')
  })

  it('returns 404 when token not found', async () => {
    const { NotFoundError } = await import('../utils/errors.js')
    authService.resetPassword.mockRejectedValue(new NotFoundError('Password reset token'))

    const res = await app.inject({
      method: 'POST', url: '/v1/auth/reset-password',
      payload: { token: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', newPassword: 'NewPass123!' },
    })

    expect(res.statusCode).toBe(404)
  })
})

describe('GET /internal/validate', () => {
  it('returns 401 when no token provided', async () => {
    const res = await app.inject({ method: 'GET', url: '/internal/validate' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 401 when token is invalid', async () => {
    authService.validateToken.mockReturnValue({ valid: false })

    const res = await app.inject({
      method: 'GET', url: '/internal/validate',
      headers: { authorization: 'Bearer invalid-token' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns 200 with user data when token is valid', async () => {
    authService.validateToken.mockReturnValue({
      valid: true, userId: USER_ID, role: 'alumno',
      email: 'test@yoga.com', tenantId: '00000000-0000-0000-0000-000000000001',
    })

    const res = await app.inject({
      method: 'GET', url: '/internal/validate',
      headers: { authorization: 'Bearer valid.token.here' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.userId).toBe(USER_ID)
  })
})
