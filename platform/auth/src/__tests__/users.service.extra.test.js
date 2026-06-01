// users.service — cobertura de inviteUser / updateUser / revokeUser /
// resendInvitation (no cubiertos por users.service.test.js ni signup-approval).
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
vi.mock('../lib/db.js', () => ({ pool: { connect: poolConnectMock } }))
vi.mock('../lib/redis.js', () => ({ publish: vi.fn() }))
vi.mock('uuid', () => ({ v4: vi.fn(() => 'fixed-uuid-1234') }))
vi.mock('../repositories/user.repository.js')
vi.mock('../repositories/magic-link.repository.js')
vi.mock('../repositories/password-reset.repository.js')
vi.mock('../services/auth.service.js', () => ({
  register: vi.fn(),
  forgotPassword: vi.fn(),
}))

import {
  inviteUser, updateUser, revokeUser, resendInvitation,
  listUsers, approveUser, rejectUser, updateMe, getById,
} from '../services/users.service.js'
import { publish } from '../lib/redis.js'
import * as userRepo from '../repositories/user.repository.js'
import * as magicLinkRepo from '../repositories/magic-link.repository.js'
import * as authService from '../services/auth.service.js'

const APP    = 'aikikan'
const TENANT = '22222222-2222-2222-2222-222222222222'
const SELF   = '11111111-1111-1111-1111-111111111111'
const TARGET = '33333333-3333-3333-3333-333333333333'

const adminIdentity = { userId: SELF, appId: APP, tenantId: TENANT, role: 'admin' }
const staffIdentity = { userId: SELF, appId: 'platform', tenantId: 'p', role: 'staff' }
const userIdentity  = { userId: SELF, appId: APP, tenantId: TENANT, role: 'user' }

beforeEach(() => {
  vi.clearAllMocks()
  mockClient.query.mockResolvedValue({ rows: [] })
  poolConnectMock.mockResolvedValue(mockClient)
})

// ── inviteUser ───────────────────────────────────────────────────────

describe('inviteUser', () => {
  it('sin identity → 403', async () => {
    await expect(inviteUser({ appId: APP, tenantId: TENANT, email: 'a@x.com' }, null))
      .rejects.toMatchObject({ statusCode: 403 })
  })

  it('non-staff invitando fuera de su tenant → 403', async () => {
    await expect(inviteUser({ appId: 'other', tenantId: TENANT, email: 'a@x.com' }, adminIdentity))
      .rejects.toMatchObject({ statusCode: 403 })
  })

  it('happy path → register + forgotPassword; devuelve userId', async () => {
    authService.register.mockResolvedValue({ id: 'new-user' })
    authService.forgotPassword.mockResolvedValue()
    const r = await inviteUser({ appId: APP, tenantId: TENANT, email: 'a@x.com', role: 'admin' }, adminIdentity)
    expect(authService.register).toHaveBeenCalledWith(expect.objectContaining({
      appId: APP, tenantId: TENANT, email: 'a@x.com', role: 'admin',
    }))
    expect(authService.forgotPassword).toHaveBeenCalledWith({ appId: APP, tenantId: TENANT, email: 'a@x.com' })
    expect(r).toEqual({ userId: 'new-user' })
  })

  it('role default = user cuando no se pasa', async () => {
    authService.register.mockResolvedValue({ id: 'new-user' })
    await inviteUser({ appId: APP, tenantId: TENANT, email: 'a@x.com' }, staffIdentity)
    expect(authService.register).toHaveBeenCalledWith(expect.objectContaining({ role: 'user' }))
  })

  it('displayName → aplica updateProfile antes del magic-link', async () => {
    authService.register.mockResolvedValue({ id: 'new-user' })
    userRepo.updateProfile.mockResolvedValue({ id: 'new-user' })
    await inviteUser({ appId: APP, tenantId: TENANT, email: 'a@x.com', displayName: 'Ana' }, adminIdentity)
    expect(userRepo.updateProfile).toHaveBeenCalledWith(expect.anything(), 'new-user', { displayName: 'Ana' })
  })
})

// ── updateUser ───────────────────────────────────────────────────────

describe('updateUser', () => {
  it('sin identity → 403', async () => {
    await expect(updateUser(TARGET, { displayName: 'X' }, null)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('target inexistente → 404', async () => {
    userRepo.findAnywhereById.mockResolvedValue(null)
    await expect(updateUser(TARGET, { displayName: 'X' }, adminIdentity)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('non-staff target cross-tenant → 403', async () => {
    userRepo.findAnywhereById.mockResolvedValue({ id: TARGET, app_id: 'other', tenant_id: TENANT })
    await expect(updateUser(TARGET, { displayName: 'X' }, adminIdentity)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('happy → updateProfile', async () => {
    userRepo.findAnywhereById.mockResolvedValue({ id: TARGET, app_id: APP, tenant_id: TENANT })
    userRepo.updateProfile.mockResolvedValue({ id: TARGET, display_name: 'New' })
    const r = await updateUser(TARGET, { displayName: 'New' }, adminIdentity)
    expect(r.display_name).toBe('New')
  })

  it('updateProfile devuelve null → 404', async () => {
    userRepo.findAnywhereById.mockResolvedValue({ id: TARGET, app_id: APP, tenant_id: TENANT })
    userRepo.updateProfile.mockResolvedValue(null)
    await expect(updateUser(TARGET, { displayName: 'X' }, adminIdentity)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('staff puede editar cross-tenant', async () => {
    userRepo.findAnywhereById.mockResolvedValue({ id: TARGET, app_id: 'other', tenant_id: 'other-t' })
    userRepo.updateProfile.mockResolvedValue({ id: TARGET })
    await expect(updateUser(TARGET, { displayName: 'X' }, staffIdentity)).resolves.toBeDefined()
  })
})

// ── revokeUser ───────────────────────────────────────────────────────

describe('revokeUser', () => {
  it('sin identity → 403', async () => {
    await expect(revokeUser({ id: TARGET }, null)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('revocarse a sí mismo → 403', async () => {
    await expect(revokeUser({ id: SELF }, adminIdentity)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('target inexistente → 404', async () => {
    userRepo.findAnywhereById.mockResolvedValue(null)
    await expect(revokeUser({ id: TARGET }, adminIdentity)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('non-staff cross-tenant → 403', async () => {
    userRepo.findAnywhereById.mockResolvedValue({ id: TARGET, app_id: 'other', tenant_id: TENANT })
    await expect(revokeUser({ id: TARGET }, adminIdentity)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('happy → softDelete', async () => {
    userRepo.findAnywhereById.mockResolvedValue({ id: TARGET, app_id: APP, tenant_id: TENANT })
    userRepo.softDelete.mockResolvedValue(true)
    await expect(revokeUser({ id: TARGET }, adminIdentity)).resolves.toBeUndefined()
    expect(userRepo.softDelete).toHaveBeenCalledWith(expect.anything(), TARGET)
  })

  it('softDelete false → 404', async () => {
    userRepo.findAnywhereById.mockResolvedValue({ id: TARGET, app_id: APP, tenant_id: TENANT })
    userRepo.softDelete.mockResolvedValue(false)
    await expect(revokeUser({ id: TARGET }, adminIdentity)).rejects.toMatchObject({ statusCode: 404 })
  })
})

// ── resendInvitation ─────────────────────────────────────────────────

describe('resendInvitation', () => {
  it('sin identity → 403', async () => {
    await expect(resendInvitation(TARGET, null)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('target inexistente → 404', async () => {
    userRepo.findAnywhereById.mockResolvedValue(null)
    await expect(resendInvitation(TARGET, adminIdentity)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('non-staff cross-tenant → 403', async () => {
    userRepo.findAnywhereById.mockResolvedValue({ id: TARGET, app_id: 'other', tenant_id: TENANT })
    await expect(resendInvitation(TARGET, adminIdentity)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('user revocado → 409 USER_REVOKED', async () => {
    userRepo.findAnywhereById.mockResolvedValue({ id: TARGET, app_id: APP, tenant_id: TENANT, revoked_at: 'T' })
    await expect(resendInvitation(TARGET, adminIdentity)).rejects.toMatchObject({ statusCode: 409 })
  })

  it('user pending_approval → 409 USER_PENDING_APPROVAL', async () => {
    userRepo.findAnywhereById.mockResolvedValue({ id: TARGET, app_id: APP, tenant_id: TENANT, pending_approval: true })
    await expect(resendInvitation(TARGET, adminIdentity)).rejects.toMatchObject({ statusCode: 409 })
  })

  it('happy → crea magic-link + publish auth.magic_link_requested', async () => {
    userRepo.findAnywhereById.mockResolvedValue({
      id: TARGET, app_id: APP, tenant_id: TENANT, email: 'a@x.com', display_name: 'Ana',
    })
    magicLinkRepo.create.mockResolvedValue({ id: 'ml1' })
    await resendInvitation(TARGET, adminIdentity)
    expect(magicLinkRepo.create).toHaveBeenCalled()
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'auth.magic_link_requested',
      payload: expect.objectContaining({ userId: TARGET, email: 'a@x.com', appId: APP, tenantId: TENANT }),
    }))
  })

  it('staff puede resend cross-tenant', async () => {
    userRepo.findAnywhereById.mockResolvedValue({ id: TARGET, app_id: 'other', tenant_id: 'ot', email: 'a@x.com' })
    magicLinkRepo.create.mockResolvedValue({ id: 'ml1' })
    await expect(resendInvitation(TARGET, staffIdentity)).resolves.toBeUndefined()
  })

  it('happy SIN display_name → displayName cae a null (?? null)', async () => {
    userRepo.findAnywhereById.mockResolvedValue({
      id: TARGET, app_id: APP, tenant_id: TENANT, email: 'a@x.com',  // sin display_name
    })
    magicLinkRepo.create.mockResolvedValue({ id: 'ml1' })
    await resendInvitation(TARGET, adminIdentity)
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ displayName: null }),
    }))
  })
})

// ── listUsers — ramas restantes ──────────────────────────────────────

describe('listUsers — ramas de scope', () => {
  it('non-staff con appId correcto pero tenantId distinto → 403 (rama derecha del ||)', async () => {
    await expect(listUsers({ appId: APP, tenantId: 'otro-tenant' }, userIdentity))
      .rejects.toMatchObject({ statusCode: 403 })
  })

  it('non-staff sin appId en su identity → throw appId/tenantId required', async () => {
    // identity sin appId: tras forzar appId/tenantId quedan undefined →
    // !appId true → !isStaff true → ForbiddenError 'appId and tenantId required'
    const noAppIdentity = { userId: SELF, role: 'user' }
    await expect(listUsers({}, noAppIdentity)).rejects.toMatchObject({ statusCode: 403 })
  })
})

// ── updateMe / getById con identity nullish (rama del ?.) ─────────────

describe('updateMe / getById — identity null', () => {
  it('updateMe con identity null → 403 (rama nullish del optional chaining)', async () => {
    await expect(updateMe({ displayName: 'X' }, null)).rejects.toMatchObject({ statusCode: 403 })
  })
  it('getById con identity null → 403 (rama nullish del optional chaining)', async () => {
    await expect(getById(TARGET, null)).rejects.toMatchObject({ statusCode: 403 })
  })
})

// ── approveUser / rejectUser — ramas restantes ───────────────────────

describe('approveUser — ramas restantes', () => {
  it('target inexistente → 404', async () => {
    userRepo.findAnywhereById.mockResolvedValue(null)
    await expect(approveUser(TARGET, adminIdentity)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('approve() devuelve falsy → 404 (race entre find y approve)', async () => {
    userRepo.findAnywhereById.mockResolvedValue({
      id: TARGET, app_id: APP, tenant_id: TENANT, pending_approval: true,
    })
    userRepo.approve.mockResolvedValue(null)
    await expect(approveUser(TARGET, adminIdentity)).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('rejectUser — ramas restantes', () => {
  it('identity null → 403 (rama nullish del ?.)', async () => {
    await expect(rejectUser(TARGET, null)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('target inexistente → 404', async () => {
    userRepo.findAnywhereById.mockResolvedValue(null)
    await expect(rejectUser(TARGET, adminIdentity)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('non-staff con app_id igual pero tenant distinto → 403 (rama derecha del ||)', async () => {
    userRepo.findAnywhereById.mockResolvedValue({
      id: TARGET, app_id: APP, tenant_id: 'otro-tenant', pending_approval: true,
    })
    await expect(rejectUser(TARGET, adminIdentity)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('hardDelete devuelve false → 404', async () => {
    userRepo.findAnywhereById.mockResolvedValue({
      id: TARGET, app_id: APP, tenant_id: TENANT, pending_approval: true,
    })
    userRepo.hardDelete.mockResolvedValue(false)
    await expect(rejectUser(TARGET, adminIdentity)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('happy SIN reason → reason cae a null (?? null)', async () => {
    userRepo.findAnywhereById.mockResolvedValue({
      id: TARGET, app_id: APP, tenant_id: TENANT,
      email: 'r@x', display_name: 'R', pending_approval: true,
    })
    userRepo.hardDelete.mockResolvedValue(true)
    await rejectUser(TARGET, adminIdentity)   // sin 3er arg → {} default → reason undefined
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'auth.signup.rejected',
      payload: expect.objectContaining({ reason: null }),
    }))
  })
})

// ── withStaffContext: rama .catch del ROLLBACK ───────────────────────

describe('rollback .catch en withStaffContext', () => {
  it('si fn lanza Y el ROLLBACK también rechaza, el .catch lo traga y re-lanza el error original', async () => {
    const throwingClient = {
      query: vi.fn(async (sql) => {
        if (typeof sql === 'string' && sql.startsWith('ROLLBACK')) throw new Error('rollback failed')
        return { rows: [] }
      }),
      release: vi.fn(),
    }
    poolConnectMock.mockResolvedValue(throwingClient)
    // findAnywhereById null → NotFoundError dentro de withStaffContext → ROLLBACK
    userRepo.findAnywhereById.mockResolvedValue(null)
    await expect(getById(TARGET, adminIdentity)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('withTenantContext: fn lanza Y ROLLBACK rechaza → .catch lo traga (listUsers non-staff)', async () => {
    const throwingClient = {
      query: vi.fn(async (sql) => {
        if (typeof sql === 'string' && sql.startsWith('ROLLBACK')) throw new Error('rollback failed')
        return { rows: [] }
      }),
      release: vi.fn(),
    }
    poolConnectMock.mockResolvedValue(throwingClient)
    // non-staff con appId/tenantId válidos → ruta withTenantContext.
    // userRepo.list lanza dentro de la transacción → ROLLBACK (que rechaza).
    userRepo.list.mockRejectedValue(new Error('list failed'))
    await expect(listUsers({ appId: APP, tenantId: TENANT }, userIdentity))
      .rejects.toThrow('list failed')
  })
})
