import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: {
    PLATFORM_JWT_SECRET: 'test_secret_at_least_32_characters_long_ok',
    PLATFORM_JWT_REFRESH_DAYS: 30,
    NODE_ENV: 'test',
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
  redis: { setex: vi.fn(), get: vi.fn(), del: vi.fn(), keys: vi.fn(), ttl: vi.fn() },
  publish: vi.fn(),
}))

vi.mock('bcrypt')
vi.mock('jsonwebtoken')
vi.mock('uuid', () => ({ v4: vi.fn(() => 'fixed-uuid') }))
vi.mock('../repositories/user.repository.js')
vi.mock('../repositories/password-reset.repository.js')
vi.mock('../repositories/auth-event.repository.js')

import { register, login, refresh, forgotPassword, resetPassword, validateToken, logout, logoutAll, listSessions, recordEvent } from '../services/auth.service.js'
import { pool, withTenantTransaction, setTenantContext } from '../lib/db.js'
import { redis, publish } from '../lib/redis.js'
import * as userRepo from '../repositories/user.repository.js'
import * as resetRepo from '../repositories/password-reset.repository.js'
import * as authEventRepo from '../repositories/auth-event.repository.js'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { ConflictError, UnauthorizedError } from '@apphub/platform-sdk/errors'

const APP_ID    = 'yoga-studio'
const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const USER_ID   = '11111111-1111-1111-1111-111111111111'

function mockClient() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }
}

beforeEach(() => vi.clearAllMocks())

// ── register ──────────────────────────────────────────────────────────────────

describe('register', () => {
  it('creates user, hashes password, and publishes event', async () => {
    const client = mockClient()
    withTenantTransaction.mockImplementation(async (_pool, _appId, _tid, _stid, fn) => fn(client))
    userRepo.findByEmail.mockResolvedValue(null)
    bcrypt.hash.mockResolvedValue('hashed-pw')
    userRepo.createUser.mockResolvedValue({ id: USER_ID, email: 'a@test.com', role: 'user' })

    const result = await register({ appId: APP_ID, tenantId: TENANT_ID, email: 'a@test.com', password: 'password123' })

    expect(bcrypt.hash).toHaveBeenCalledWith('password123', 12)
    expect(userRepo.createUser).toHaveBeenCalledWith(client, expect.objectContaining({
      email: 'a@test.com', passwordHash: 'hashed-pw', appId: APP_ID, tenantId: TENANT_ID,
    }))
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'user.registered', payload: expect.objectContaining({ email: 'a@test.com' }) }))
    expect(result).toEqual({ id: USER_ID, email: 'a@test.com', role: 'user' })
  })

  it('throws ConflictError when email already exists', async () => {
    const client = mockClient()
    withTenantTransaction.mockImplementation(async (_pool, _appId, _tid, _stid, fn) => fn(client))
    userRepo.findByEmail.mockResolvedValue({ id: USER_ID })

    await expect(register({ appId: APP_ID, tenantId: TENANT_ID, email: 'a@test.com', password: 'password123' }))
      .rejects.toThrow(ConflictError)
    expect(userRepo.createUser).not.toHaveBeenCalled()
  })

  // Colapso a un tenant por defecto: la subtenancy queda reservada — register
  // siempre persiste subTenantId=null aunque el caller intente forzar uno.
  it('always persists subTenantId=null (subtenancy reserved)', async () => {
    const client = mockClient()
    withTenantTransaction.mockImplementation(async (_pool, _appId, _tid, _stid, fn) => fn(client))
    userRepo.findByEmail.mockResolvedValue(null)
    bcrypt.hash.mockResolvedValue('h')
    userRepo.createUser.mockResolvedValue({ id: USER_ID, email: 'a@test.com', role: 'user' })

    await register({ appId: APP_ID, tenantId: TENANT_ID, email: 'a@test.com', password: 'pw12345678' })
    expect(userRepo.createUser).toHaveBeenCalledWith(client, expect.objectContaining({ subTenantId: null }))
  })
})

// ── login ─────────────────────────────────────────────────────────────────────

describe('login', () => {
  const user = {
    id: USER_ID, email: 'a@test.com', password_hash: 'hashed-pw',
    role: 'user', locked_until: null,
    app_id: APP_ID, tenant_id: TENANT_ID, sub_tenant_id: null,
  }

  it('returns tokens and resets failed attempts on valid credentials', async () => {
    const client = mockClient()
    pool.connect.mockResolvedValue(client)
    setTenantContext.mockResolvedValue()
    userRepo.findByEmail.mockResolvedValue(user)
    bcrypt.compare.mockResolvedValue(true)
    userRepo.resetFailedAttempts.mockResolvedValue()
    jwt.sign.mockReturnValue('signed-at')
    redis.setex.mockResolvedValue('OK')

    const result = await login({ appId: APP_ID, tenantId: TENANT_ID, email: 'a@test.com', password: 'password123' })

    expect(result).toMatchObject({ accessToken: 'signed-at', userId: USER_ID, role: 'user' })
    expect(result.refreshToken).toBe('fixed-uuid')
    expect(redis.setex).toHaveBeenCalled()
    expect(client.release).toHaveBeenCalled()
  })

  it('throws UnauthorizedError when user does not exist', async () => {
    const client = mockClient()
    pool.connect.mockResolvedValue(client)
    setTenantContext.mockResolvedValue()
    userRepo.findByEmail.mockResolvedValue(null)

    await expect(login({ appId: APP_ID, tenantId: TENANT_ID, email: 'x@test.com', password: 'pw' }))
      .rejects.toThrow(UnauthorizedError)
    expect(client.release).toHaveBeenCalled()
  })

  it('increments failed attempts and throws UnauthorizedError on wrong password', async () => {
    const client = mockClient()
    pool.connect.mockResolvedValue(client)
    setTenantContext.mockResolvedValue()
    userRepo.findByEmail.mockResolvedValue(user)
    bcrypt.compare.mockResolvedValue(false)
    userRepo.incrementFailedAttempts.mockResolvedValue()

    await expect(login({ appId: APP_ID, tenantId: TENANT_ID, email: 'a@test.com', password: 'wrong' }))
      .rejects.toThrow(UnauthorizedError)
    expect(userRepo.incrementFailedAttempts).toHaveBeenCalledWith(client, USER_ID)
    expect(client.release).toHaveBeenCalled()
  })

  it('throws UnauthorizedError when account is locked', async () => {
    const client = mockClient()
    pool.connect.mockResolvedValue(client)
    setTenantContext.mockResolvedValue()
    userRepo.findByEmail.mockResolvedValue({ ...user, locked_until: new Date(Date.now() + 60_000).toISOString() })

    await expect(login({ appId: APP_ID, tenantId: TENANT_ID, email: 'a@test.com', password: 'pw' }))
      .rejects.toThrow(UnauthorizedError)
    expect(bcrypt.compare).not.toHaveBeenCalled()
    expect(client.release).toHaveBeenCalled()
  })

  it('releases client even when an unexpected error is thrown', async () => {
    const client = mockClient()
    pool.connect.mockResolvedValue(client)
    setTenantContext.mockResolvedValue()
    userRepo.findByEmail.mockRejectedValue(new Error('DB error'))

    await expect(login({ appId: APP_ID, tenantId: TENANT_ID, email: 'a@test.com', password: 'pw' }))
      .rejects.toThrow('DB error')
    expect(client.release).toHaveBeenCalled()
  })
})

// ── refresh ───────────────────────────────────────────────────────────────────

describe('refresh', () => {
  const user = { id: USER_ID, email: 'a@test.com', role: 'user', app_id: APP_ID, tenant_id: TENANT_ID, sub_tenant_id: null }

  it('rotates refresh token and returns new access token', async () => {
    const client = mockClient()
    redis.get.mockResolvedValue('1')
    pool.connect.mockResolvedValue(client)
    setTenantContext.mockResolvedValue()
    userRepo.findById.mockResolvedValue(user)
    redis.del.mockResolvedValue(1)
    redis.setex.mockResolvedValue('OK')
    jwt.sign.mockReturnValue('new-at')

    const result = await refresh({ appId: APP_ID, tenantId: TENANT_ID, userId: USER_ID, refreshToken: 'old-rt' })

    expect(redis.del).toHaveBeenCalled()
    expect(redis.setex).toHaveBeenCalled()
    expect(result.accessToken).toBe('new-at')
    expect(client.release).toHaveBeenCalled()
  })

  it('throws UnauthorizedError when refresh token is not in Redis', async () => {
    redis.get.mockResolvedValue(null)
    await expect(refresh({ appId: APP_ID, tenantId: TENANT_ID, userId: USER_ID, refreshToken: 'expired' }))
      .rejects.toThrow(UnauthorizedError)
  })

  it('throws UnauthorizedError when user no longer exists', async () => {
    const client = mockClient()
    redis.get.mockResolvedValue('1')
    pool.connect.mockResolvedValue(client)
    setTenantContext.mockResolvedValue()
    userRepo.findById.mockResolvedValue(null)

    await expect(refresh({ appId: APP_ID, tenantId: TENANT_ID, userId: USER_ID, refreshToken: 'rt' }))
      .rejects.toThrow(UnauthorizedError)
    expect(client.release).toHaveBeenCalled()
  })
})

// ── forgotPassword ────────────────────────────────────────────────────────────

describe('forgotPassword', () => {
  it('creates reset token and publishes event when user exists', async () => {
    const client = mockClient()
    pool.connect.mockResolvedValue(client)
    setTenantContext.mockResolvedValue()
    userRepo.findByEmail.mockResolvedValue({ id: USER_ID, email: 'a@test.com' })
    resetRepo.createReset.mockResolvedValue()

    await forgotPassword({ appId: APP_ID, tenantId: TENANT_ID, email: 'a@test.com' })

    expect(resetRepo.createReset).toHaveBeenCalledWith(client, expect.objectContaining({ userId: USER_ID, appId: APP_ID }))
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'auth.password_reset_requested',
      payload: expect.objectContaining({ email: 'a@test.com' }),
    }))
    expect(client.release).toHaveBeenCalled()
  })

  it('is silent and does nothing when user does not exist (prevents email enumeration)', async () => {
    const client = mockClient()
    pool.connect.mockResolvedValue(client)
    setTenantContext.mockResolvedValue()
    userRepo.findByEmail.mockResolvedValue(null)

    await expect(forgotPassword({ appId: APP_ID, tenantId: TENANT_ID, email: 'nobody@test.com' }))
      .resolves.toBeUndefined()
    expect(resetRepo.createReset).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
    expect(client.release).toHaveBeenCalled()
  })
})

// ── resetPassword ─────────────────────────────────────────────────────────────

describe('resetPassword', () => {
  it('hashes new password, marks token used (by hash), and invalidates refresh tokens', async () => {
    const client = mockClient()
    pool.connect.mockResolvedValue(client)
    const reset = { id: 'reset-row-id', user_id: USER_ID, app_id: APP_ID, tenant_id: TENANT_ID }
    resetRepo.findValidByHash.mockResolvedValue(reset)
    bcrypt.hash.mockResolvedValue('new-hash')
    userRepo.updatePassword.mockResolvedValue()
    resetRepo.markResetUsed.mockResolvedValue()
    redis.keys.mockResolvedValue(['key1', 'key2'])
    redis.del.mockResolvedValue(2)

    await resetPassword({ token: 'opaque-plain-token', newPassword: 'newpassword123' })

    // verificación por hash, NO por id legacy
    expect(resetRepo.findValidByHash).toHaveBeenCalled()
    expect(resetRepo.findValidLegacyById).not.toHaveBeenCalled()
    expect(bcrypt.hash).toHaveBeenCalledWith('newpassword123', 12)
    expect(userRepo.updatePassword).toHaveBeenCalledWith(client, USER_ID, 'new-hash')
    expect(resetRepo.markResetUsed).toHaveBeenCalledWith(client, 'reset-row-id')
    expect(redis.del).toHaveBeenCalledWith('key1', 'key2')
    expect(client.release).toHaveBeenCalled()
  })

  it('falls back to legacy id lookup when token is a UUID and no hash row matches', async () => {
    const client = mockClient()
    pool.connect.mockResolvedValue(client)
    resetRepo.findValidByHash.mockResolvedValue(null)
    resetRepo.findValidLegacyById.mockResolvedValue({ id: 'legacy-id', user_id: USER_ID, app_id: APP_ID, tenant_id: TENANT_ID })
    bcrypt.hash.mockResolvedValue('h')
    userRepo.updatePassword.mockResolvedValue()
    resetRepo.markResetUsed.mockResolvedValue()
    redis.keys.mockResolvedValue([])

    await resetPassword({ token: '33333333-3333-3333-3333-333333333333', newPassword: 'newpassword123' })
    expect(resetRepo.findValidLegacyById).toHaveBeenCalledWith(client, '33333333-3333-3333-3333-333333333333')
    expect(resetRepo.markResetUsed).toHaveBeenCalledWith(client, 'legacy-id')
  })

  it('skips redis.del when no refresh tokens exist for the user', async () => {
    const client = mockClient()
    pool.connect.mockResolvedValue(client)
    resetRepo.findValidByHash.mockResolvedValue({ id: 'rid', user_id: USER_ID, app_id: APP_ID, tenant_id: TENANT_ID })
    bcrypt.hash.mockResolvedValue('h')
    userRepo.updatePassword.mockResolvedValue()
    resetRepo.markResetUsed.mockResolvedValue()
    redis.keys.mockResolvedValue([])

    await resetPassword({ token: 'opaque-token', newPassword: 'newpassword123' })
    expect(redis.del).not.toHaveBeenCalled()
  })

  it('throws UnauthorizedError on invalid or expired reset token (no legacy fallback for non-UUID)', async () => {
    const client = mockClient()
    pool.connect.mockResolvedValue(client)
    resetRepo.findValidByHash.mockResolvedValue(null)

    await expect(resetPassword({ token: 'bad-opaque-token', newPassword: 'newpassword123' }))
      .rejects.toThrow(UnauthorizedError)
    expect(resetRepo.findValidLegacyById).not.toHaveBeenCalled()
    expect(client.release).toHaveBeenCalled()
  })

  it('rolls back transaction and releases client on error', async () => {
    const client = mockClient()
    pool.connect.mockResolvedValue(client)
    resetRepo.findValidByHash.mockResolvedValue({ id: 'rid', user_id: USER_ID, app_id: APP_ID, tenant_id: TENANT_ID })
    bcrypt.hash.mockResolvedValue('h')
    userRepo.updatePassword.mockRejectedValue(new Error('DB error'))

    await expect(resetPassword({ token: 'opaque-token', newPassword: 'newpassword123' }))
      .rejects.toThrow('DB error')
    expect(client.query).toHaveBeenCalledWith('ROLLBACK')
    expect(client.release).toHaveBeenCalled()
  })
})

// ── validateToken ─────────────────────────────────────────────────────────────

describe('validateToken', () => {
  it('returns decoded identity for a valid JWT', () => {
    jwt.verify.mockReturnValue({
      sub: USER_ID, app_id: APP_ID, tenant_id: TENANT_ID, sub_tenant_id: null, role: 'user', email: 'a@test.com',
    })
    const result = validateToken('valid.jwt')
    expect(result).toEqual({ userId: USER_ID, appId: APP_ID, tenantId: TENANT_ID, subTenantId: null, role: 'user', email: 'a@test.com' })
  })

  it('handles sub_tenant_id being undefined — maps to null', () => {
    jwt.verify.mockReturnValue({ sub: USER_ID, app_id: APP_ID, tenant_id: TENANT_ID, role: 'user', email: 'a@test.com' })
    const result = validateToken('valid.jwt')
    expect(result.subTenantId).toBeNull()
  })

  it('throws UnauthorizedError when JWT is invalid', () => {
    jwt.verify.mockImplementation(() => { throw new Error('jwt malformed') })
    expect(() => validateToken('bad.jwt')).toThrow(UnauthorizedError)
  })

  it('throws UnauthorizedError when JWT is expired', () => {
    jwt.verify.mockImplementation(() => { throw new Error('jwt expired') })
    expect(() => validateToken('expired.jwt')).toThrow(UnauthorizedError)
  })
})

// ── logout / logoutAll / listSessions ──────────────────────────────────────────

describe('logout', () => {
  it('deletes the specific refresh token key for the user', async () => {
    redis.del.mockResolvedValue(1)
    // recordEvent connects its own client
    pool.connect.mockResolvedValue(mockClient())

    const result = await logout({ appId: APP_ID, tenantId: TENANT_ID, userId: USER_ID, refreshToken: 'rt-1' })

    expect(redis.del).toHaveBeenCalledWith(`${APP_ID}:${TENANT_ID}:refresh:${USER_ID}:rt-1`)
    expect(result).toEqual({ revoked: 1 })
  })
})

describe('logoutAll', () => {
  it('deletes all refresh token keys for the user', async () => {
    redis.keys.mockResolvedValue(['k1', 'k2', 'k3'])
    redis.del.mockResolvedValue(3)
    pool.connect.mockResolvedValue(mockClient())

    const result = await logoutAll({ appId: APP_ID, tenantId: TENANT_ID, userId: USER_ID })

    expect(redis.keys).toHaveBeenCalledWith(`${APP_ID}:${TENANT_ID}:refresh:${USER_ID}:*`)
    expect(redis.del).toHaveBeenCalledWith('k1', 'k2', 'k3')
    expect(result).toEqual({ revoked: 3 })
  })

  it('is a no-op del when the user has no sessions', async () => {
    redis.keys.mockResolvedValue([])
    pool.connect.mockResolvedValue(mockClient())

    const result = await logoutAll({ appId: APP_ID, tenantId: TENANT_ID, userId: USER_ID })
    expect(redis.del).not.toHaveBeenCalled()
    expect(result).toEqual({ revoked: 0 })
  })
})

describe('listSessions', () => {
  it('returns one entry per active refresh token with masked suffix + ttl', async () => {
    const prefix = `${APP_ID}:${TENANT_ID}:refresh:${USER_ID}:`
    redis.keys.mockResolvedValue([`${prefix}abcdef0123456789`, `${prefix}zzzz11112222`])
    redis.ttl.mockResolvedValueOnce(1000).mockResolvedValueOnce(2000)

    const sessions = await listSessions({ appId: APP_ID, tenantId: TENANT_ID, userId: USER_ID })

    expect(sessions).toEqual([
      { tokenSuffix: '23456789', ttlSeconds: 1000 },
      { tokenSuffix: '11112222', ttlSeconds: 2000 },
    ])
  })

  it('tolerates redis.ttl throwing (ttl null)', async () => {
    const prefix = `${APP_ID}:${TENANT_ID}:refresh:${USER_ID}:`
    redis.keys.mockResolvedValue([`${prefix}tok12345678`])
    redis.ttl.mockRejectedValue(new Error('no ttl'))

    const sessions = await listSessions({ appId: APP_ID, tenantId: TENANT_ID, userId: USER_ID })
    expect(sessions).toEqual([{ tokenSuffix: '12345678', ttlSeconds: null }])
  })
})

// ── recordEvent (audit) ────────────────────────────────────────────────────────

describe('recordEvent', () => {
  it('inserts an audit row under staff bypass and commits', async () => {
    const client = mockClient()
    pool.connect.mockResolvedValue(client)
    authEventRepo.create.mockResolvedValue({ id: 'e1' })

    await recordEvent({ appId: APP_ID, tenantId: TENANT_ID, userId: USER_ID, eventType: 'login', result: 'success' })

    expect(authEventRepo.create).toHaveBeenCalledWith(client, expect.objectContaining({
      appId: APP_ID, tenantId: TENANT_ID, userId: USER_ID, eventType: 'login', result: 'success',
    }))
    expect(client.query).toHaveBeenCalledWith('COMMIT')
    expect(client.release).toHaveBeenCalled()
  })

  it('no-ops when appId or tenantId is missing', async () => {
    await recordEvent({ eventType: 'login' })
    expect(pool.connect).not.toHaveBeenCalled()
  })

  it('swallows errors (best-effort) and rolls back', async () => {
    const client = mockClient()
    pool.connect.mockResolvedValue(client)
    authEventRepo.create.mockRejectedValue(new Error('insert failed'))

    await expect(recordEvent({ appId: APP_ID, tenantId: TENANT_ID, eventType: 'logout' }))
      .resolves.toBeUndefined()
    expect(client.query).toHaveBeenCalledWith('ROLLBACK')
    expect(client.release).toHaveBeenCalled()
  })
})
