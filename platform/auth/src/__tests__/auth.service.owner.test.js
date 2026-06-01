// auth.service — owner/activation flow + countAdmins + tenantRequiresApproval.
// (no cubiertos por auth.service.test.js, magic-links ni signup-approval).
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

const { poolConnectMock, mockClient } = vi.hoisted(() => {
  const client = { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }
  return { mockClient: client, poolConnectMock: vi.fn().mockResolvedValue(client) }
})
vi.mock('../lib/db.js', () => ({
  pool: { connect: poolConnectMock },
  setTenantContext: vi.fn(),
  withTenantTransaction: vi.fn(),
}))
vi.mock('../lib/redis.js', () => ({
  redis: { setex: vi.fn(), get: vi.fn(), del: vi.fn(), keys: vi.fn() },
  publish: vi.fn(),
}))
vi.mock('bcrypt', () => ({ default: { hash: vi.fn().mockResolvedValue('bcrypt-hash') } }))
vi.mock('jsonwebtoken', () => ({ default: { sign: vi.fn(() => 'signed.jwt'), verify: vi.fn() } }))
vi.mock('uuid', () => ({ v4: vi.fn(() => 'fixed-uuid') }))
vi.mock('../repositories/user.repository.js')
vi.mock('../repositories/activation-token.repository.js')

import {
  tenantRequiresApproval, createOwnerWithActivation, reissueActivationForOwner,
  getOwnerState, deletePendingOwner, countAdmins, activate,
} from '../services/auth.service.js'
import { redis, publish } from '../lib/redis.js'
import * as userRepo from '../repositories/user.repository.js'
import * as activationRepo from '../repositories/activation-token.repository.js'

const APP = 'aikikan'
const TENANT = '22222222-2222-2222-2222-222222222222'

beforeEach(() => {
  vi.clearAllMocks()
  mockClient.query.mockResolvedValue({ rows: [] })
  poolConnectMock.mockResolvedValue(mockClient)
})

// ── tenantRequiresApproval ───────────────────────────────────────────

describe('tenantRequiresApproval', () => {
  it('sin appId/tenantId → false sin tocar DB', async () => {
    expect(await tenantRequiresApproval(null, TENANT)).toBe(false)
    expect(await tenantRequiresApproval(APP, null)).toBe(false)
    expect(poolConnectMock).not.toHaveBeenCalled()
  })

  it('row con requires_user_approval=true → true', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [{ requires_user_approval: true }] })
    expect(await tenantRequiresApproval(APP, TENANT)).toBe(true)
    expect(mockClient.query.mock.calls[0][1]).toEqual([TENANT, APP])
    expect(mockClient.release).toHaveBeenCalled()
  })

  it('sin row → false', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [] })
    expect(await tenantRequiresApproval(APP, TENANT)).toBe(false)
  })
})

// ── createOwnerWithActivation ────────────────────────────────────────

describe('createOwnerWithActivation', () => {
  it('email existente → ConflictError 409', async () => {
    userRepo.findByEmail.mockResolvedValue({ id: 'existing' })
    await expect(createOwnerWithActivation({ appId: APP, tenantId: TENANT, email: 'a@x.com', displayName: 'A' }))
      .rejects.toMatchObject({ statusCode: 409 })
    // ROLLBACK
    const sqls = mockClient.query.mock.calls.map((c) => c[0])
    expect(sqls).toContain('ROLLBACK')
  })

  it('happy → crea user owner + activation token; devuelve plainToken', async () => {
    userRepo.findByEmail.mockResolvedValue(null)
    userRepo.createUser.mockResolvedValue({ id: 'fixed-uuid' })
    activationRepo.create.mockResolvedValue({ id: 'tok-1' })
    const r = await createOwnerWithActivation({ appId: APP, tenantId: TENANT, email: 'a@x.com', displayName: 'A' })
    expect(userRepo.createUser).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ role: 'owner', pendingActivation: true }))
    expect(activationRepo.create).toHaveBeenCalled()
    expect(r.userId).toBe('fixed-uuid')
    expect(typeof r.plainToken).toBe('string')
    expect(r.expiresAt).toBeInstanceOf(Date)
    expect(mockClient.query.mock.calls.map((c) => c[0])).toContain('COMMIT')
  })
})

// ── reissueActivationForOwner ────────────────────────────────────────

describe('reissueActivationForOwner', () => {
  it('user inexistente → 404', async () => {
    userRepo.findAnywhereById.mockResolvedValue(null)
    await expect(reissueActivationForOwner({ userId: 'u1' })).rejects.toMatchObject({ statusCode: 404 })
  })

  it('owner ya activado (pending_activation=false) → 409', async () => {
    userRepo.findAnywhereById.mockResolvedValue({ id: 'u1', pending_activation: false })
    await expect(reissueActivationForOwner({ userId: 'u1' })).rejects.toMatchObject({ statusCode: 409 })
  })

  it('happy → revoca tokens + crea uno nuevo; devuelve datos del owner', async () => {
    userRepo.findAnywhereById.mockResolvedValue({
      id: 'u1', pending_activation: true, app_id: APP, tenant_id: TENANT,
      email: 'a@x.com', display_name: 'Ana',
    })
    activationRepo.create.mockResolvedValue({ id: 'tok-2' })
    const r = await reissueActivationForOwner({ userId: 'u1' })
    expect(activationRepo.revokeAllForUser).toHaveBeenCalledWith(expect.anything(), 'u1')
    expect(activationRepo.create).toHaveBeenCalled()
    expect(r).toMatchObject({ userId: 'u1', appId: APP, tenantId: TENANT, email: 'a@x.com', displayName: 'Ana' })
    expect(typeof r.plainToken).toBe('string')
  })
})

// ── getOwnerState ────────────────────────────────────────────────────

describe('getOwnerState', () => {
  it('devuelve el primer owner activo o null', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // set_config
      .mockResolvedValueOnce({ rows: [] }) // set_config
      .mockResolvedValueOnce({ rows: [] }) // set_config
      .mockResolvedValueOnce({ rows: [{ id: 'owner-1', email: 'o@x.com' }] }) // SELECT
      .mockResolvedValueOnce({ rows: [] }) // COMMIT
    const r = await getOwnerState({ tenantId: TENANT })
    expect(r).toEqual({ id: 'owner-1', email: 'o@x.com' })
  })

  it('sin owner → null', async () => {
    // default mock devuelve rows:[] siempre
    const r = await getOwnerState({ tenantId: TENANT })
    expect(r).toBeNull()
  })
})

// ── deletePendingOwner ───────────────────────────────────────────────

describe('deletePendingOwner', () => {
  it('owner ya activado → 409', async () => {
    mockClient.query.mockImplementation(async (sql) => {
      if (/SELECT id, owner_activated_at/.test(sql)) {
        return { rows: [{ id: 'owner-1', owner_activated_at: 'T' }] }
      }
      return { rows: [], rowCount: 0 }
    })
    await expect(deletePendingOwner({ tenantId: TENANT })).rejects.toMatchObject({ statusCode: 409 })
  })

  it('happy → borra owners pendientes; devuelve count', async () => {
    mockClient.query.mockImplementation(async (sql) => {
      if (/SELECT id, owner_activated_at/.test(sql)) {
        return { rows: [{ id: 'owner-1', owner_activated_at: null }] }
      }
      if (/DELETE FROM platform_auth\.users/.test(sql)) {
        return { rows: [], rowCount: 1 }
      }
      return { rows: [] }
    })
    const r = await deletePendingOwner({ tenantId: TENANT })
    expect(r).toEqual({ deleted: 1 })
  })

  it('sin owners → deleted 0', async () => {
    const r = await deletePendingOwner({ tenantId: TENANT })
    expect(r).toEqual({ deleted: 0 })
  })
})

// ── countAdmins ──────────────────────────────────────────────────────

describe('countAdmins', () => {
  it('devuelve count', async () => {
    mockClient.query.mockImplementation(async (sql) => {
      if (/COUNT\(\*\)/.test(sql)) return { rows: [{ count: 3 }] }
      return { rows: [] }
    })
    expect(await countAdmins({ tenantId: TENANT })).toBe(3)
  })

  it('sin rows → 0', async () => {
    mockClient.query.mockImplementation(async (sql) => {
      if (/COUNT\(\*\)/.test(sql)) return { rows: [] }
      return { rows: [] }
    })
    expect(await countAdmins({ tenantId: TENANT })).toBe(0)
  })
})

// ── activate ─────────────────────────────────────────────────────────

describe('activate', () => {
  it('sin token → 401', async () => {
    await expect(activate({ token: null, password: 'password123' })).rejects.toMatchObject({ statusCode: 401 })
  })

  it('sin password → 422', async () => {
    await expect(activate({ token: 't', password: null })).rejects.toMatchObject({ statusCode: 422 })
  })

  it('password corta → 422', async () => {
    await expect(activate({ token: 't', password: 'short' })).rejects.toMatchObject({ statusCode: 422 })
  })

  it('token inexistente → 401', async () => {
    activationRepo.findAnyByHash.mockResolvedValue(null)
    await expect(activate({ token: 't', password: 'password123' })).rejects.toMatchObject({ statusCode: 401 })
  })

  it('token consumido → 410', async () => {
    activationRepo.findAnyByHash.mockResolvedValue({ id: 'a1', consumed_at: 'T' })
    await expect(activate({ token: 't', password: 'password123' })).rejects.toMatchObject({ statusCode: 410 })
  })

  it('token expirado → 410', async () => {
    activationRepo.findAnyByHash.mockResolvedValue({
      id: 'a1', consumed_at: null, expires_at: new Date(Date.now() - 1000).toISOString(), user_id: 'u1',
    })
    await expect(activate({ token: 't', password: 'password123' })).rejects.toMatchObject({ statusCode: 410 })
  })

  it('user no encontrado / revocado → 401', async () => {
    activationRepo.findAnyByHash.mockResolvedValue({
      id: 'a1', consumed_at: null, expires_at: new Date(Date.now() + 100000).toISOString(), user_id: 'u1',
    })
    userRepo.findAnywhereById.mockResolvedValue(null)
    await expect(activate({ token: 't', password: 'password123' })).rejects.toMatchObject({ statusCode: 401 })

    userRepo.findAnywhereById.mockResolvedValue({ id: 'u1', revoked_at: 'T' })
    await expect(activate({ token: 't', password: 'password123' })).rejects.toMatchObject({ statusCode: 401 })
  })

  it('happy → markActivated + markConsumed + tokens + publish tenant.activated', async () => {
    activationRepo.findAnyByHash.mockResolvedValue({
      id: 'a1', consumed_at: null, expires_at: new Date(Date.now() + 100000).toISOString(), user_id: 'u1',
    })
    userRepo.findAnywhereById.mockResolvedValue({
      id: 'u1', app_id: APP, tenant_id: TENANT, sub_tenant_id: null,
      email: 'o@x.com', role: 'owner', revoked_at: null,
    })
    const r = await activate({ token: 't', password: 'password123' })
    expect(userRepo.markActivated).toHaveBeenCalledWith(expect.anything(), 'u1', 'bcrypt-hash')
    expect(activationRepo.markConsumed).toHaveBeenCalledWith(expect.anything(), 'a1')
    expect(redis.setex).toHaveBeenCalled()
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'tenant.activated' }))
    expect(r).toMatchObject({
      accessToken: 'signed.jwt', userId: 'u1', role: 'owner', appId: APP, tenantId: TENANT,
    })
    expect(typeof r.refreshToken).toBe('string')
  })
})
