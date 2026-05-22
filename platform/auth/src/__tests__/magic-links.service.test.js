import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'node:crypto'

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
  redis: { setex: vi.fn(), get: vi.fn(), del: vi.fn(), keys: vi.fn() },
  publish: vi.fn(),
}))

vi.mock('uuid', () => ({ v4: vi.fn(() => 'fixed-magic-uuid') }))
vi.mock('../repositories/user.repository.js')
vi.mock('../repositories/magic-link.repository.js')

import { requestMagicLink, loginWithMagicLink } from '../services/auth.service.js'
import { pool } from '../lib/db.js'
import { publish, redis } from '../lib/redis.js'
import * as userRepo      from '../repositories/user.repository.js'
import * as magicLinkRepo from '../repositories/magic-link.repository.js'

const APP    = 'aikikan'
const TENANT = '30000000-0000-0000-0000-000000000001'
const USER   = '11111111-1111-1111-1111-111111111111'

function mockClient() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }
}

beforeEach(() => vi.clearAllMocks())

// ── requestMagicLink ────────────────────────────────────────────────────

describe('requestMagicLink', () => {
  it('emite token plain por evento + persiste SHA-256 hash (nunca el plain)', async () => {
    const client = mockClient()
    pool.connect.mockResolvedValue(client)
    userRepo.findByEmail.mockResolvedValue({
      id: USER, email: 'socio@x.org', display_name: 'Socio',
      revoked_at: null, pending_approval: false, pending_activation: false,
    })

    await requestMagicLink({ appId: APP, tenantId: TENANT, email: 'socio@x.org' })

    // 1) magicLinkRepo.create recibe el HASH, no el plain
    expect(magicLinkRepo.create).toHaveBeenCalledTimes(1)
    const createArgs = magicLinkRepo.create.mock.calls[0][1]
    expect(createArgs.tokenHash).toMatch(/^[a-f0-9]{64}$/)   // sha256 hex
    expect(createArgs.tokenHash).not.toContain('=')          // no es base64
    expect(createArgs).not.toHaveProperty('token')           // jamás el plain

    // 2) publish lleva el plain (necesario para email)
    expect(publish).toHaveBeenCalledTimes(1)
    const evt = publish.mock.calls[0][0]
    expect(evt.type).toBe('auth.magic_link_requested')
    expect(typeof evt.payload.token).toBe('string')
    expect(evt.payload.token.length).toBeGreaterThanOrEqual(40)   // 32 bytes base64url ≈ 43 chars

    // 3) El hash persistido coincide con SHA-256 del plain del evento
    const expected = crypto.createHash('sha256').update(evt.payload.token, 'utf8').digest('hex')
    expect(createArgs.tokenHash).toBe(expected)
  })

  it('expiry = +15 minutos desde now', async () => {
    const client = mockClient()
    pool.connect.mockResolvedValue(client)
    userRepo.findByEmail.mockResolvedValue({
      id: USER, email: 'x@x', revoked_at: null,
      pending_approval: false, pending_activation: false,
    })

    const before = Date.now()
    await requestMagicLink({ appId: APP, tenantId: TENANT, email: 'x@x' })
    const after = Date.now()

    const { expiresAt } = magicLinkRepo.create.mock.calls[0][1]
    const exp = new Date(expiresAt).getTime()
    expect(exp - before).toBeGreaterThanOrEqual(15 * 60 * 1000 - 50)
    expect(exp - after).toBeLessThanOrEqual(15 * 60 * 1000 + 50)
  })

  it('NO crea link ni emite evento para email desconocido (silent, anti-enumeration)', async () => {
    const client = mockClient()
    pool.connect.mockResolvedValue(client)
    userRepo.findByEmail.mockResolvedValue(null)

    await requestMagicLink({ appId: APP, tenantId: TENANT, email: 'nonexistent@x' })

    expect(magicLinkRepo.create).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
  })

  it('si el user está revoked_at, NO emite evento', async () => {
    const client = mockClient()
    pool.connect.mockResolvedValue(client)
    userRepo.findByEmail.mockResolvedValue({
      id: USER, email: 'r@x', revoked_at: new Date(),
      pending_approval: false, pending_activation: false,
    })

    await requestMagicLink({ appId: APP, tenantId: TENANT, email: 'r@x' })
    expect(publish).not.toHaveBeenCalled()
  })

  it('pending_approval → emite auth.magic_link_blocked_pending_approval (NO el normal)', async () => {
    const client = mockClient()
    pool.connect.mockResolvedValue(client)
    userRepo.findByEmail.mockResolvedValue({
      id: USER, email: 'pending@x', display_name: 'Pendiente',
      revoked_at: null, pending_approval: true, pending_activation: false,
    })

    await requestMagicLink({ appId: APP, tenantId: TENANT, email: 'pending@x' })

    expect(magicLinkRepo.create).not.toHaveBeenCalled()
    expect(publish).toHaveBeenCalledTimes(1)
    expect(publish.mock.calls[0][0].type).toBe('auth.magic_link_blocked_pending_approval')
  })
})

// ── loginWithMagicLink ──────────────────────────────────────────────────

describe('loginWithMagicLink', () => {
  it('rechaza token vacío con UnauthorizedError', async () => {
    await expect(loginWithMagicLink({ token: '' })).rejects.toMatchObject({ statusCode: 401 })
  })

  it('busca por SHA-256 del token, no por el plain', async () => {
    const client = mockClient()
    pool.connect.mockResolvedValue(client)
    magicLinkRepo.findAnyByHash.mockResolvedValue(null)

    await expect(loginWithMagicLink({ token: 'plain-token-xyz' })).rejects.toMatchObject({ statusCode: 401 })

    expect(magicLinkRepo.findAnyByHash).toHaveBeenCalledTimes(1)
    const hashedArg = magicLinkRepo.findAnyByHash.mock.calls[0][1]
    expect(hashedArg).toBe(crypto.createHash('sha256').update('plain-token-xyz', 'utf8').digest('hex'))
  })

  it('rechaza con TOKEN_USED si consumed_at != null (replay attack)', async () => {
    const client = mockClient()
    pool.connect.mockResolvedValue(client)
    magicLinkRepo.findAnyByHash.mockResolvedValue({
      id: 'ml1', user_id: USER, consumed_at: new Date(), expires_at: new Date(Date.now() + 60000),
    })
    await expect(loginWithMagicLink({ token: 'x' })).rejects.toMatchObject({
      code: 'TOKEN_USED', statusCode: 410,
    })
  })

  it('rechaza con TOKEN_EXPIRED si expires_at en el pasado', async () => {
    const client = mockClient()
    pool.connect.mockResolvedValue(client)
    magicLinkRepo.findAnyByHash.mockResolvedValue({
      id: 'ml1', user_id: USER, consumed_at: null, expires_at: new Date(Date.now() - 1000),
    })
    await expect(loginWithMagicLink({ token: 'x' })).rejects.toMatchObject({
      code: 'TOKEN_EXPIRED', statusCode: 410,
    })
  })

  it('happy path: marca consumed_at, emite tokens, almacena refresh en Redis', async () => {
    const client = mockClient()
    pool.connect.mockResolvedValue(client)
    magicLinkRepo.findAnyByHash.mockResolvedValue({
      id: 'ml1', user_id: USER, consumed_at: null, expires_at: new Date(Date.now() + 60000),
    })
    userRepo.findAnywhereById.mockResolvedValue({
      id: USER, app_id: APP, tenant_id: TENANT, sub_tenant_id: null,
      email: 'x@x', role: 'user', revoked_at: null,
      pending_approval: false, pending_activation: false,
    })

    const r = await loginWithMagicLink({ token: 'plain-xyz' })

    expect(magicLinkRepo.markConsumed).toHaveBeenCalledWith(client, 'ml1')
    expect(userRepo.touchLastLogin).toHaveBeenCalledWith(client, USER)
    expect(redis.setex).toHaveBeenCalledTimes(1)
    expect(r).toMatchObject({ userId: USER, role: 'user' })
    expect(typeof r.accessToken).toBe('string')
    expect(typeof r.refreshToken).toBe('string')
  })

  it('replay attack: 2º intento con mismo token → TOKEN_USED', async () => {
    const client = mockClient()
    pool.connect.mockResolvedValue(client)
    // Primera llamada: ok
    magicLinkRepo.findAnyByHash.mockResolvedValueOnce({
      id: 'ml1', user_id: USER, consumed_at: null, expires_at: new Date(Date.now() + 60000),
    })
    userRepo.findAnywhereById.mockResolvedValue({
      id: USER, app_id: APP, tenant_id: TENANT, sub_tenant_id: null,
      email: 'x@x', role: 'user', revoked_at: null,
      pending_approval: false, pending_activation: false,
    })
    await loginWithMagicLink({ token: 'plain' })

    // Segunda llamada: ahora el repo lo devuelve consumido
    magicLinkRepo.findAnyByHash.mockResolvedValueOnce({
      id: 'ml1', user_id: USER, consumed_at: new Date(), expires_at: new Date(Date.now() + 60000),
    })
    await expect(loginWithMagicLink({ token: 'plain' })).rejects.toMatchObject({ code: 'TOKEN_USED' })
  })

  it('user revoked_at tras emisión del link → UNAUTHORIZED', async () => {
    const client = mockClient()
    pool.connect.mockResolvedValue(client)
    magicLinkRepo.findAnyByHash.mockResolvedValue({
      id: 'ml1', user_id: USER, consumed_at: null, expires_at: new Date(Date.now() + 60000),
    })
    userRepo.findAnywhereById.mockResolvedValue({
      id: USER, app_id: APP, tenant_id: TENANT, sub_tenant_id: null,
      email: 'x@x', role: 'user', revoked_at: new Date(),
      pending_approval: false, pending_activation: false,
    })
    await expect(loginWithMagicLink({ token: 'x' })).rejects.toMatchObject({ statusCode: 401 })
  })

  it('user con pending_approval → PENDING_APPROVAL 403 (no completa login)', async () => {
    const client = mockClient()
    pool.connect.mockResolvedValue(client)
    magicLinkRepo.findAnyByHash.mockResolvedValue({
      id: 'ml1', user_id: USER, consumed_at: null, expires_at: new Date(Date.now() + 60000),
    })
    userRepo.findAnywhereById.mockResolvedValue({
      id: USER, app_id: APP, tenant_id: TENANT, sub_tenant_id: null,
      email: 'p@x', role: 'user', revoked_at: null,
      pending_approval: true, pending_activation: false,
    })
    await expect(loginWithMagicLink({ token: 'x' })).rejects.toMatchObject({
      code: 'PENDING_APPROVAL', statusCode: 403,
    })
    expect(magicLinkRepo.markConsumed).not.toHaveBeenCalled()
  })
})
