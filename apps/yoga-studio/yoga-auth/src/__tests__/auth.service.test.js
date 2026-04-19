import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: {
    YOGA_JWT_SECRET: 'super-secret-test-key-32-chars-min',
    YOGA_JWT_REFRESH_DAYS: 30,
    YOGA_TENANT_ID: '00000000-0000-0000-0000-000000000001',
    YOGA_SUB_TENANT_ID: undefined,
  },
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

vi.mock('../repositories/user.repository.js')
vi.mock('../repositories/password-reset.repository.js')
vi.mock('bcrypt')
vi.mock('jsonwebtoken')

import * as authService from '../services/auth.service.js'
import { pool, setTenantContext, withTenantTransaction } from '../lib/db.js'
import { redis, publish } from '../lib/redis.js'
import * as userRepo from '../repositories/user.repository.js'
import * as resetRepo from '../repositories/password-reset.repository.js'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'

const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const USER_ID = '11111111-1111-1111-1111-111111111111'

const mockUser = {
  id: USER_ID,
  email: 'test@yoga.com',
  role: 'alumno',
  password_hash: '$2b$12$hashed',
  failed_attempts: 0,
  locked_until: null,
  tenant_id: TENANT_ID,
  sub_tenant_id: null,
}

function makeMockClient() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }
}

beforeEach(() => {
  vi.clearAllMocks()
  const client = makeMockClient()
  pool.connect.mockResolvedValue(client)
})

describe('auth.service — register', () => {
  it('creates user and publishes event on success', async () => {
    withTenantTransaction.mockImplementation(async (tid, stid, fn) => {
      return fn(makeMockClient())
    })
    userRepo.findByEmail.mockResolvedValue(null)
    userRepo.createUser.mockResolvedValue(mockUser)
    bcrypt.hash.mockResolvedValue('$2b$12$hashed')

    const result = await authService.register({ email: 'test@yoga.com', password: 'password123' })

    expect(result).toEqual({ id: USER_ID, email: 'test@yoga.com', role: 'alumno' })
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'user.registered',
      payload: expect.objectContaining({ tenantId: TENANT_ID }),
    }))
  })

  it('throws ConflictError when email already registered', async () => {
    withTenantTransaction.mockImplementation(async (tid, stid, fn) => fn(makeMockClient()))
    userRepo.findByEmail.mockResolvedValue(mockUser)

    await expect(authService.register({ email: 'test@yoga.com', password: 'password123' }))
      .rejects.toThrow('Email already registered')
  })
})

describe('auth.service — login', () => {
  it('returns tokens and user on successful login', async () => {
    const client = makeMockClient()
    pool.connect.mockResolvedValue(client)
    userRepo.findByEmail.mockResolvedValue(mockUser)
    bcrypt.compare.mockResolvedValue(true)
    userRepo.resetFailedAttempts.mockResolvedValue()
    jwt.sign.mockReturnValue('access-token')
    redis.setex.mockResolvedValue('OK')

    const result = await authService.login({ email: 'test@yoga.com', password: 'password123' })

    expect(result.accessToken).toBe('access-token')
    expect(result.refreshToken).toBeTruthy()
    expect(result.user.email).toBe('test@yoga.com')
    expect(setTenantContext).toHaveBeenCalledWith(client, TENANT_ID, null)
    expect(client.release).toHaveBeenCalled()
  })

  it('throws UnauthorizedError when user not found', async () => {
    const client = makeMockClient()
    pool.connect.mockResolvedValue(client)
    userRepo.findByEmail.mockResolvedValue(null)

    await expect(authService.login({ email: 'unknown@yoga.com', password: 'pw' }))
      .rejects.toThrow('Invalid credentials')
    expect(client.release).toHaveBeenCalled()
  })

  it('throws UnauthorizedError when account is locked', async () => {
    const lockedUser = { ...mockUser, locked_until: new Date(Date.now() + 60_000) }
    const client = makeMockClient()
    pool.connect.mockResolvedValue(client)
    userRepo.findByEmail.mockResolvedValue(lockedUser)

    await expect(authService.login({ email: 'test@yoga.com', password: 'pw' }))
      .rejects.toThrow('Account temporarily locked')
  })

  it('increments failed attempts and throws on wrong password', async () => {
    const client = makeMockClient()
    pool.connect.mockResolvedValue(client)
    userRepo.findByEmail.mockResolvedValue(mockUser)
    bcrypt.compare.mockResolvedValue(false)
    userRepo.incrementFailedAttempts.mockResolvedValue()

    await expect(authService.login({ email: 'test@yoga.com', password: 'wrong' }))
      .rejects.toThrow('Invalid credentials')
    expect(userRepo.incrementFailedAttempts).toHaveBeenCalledWith(client, USER_ID)
  })
})

describe('auth.service — refresh', () => {
  it('returns new tokens when refresh token is valid', async () => {
    const REFRESH_TOKEN = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
    redis.get.mockResolvedValue(USER_ID)
    redis.del.mockResolvedValue(1)
    redis.setex.mockResolvedValue('OK')
    const client = makeMockClient()
    pool.connect.mockResolvedValue(client)
    userRepo.findById.mockResolvedValue(mockUser)
    jwt.sign.mockReturnValue('new-access-token')

    const result = await authService.refresh({ refreshToken: REFRESH_TOKEN, userId: USER_ID })

    expect(result.accessToken).toBe('new-access-token')
    expect(result.refreshToken).toBeTruthy()
    expect(redis.del).toHaveBeenCalledWith(`yoga:${TENANT_ID}:refresh:${USER_ID}:${REFRESH_TOKEN}`)
  })

  it('throws UnauthorizedError when refresh token not in Redis', async () => {
    redis.get.mockResolvedValue(null)
    await expect(authService.refresh({ refreshToken: 'bad', userId: USER_ID }))
      .rejects.toThrow('Invalid or expired refresh token')
  })
})

describe('auth.service — forgotPassword', () => {
  it('creates reset token and publishes event when user exists', async () => {
    const client = makeMockClient()
    pool.connect.mockResolvedValue(client)
    userRepo.findByEmail.mockResolvedValue(mockUser)
    resetRepo.createReset.mockResolvedValue()

    await authService.forgotPassword({ email: 'test@yoga.com' })

    expect(resetRepo.createReset).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ userId: USER_ID, tenantId: TENANT_ID }),
    )
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'password.reset.requested',
      payload: expect.objectContaining({ tenantId: TENANT_ID }),
    }))
  })

  it('returns silently when user not found (no email enumeration)', async () => {
    const client = makeMockClient()
    pool.connect.mockResolvedValue(client)
    userRepo.findByEmail.mockResolvedValue(null)

    await expect(authService.forgotPassword({ email: 'ghost@yoga.com' })).resolves.toBeUndefined()
    expect(resetRepo.createReset).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
  })
})

describe('auth.service — resetPassword', () => {
  it('updates password and clears all refresh tokens', async () => {
    const TOKEN = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
    withTenantTransaction.mockImplementation(async (tid, stid, fn) => fn(makeMockClient()))
    resetRepo.findValidReset.mockResolvedValue({ user_id: USER_ID, token: TOKEN })
    userRepo.updatePassword.mockResolvedValue()
    resetRepo.markResetUsed.mockResolvedValue()
    bcrypt.hash.mockResolvedValue('$newHash')
    redis.keys.mockResolvedValue([`yoga:${TENANT_ID}:refresh:${USER_ID}:tok1`])
    redis.del.mockResolvedValue(1)

    await authService.resetPassword({ token: TOKEN, newPassword: 'NewPass123!' })

    expect(userRepo.updatePassword).toHaveBeenCalledWith(expect.anything(), USER_ID, '$newHash')
    expect(resetRepo.markResetUsed).toHaveBeenCalledWith(expect.anything(), TOKEN)
    expect(redis.del).toHaveBeenCalled()
  })

  it('throws NotFoundError when token is invalid or expired', async () => {
    withTenantTransaction.mockImplementation(async (tid, stid, fn) => fn(makeMockClient()))
    resetRepo.findValidReset.mockResolvedValue(null)

    await expect(authService.resetPassword({ token: 'bad-token', newPassword: 'pw12345678' }))
      .rejects.toThrow('Password reset token not found')
  })
})

describe('auth.service — validateToken', () => {
  it('returns valid result with all claims', async () => {
    jwt.verify.mockReturnValue({
      sub: USER_ID, role: 'alumno', email: 'test@yoga.com',
      tenant_id: TENANT_ID, sub_tenant_id: null,
    })

    const result = await authService.validateToken('valid-token')
    expect(result.valid).toBe(true)
    expect(result.tenantId).toBe(TENANT_ID)
    expect(result.userId).toBe(USER_ID)
  })

  it('returns invalid when jwt.verify throws', async () => {
    jwt.verify.mockImplementation(() => { throw new Error('expired') })
    const result = await authService.validateToken('bad-token')
    expect(result.valid).toBe(false)
  })
})
