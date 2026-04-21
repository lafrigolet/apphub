/**
 * Integration tests for platform/auth — require a running Postgres + Redis.
 *
 * Start dependencies:  docker compose up postgres redis -d
 * Run:                 pnpm --filter @apphub/platform-auth test:integration
 *
 * Tests use APP_ID 'int-test' and a dedicated TENANT_ID so cleanup is scoped
 * and will never touch production or other app data.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import pg from 'pg'
import Redis from 'ioredis'
import { v4 as uuidv4 } from 'uuid'

import jwt from 'jsonwebtoken'
import { register, login, refresh, forgotPassword, resetPassword, validateToken } from '../../services/auth.service.js'
import { UnauthorizedError, ConflictError } from '../../utils/errors.js'

const APP_ID    = 'int-test'
const TENANT_ID = '00000000-0000-0000-0000-000000000099'   // test-only, never used in real data

let adminPool   // superuser — used for setup/teardown (bypasses RLS)
let redis       // used to inspect refresh-token keys

beforeAll(async () => {
  adminPool = new pg.Pool({ connectionString: process.env.MIGRATION_DATABASE_URL })
  redis = new Redis(process.env.REDIS_URL)
  await adminPool.query('SELECT 1')   // assert connectivity
  await redis.ping()
})

afterAll(async () => {
  await adminPool.end()
  redis.disconnect()
})

afterEach(async () => {
  // Delete test data in dependency order
  await adminPool.query(
    `DELETE FROM platform_auth.password_resets
     WHERE user_id IN (SELECT id FROM platform_auth.users WHERE app_id = $1)`,
    [APP_ID],
  )
  await adminPool.query(`DELETE FROM platform_auth.users WHERE app_id = $1`, [APP_ID])

  // Remove all refresh-token keys for the test app
  const keys = await redis.keys(`${APP_ID}:*`)
  if (keys.length) await redis.del(...keys)
})

const email = () => `int-${uuidv4()}@test.com`
const pw    = 'Password123!'

// ── register ──────────────────────────────────────────────────────────────────

describe('register', () => {
  it('creates a user row in platform_auth.users', async () => {
    const e = email()
    const result = await register({ appId: APP_ID, tenantId: TENANT_ID, email: e, password: pw })

    expect(result).toMatchObject({ email: e, role: 'user' })
    expect(result.id).toMatch(/^[0-9a-f-]{36}$/)

    // Verify row exists in DB (using superuser bypasses RLS)
    const { rows } = await adminPool.query(
      `SELECT * FROM platform_auth.users WHERE id = $1`, [result.id],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].email).toBe(e)
    expect(rows[0].app_id).toBe(APP_ID)
    expect(rows[0].tenant_id).toBe(TENANT_ID)
    // Password must be hashed — never stored in plaintext
    expect(rows[0].password_hash).not.toBe(pw)
    expect(rows[0].password_hash).toMatch(/^\$2b\$/)
  })

  it('throws ConflictError on duplicate email within same app+tenant', async () => {
    const e = email()
    await register({ appId: APP_ID, tenantId: TENANT_ID, email: e, password: pw })
    await expect(register({ appId: APP_ID, tenantId: TENANT_ID, email: e, password: pw }))
      .rejects.toThrow(ConflictError)
  })

  it('allows same email in different apps (cross-app isolation)', async () => {
    const e = email()
    const a = await register({ appId: APP_ID,          tenantId: TENANT_ID, email: e, password: pw })
    const b = await register({ appId: `${APP_ID}-2`,   tenantId: TENANT_ID, email: e, password: pw })
    expect(a.id).not.toBe(b.id)
    // Cleanup extra app
    await adminPool.query(`DELETE FROM platform_auth.users WHERE app_id = $1`, [`${APP_ID}-2`])
  })
})

// ── login ─────────────────────────────────────────────────────────────────────

describe('login', () => {
  it('returns access token + refresh token on correct credentials', async () => {
    const e = email()
    await register({ appId: APP_ID, tenantId: TENANT_ID, email: e, password: pw })

    const result = await login({ appId: APP_ID, tenantId: TENANT_ID, email: e, password: pw })

    expect(result.accessToken).toBeTruthy()
    expect(result.refreshToken).toMatch(/^[0-9a-f-]{36}$/)
    expect(result.userId).toMatch(/^[0-9a-f-]{36}$/)
    expect(result.role).toBe('user')
  })

  it('stores refresh token in Redis', async () => {
    const e = email()
    const { id } = await register({ appId: APP_ID, tenantId: TENANT_ID, email: e, password: pw })
    const { userId, refreshToken } = await login({ appId: APP_ID, tenantId: TENANT_ID, email: e, password: pw })

    const key = `${APP_ID}:${TENANT_ID}:refresh:${userId}:${refreshToken}`
    const val = await redis.get(key)
    expect(val).toBe('1')
    const ttl = await redis.ttl(key)
    expect(ttl).toBeGreaterThan(0)
  })

  it('throws UnauthorizedError on wrong password', async () => {
    const e = email()
    await register({ appId: APP_ID, tenantId: TENANT_ID, email: e, password: pw })
    await expect(login({ appId: APP_ID, tenantId: TENANT_ID, email: e, password: 'WrongPass!' }))
      .rejects.toThrow(UnauthorizedError)
  })

  it('throws UnauthorizedError when user does not exist', async () => {
    await expect(login({ appId: APP_ID, tenantId: TENANT_ID, email: email(), password: pw }))
      .rejects.toThrow(UnauthorizedError)
  })

  it('increments failed_login_attempts counter on each wrong password', async () => {
    const e = email()
    const { id } = await register({ appId: APP_ID, tenantId: TENANT_ID, email: e, password: pw })

    for (let i = 0; i < 3; i++) {
      await login({ appId: APP_ID, tenantId: TENANT_ID, email: e, password: 'wrong' }).catch(() => {})
    }

    const { rows } = await adminPool.query(`SELECT failed_login_attempts FROM platform_auth.users WHERE id = $1`, [id])
    expect(rows[0].failed_login_attempts).toBe(3)
  })

  it('locks account after 5 failed login attempts', async () => {
    const e = email()
    await register({ appId: APP_ID, tenantId: TENANT_ID, email: e, password: pw })

    for (let i = 0; i < 5; i++) {
      await login({ appId: APP_ID, tenantId: TENANT_ID, email: e, password: 'wrong' }).catch(() => {})
    }

    // 6th attempt with wrong password → account locked message
    const err = await login({ appId: APP_ID, tenantId: TENANT_ID, email: e, password: 'wrong' })
      .catch(e => e)
    expect(err).toBeInstanceOf(UnauthorizedError)
    expect(err.message).toMatch(/locked/)
  })

  it('resets failed_login_attempts on successful login', async () => {
    const e = email()
    const { id } = await register({ appId: APP_ID, tenantId: TENANT_ID, email: e, password: pw })

    // 2 failed attempts
    for (let i = 0; i < 2; i++) {
      await login({ appId: APP_ID, tenantId: TENANT_ID, email: e, password: 'wrong' }).catch(() => {})
    }
    // Successful login resets counter
    await login({ appId: APP_ID, tenantId: TENANT_ID, email: e, password: pw })

    const { rows } = await adminPool.query(`SELECT failed_login_attempts FROM platform_auth.users WHERE id = $1`, [id])
    expect(rows[0].failed_login_attempts).toBe(0)
  })
})

// ── refresh ───────────────────────────────────────────────────────────────────

describe('refresh', () => {
  it('returns new tokens and deletes the old refresh token from Redis', async () => {
    const e = email()
    await register({ appId: APP_ID, tenantId: TENANT_ID, email: e, password: pw })
    const { userId, refreshToken: oldRt } = await login({ appId: APP_ID, tenantId: TENANT_ID, email: e, password: pw })

    const result = await refresh({ appId: APP_ID, tenantId: TENANT_ID, userId, refreshToken: oldRt })

    expect(result.accessToken).toBeTruthy()
    expect(result.refreshToken).not.toBe(oldRt)

    // Old key must be deleted
    const oldKey = `${APP_ID}:${TENANT_ID}:refresh:${userId}:${oldRt}`
    expect(await redis.get(oldKey)).toBeNull()

    // New key must exist
    const newKey = `${APP_ID}:${TENANT_ID}:refresh:${userId}:${result.refreshToken}`
    expect(await redis.get(newKey)).toBe('1')
  })

  it('throws UnauthorizedError when refresh token has already been used (rotation)', async () => {
    const e = email()
    await register({ appId: APP_ID, tenantId: TENANT_ID, email: e, password: pw })
    const { userId, refreshToken } = await login({ appId: APP_ID, tenantId: TENANT_ID, email: e, password: pw })

    await refresh({ appId: APP_ID, tenantId: TENANT_ID, userId, refreshToken })

    // Re-using the same refresh token must fail
    await expect(refresh({ appId: APP_ID, tenantId: TENANT_ID, userId, refreshToken }))
      .rejects.toThrow(UnauthorizedError)
  })

  it('throws UnauthorizedError for a completely unknown refresh token', async () => {
    const e = email()
    const { id } = await register({ appId: APP_ID, tenantId: TENANT_ID, email: e, password: pw })
    await expect(refresh({ appId: APP_ID, tenantId: TENANT_ID, userId: id, refreshToken: uuidv4() }))
      .rejects.toThrow(UnauthorizedError)
  })
})

// ── forgotPassword ────────────────────────────────────────────────────────────

describe('forgotPassword', () => {
  it('creates a password_resets row in DB', async () => {
    const e = email()
    const { id } = await register({ appId: APP_ID, tenantId: TENANT_ID, email: e, password: pw })

    await forgotPassword({ appId: APP_ID, tenantId: TENANT_ID, email: e })

    const { rows } = await adminPool.query(
      `SELECT * FROM platform_auth.password_resets WHERE user_id = $1`, [id],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].used_at).toBeNull()
    expect(new Date(rows[0].expires_at).getTime()).toBeGreaterThan(Date.now())
  })

  it('does not create a reset row when email is unknown (prevents enumeration)', async () => {
    await forgotPassword({ appId: APP_ID, tenantId: TENANT_ID, email: email() })

    const { rows } = await adminPool.query(
      `SELECT * FROM platform_auth.password_resets pr
       JOIN platform_auth.users u ON u.id = pr.user_id
       WHERE u.app_id = $1`, [APP_ID],
    )
    expect(rows).toHaveLength(0)
  })
})

// ── resetPassword ─────────────────────────────────────────────────────────────

describe('resetPassword', () => {
  it('updates the password hash in DB and marks the reset token used', async () => {
    const e = email()
    const { id } = await register({ appId: APP_ID, tenantId: TENANT_ID, email: e, password: pw })
    await forgotPassword({ appId: APP_ID, tenantId: TENANT_ID, email: e })

    const { rows: [reset] } = await adminPool.query(
      `SELECT id FROM platform_auth.password_resets WHERE user_id = $1`, [id],
    )

    const { rows: [before] } = await adminPool.query(`SELECT password_hash FROM platform_auth.users WHERE id = $1`, [id])
    await resetPassword({ token: reset.id, newPassword: 'NewPassword456!' })
    const { rows: [after] } = await adminPool.query(`SELECT password_hash FROM platform_auth.users WHERE id = $1`, [id])

    expect(after.password_hash).not.toBe(before.password_hash)
    expect(after.password_hash).toMatch(/^\$2b\$/)

    const { rows: [usedReset] } = await adminPool.query(`SELECT used_at FROM platform_auth.password_resets WHERE id = $1`, [reset.id])
    expect(usedReset.used_at).not.toBeNull()
  })

  it('invalidates all Redis refresh tokens after password reset', async () => {
    const e = email()
    await register({ appId: APP_ID, tenantId: TENANT_ID, email: e, password: pw })
    const { userId, refreshToken } = await login({ appId: APP_ID, tenantId: TENANT_ID, email: e, password: pw })
    const key = `${APP_ID}:${TENANT_ID}:refresh:${userId}:${refreshToken}`
    expect(await redis.get(key)).toBe('1')

    await forgotPassword({ appId: APP_ID, tenantId: TENANT_ID, email: e })
    const { rows: [reset] } = await adminPool.query(`SELECT id FROM platform_auth.password_resets WHERE user_id = $1`, [userId])
    await resetPassword({ token: reset.id, newPassword: 'NewPassword456!' })

    expect(await redis.get(key)).toBeNull()
  })

  it('throws UnauthorizedError on invalid reset token', async () => {
    await expect(resetPassword({ token: uuidv4(), newPassword: 'NewPassword456!' }))
      .rejects.toThrow(UnauthorizedError)
  })

  it('throws UnauthorizedError when token has already been used', async () => {
    const e = email()
    await register({ appId: APP_ID, tenantId: TENANT_ID, email: e, password: pw })
    await forgotPassword({ appId: APP_ID, tenantId: TENANT_ID, email: e })
    const { rows: [{ id: tokenId }] } = await adminPool.query(
      `SELECT pr.id FROM platform_auth.password_resets pr JOIN platform_auth.users u ON u.id = pr.user_id WHERE u.email = $1`, [e],
    )

    await resetPassword({ token: tokenId, newPassword: 'NewPassword456!' })
    await expect(resetPassword({ token: tokenId, newPassword: 'AnotherPass789!' }))
      .rejects.toThrow(UnauthorizedError)
  })
})

// ── validateToken ─────────────────────────────────────────────────────────────

describe('validateToken', () => {
  it('validates a real access token obtained from login', async () => {
    const e = email()
    const { id } = await register({ appId: APP_ID, tenantId: TENANT_ID, email: e, password: pw })
    const { accessToken } = await login({ appId: APP_ID, tenantId: TENANT_ID, email: e, password: pw })

    const identity = validateToken(accessToken)

    expect(identity.userId).toBe(id)
    expect(identity.appId).toBe(APP_ID)
    expect(identity.tenantId).toBe(TENANT_ID)
    expect(identity.email).toBe(e)
    expect(identity.role).toBe('user')
  })

  it('throws UnauthorizedError for a forged token (signed with wrong secret)', () => {
    const forged = jwt.sign({ sub: uuidv4(), app_id: APP_ID, tenant_id: TENANT_ID, role: 'staff' }, 'wrong-secret')
    expect(() => validateToken(forged)).toThrow(UnauthorizedError)
  })
})

// ── end-to-end flow ───────────────────────────────────────────────────────────

describe('full register → login → refresh → validate flow', () => {
  it('completes without errors and tokens remain valid throughout', async () => {
    const e = email()

    const { id } = await register({ appId: APP_ID, tenantId: TENANT_ID, email: e, password: pw })
    const { accessToken: at1, refreshToken: rt1, userId } = await login({ appId: APP_ID, tenantId: TENANT_ID, email: e, password: pw })

    expect(userId).toBe(id)
    const identity1 = validateToken(at1)
    expect(identity1.userId).toBe(id)

    // Rotate tokens
    const { accessToken: at2, refreshToken: rt2 } = await refresh({ appId: APP_ID, tenantId: TENANT_ID, userId, refreshToken: rt1 })
    expect(rt2).not.toBe(rt1)

    const identity2 = validateToken(at2)
    expect(identity2.userId).toBe(id)
  })
})
