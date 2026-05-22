// users.service — gobierno de usuarios + role gates en platform/auth.
// Contrato:
//   - isStaff: role ∈ {staff, super_admin}. Si NO staff:
//       · listUsers fuerza appId/tenantId al del identity (no puede consultar otros).
//       · changeRole / updateUser / getById bloquean target en otro tenant.
//   - changeRole: nunca el propio user → ForbiddenError ("Cannot change your own role").
//   - getMe/updateMe: requieren identity.userId; el ID viene del JWT, no del URL.
//   - 404 cuando el user no existe en cualquier endpoint que busca.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: {
    NODE_ENV: 'test', LOG_LEVEL: 'error',
    DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost',
    PLATFORM_JWT_SECRET: 'test-secret-32-chars-xxxxxxxxxxxxxxx',
  },
}))
const { poolConnectMock, mockClient } = vi.hoisted(() => {
  const client = {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    release: vi.fn(),
  }
  return {
    mockClient: client,
    poolConnectMock: vi.fn().mockResolvedValue(client),
  }
})
vi.mock('../lib/db.js', () => ({
  pool: { connect: poolConnectMock },
}))
vi.mock('../lib/redis.js', () => ({ publish: vi.fn() }))
vi.mock('../repositories/user.repository.js')
vi.mock('../repositories/password-reset.repository.js')
vi.mock('../services/auth.service.js', () => ({
  register: vi.fn(),
  forgotPassword: vi.fn(),
}))

import {
  listUsers, changeRole, getMe, updateMe, getById,
} from '../services/users.service.js'
import * as userRepo from '../repositories/user.repository.js'

const APP    = 'aikikan'
const TENANT = '22222222-2222-2222-2222-222222222222'
const SELF   = '11111111-1111-1111-1111-111111111111'
const OTHER  = '33333333-3333-3333-3333-333333333333'

const userIdentity  = { userId: SELF, appId: APP, tenantId: TENANT, role: 'user' }
const adminIdentity = { userId: SELF, appId: APP, tenantId: TENANT, role: 'admin' }
const staffIdentity = { userId: SELF, appId: 'console', tenantId: 'platform', role: 'staff' }

beforeEach(() => {
  vi.clearAllMocks()
  mockClient.query.mockResolvedValue({ rows: [] })
  mockClient.release.mockReset()
  poolConnectMock.mockResolvedValue(mockClient)
})

// ── listUsers — staff vs non-staff scoping ─────────────────────────

describe('listUsers — tenant scoping', () => {
  it('staff: puede listar de cualquier (appId, tenantId)', async () => {
    userRepo.list.mockResolvedValue([{ id: 'u1' }])
    await listUsers({ appId: 'aulavera', tenantId: 'other-t' }, staffIdentity)
    expect(userRepo.list).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      appId: 'aulavera', tenantId: 'other-t',
    }))
  })

  it('non-staff: appId/tenantId distintos al propio → ForbiddenError', async () => {
    await expect(listUsers({ appId: 'aulavera', tenantId: TENANT }, userIdentity))
      .rejects.toMatchObject({ statusCode: 403 })
  })

  it('non-staff: appId vacío → forzado al identity.appId (no leak cross-app)', async () => {
    userRepo.list.mockResolvedValue([])
    await listUsers({}, userIdentity)
    expect(userRepo.list).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      appId: APP, tenantId: TENANT,
    }))
  })

  it('staff sin appId/tenantId → consulta global (cross-tenant via withStaffContext)', async () => {
    userRepo.list.mockResolvedValue([])
    await listUsers({}, staffIdentity)
    expect(userRepo.list).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      appId: undefined, tenantId: undefined,
    }))
  })
})

// ── changeRole — guards críticos ────────────────────────────────────

describe('changeRole', () => {
  it('identity sin userId → ForbiddenError', async () => {
    await expect(changeRole({ id: SELF, role: 'admin' }, {}))
      .rejects.toMatchObject({ statusCode: 403 })
  })

  it('id === identity.userId → ForbiddenError "Cannot change your own role"', async () => {
    await expect(changeRole({ id: SELF, role: 'super_admin' }, adminIdentity))
      .rejects.toMatchObject({
        statusCode: 403, message: expect.stringContaining('your own role'),
      })
    expect(userRepo.updateRole).not.toHaveBeenCalled()
  })

  it('target no existe → NotFoundError', async () => {
    userRepo.findAnywhereById.mockResolvedValue(null)
    await expect(changeRole({ id: OTHER, role: 'admin' }, adminIdentity))
      .rejects.toMatchObject({ statusCode: 404 })
  })

  it('non-staff: target en OTRO tenant → ForbiddenError', async () => {
    userRepo.findAnywhereById.mockResolvedValue({
      id: OTHER, app_id: 'other-app', tenant_id: 'other-tenant',
    })
    await expect(changeRole({ id: OTHER, role: 'admin' }, adminIdentity))
      .rejects.toMatchObject({
        statusCode: 403, message: expect.stringContaining('outside your tenant'),
      })
  })

  it('staff: puede cambiar role en cualquier tenant', async () => {
    userRepo.findAnywhereById.mockResolvedValue({
      id: OTHER, app_id: 'random', tenant_id: 'random',
    })
    userRepo.updateRole.mockResolvedValue({ id: OTHER, role: 'admin' })
    await changeRole({ id: OTHER, role: 'admin' }, staffIdentity)
    expect(userRepo.updateRole).toHaveBeenCalledWith(expect.anything(), OTHER, 'admin')
  })

  it('admin del mismo tenant que el target → permitido', async () => {
    userRepo.findAnywhereById.mockResolvedValue({
      id: OTHER, app_id: APP, tenant_id: TENANT,
    })
    userRepo.updateRole.mockResolvedValue({ id: OTHER, role: 'admin' })
    await changeRole({ id: OTHER, role: 'admin' }, adminIdentity)
    expect(userRepo.updateRole).toHaveBeenCalled()
  })
})

// ── getMe / updateMe — identity = source of truth ──────────────────

describe('getMe', () => {
  it('sin identity.userId → ForbiddenError', async () => {
    await expect(getMe({})).rejects.toMatchObject({ statusCode: 403 })
  })

  it('lookup por identity.userId (NUNCA del URL)', async () => {
    userRepo.findAnywhereById.mockResolvedValue({ id: SELF })
    await getMe(userIdentity)
    expect(userRepo.findAnywhereById).toHaveBeenCalledWith(expect.anything(), SELF)
  })

  it('user no encontrado → NotFoundError', async () => {
    userRepo.findAnywhereById.mockResolvedValue(null)
    await expect(getMe(userIdentity)).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('updateMe', () => {
  it('actualiza displayName del propio user', async () => {
    userRepo.updateProfile.mockResolvedValue({ id: SELF, display_name: 'New Name' })
    await updateMe({ displayName: 'New Name' }, userIdentity)
    expect(userRepo.updateProfile).toHaveBeenCalledWith(expect.anything(), SELF, { displayName: 'New Name' })
  })

  it('user no existe (race) → NotFoundError', async () => {
    userRepo.updateProfile.mockResolvedValue(null)
    await expect(updateMe({ displayName: 'X' }, userIdentity))
      .rejects.toMatchObject({ statusCode: 404 })
  })
})

// ── getById — boundary cross-tenant ─────────────────────────────────

describe('getById', () => {
  it('user no existe → NotFoundError', async () => {
    userRepo.findAnywhereById.mockResolvedValue(null)
    await expect(getById(OTHER, adminIdentity)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('non-staff: user en OTRO tenant → ForbiddenError', async () => {
    userRepo.findAnywhereById.mockResolvedValue({
      id: OTHER, app_id: 'other-app', tenant_id: 'other',
    })
    await expect(getById(OTHER, adminIdentity)).rejects.toMatchObject({
      statusCode: 403, message: expect.stringContaining('outside your tenant'),
    })
  })

  it('staff: cualquier tenant → OK', async () => {
    userRepo.findAnywhereById.mockResolvedValue({ id: OTHER, app_id: 'x', tenant_id: 'y' })
    const r = await getById(OTHER, staffIdentity)
    expect(r.id).toBe(OTHER)
  })

  it('user del mismo tenant → admin puede leer', async () => {
    userRepo.findAnywhereById.mockResolvedValue({
      id: OTHER, app_id: APP, tenant_id: TENANT,
    })
    const r = await getById(OTHER, adminIdentity)
    expect(r.id).toBe(OTHER)
  })
})
