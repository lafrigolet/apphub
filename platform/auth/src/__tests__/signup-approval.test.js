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
  redis: { setex: vi.fn(), get: vi.fn(), del: vi.fn(), keys: vi.fn() },
  publish: vi.fn(),
}))
vi.mock('uuid', () => ({ v4: vi.fn(() => 'fixed-uuid-1234') }))
vi.mock('../repositories/user.repository.js')
vi.mock('../repositories/password-reset.repository.js')

import { requestMembership, login } from '../services/auth.service.js'
import { approveUser, rejectUser } from '../services/users.service.js'
import { pool, withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as userRepo  from '../repositories/user.repository.js'
import * as resetRepo from '../repositories/password-reset.repository.js'

const APP    = 'aikikan'
const TENANT = '30000000-0000-0000-0000-000000000001'
const TARGET = '99999999-9999-9999-9999-999999999999'
const ADMIN  = { userId: 'a1', appId: APP, tenantId: TENANT, role: 'admin' }
const USER   = { userId: 'u1', appId: APP, tenantId: TENANT, role: 'user' }
const STAFF  = { userId: 's1', appId: 'platform', tenantId: TENANT, role: 'super_admin' }

function mockClient() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }
}

beforeEach(() => vi.clearAllMocks())

// ── requestMembership ────────────────────────────────────────────────────

describe('requestMembership — fase 1: visitante solicita alta', () => {
  it('crea user con pending_approval=TRUE, sin password_hash, role=user', async () => {
    const client = mockClient()
    // Tenant requires_user_approval=true (consulta directa)
    pool.connect.mockResolvedValue({
      ...client,
      query: vi.fn().mockResolvedValue({ rows: [{ requires_user_approval: true }] }),
    })
    withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(client))
    userRepo.findByEmail.mockResolvedValue(null)

    const r = await requestMembership({
      appId: APP, tenantId: TENANT,
      email: 'newbie@x.org', displayName: 'Nuevo Socio', notes: 'Conocí por un amigo',
    })

    expect(userRepo.createUser).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        appId: APP, tenantId: TENANT, email: 'newbie@x.org',
        passwordHash: null, role: 'user',
        pendingApproval: true, pendingActivation: false,
        displayName: 'Nuevo Socio',
      }),
    )
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'auth.signup.requested',
        payload: expect.objectContaining({ email: 'newbie@x.org', notes: 'Conocí por un amigo' }),
      }),
    )
    expect(r.userId).toBe('fixed-uuid-1234')
  })

  it('rechaza si el tenant NO requiere aprobación (APPROVAL_NOT_REQUIRED 400)', async () => {
    pool.connect.mockResolvedValue({
      query: vi.fn().mockResolvedValue({ rows: [{ requires_user_approval: false }] }),
      release: vi.fn(),
    })
    await expect(
      requestMembership({ appId: APP, tenantId: TENANT, email: 'x@x' }),
    ).rejects.toMatchObject({ code: 'APPROVAL_NOT_REQUIRED', statusCode: 400 })
    expect(userRepo.createUser).not.toHaveBeenCalled()
  })

  it('rechaza si el email ya existe en (app, tenant)', async () => {
    const client = mockClient()
    pool.connect.mockResolvedValue({
      query: vi.fn().mockResolvedValue({ rows: [{ requires_user_approval: true }] }),
      release: vi.fn(),
    })
    withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(client))
    userRepo.findByEmail.mockResolvedValue({ id: 'existing', email: 'x@x' })

    await expect(
      requestMembership({ appId: APP, tenantId: TENANT, email: 'x@x' }),
    ).rejects.toMatchObject({ statusCode: 409 })   // ConflictError
  })

  it('valida appId, tenantId y email requeridos (422)', async () => {
    await expect(requestMembership({ tenantId: TENANT, email: 'x@x' })).rejects.toMatchObject({ statusCode: 422 })
    await expect(requestMembership({ appId: APP, email: 'x@x' })).rejects.toMatchObject({ statusCode: 422 })
    await expect(requestMembership({ appId: APP, tenantId: TENANT })).rejects.toMatchObject({ statusCode: 422 })
  })
})

// ── login con pending_approval ───────────────────────────────────────────

describe('login — bloqueo si pending_approval', () => {
  it('rechaza con PENDING_APPROVAL 403 si el user pendiente intenta login', async () => {
    const client = mockClient()
    pool.connect.mockResolvedValue(client)
    userRepo.findByEmail.mockResolvedValue({
      id: TARGET, app_id: APP, tenant_id: TENANT,
      email: 'p@x', password_hash: null,    // sin password todavía
      pending_approval: true, pending_activation: false,
      revoked_at: null, locked_until: null,
    })
    await expect(
      login({ appId: APP, tenantId: TENANT, email: 'p@x', password: 'whatever' }),
    ).rejects.toMatchObject({ code: 'PENDING_APPROVAL', statusCode: 403 })
  })
})

// ── approveUser ──────────────────────────────────────────────────────────

describe('approveUser', () => {
  it('aprueba: pending_approval=FALSE + crea password_reset + emite auth.signup.approved', async () => {
    const client = mockClient()
    // withStaffContext envuelve la operación. La función está en users.service.js
    // y abre client manualmente; capturamos pool.connect.
    pool.connect.mockResolvedValue(client)
    userRepo.findAnywhereById.mockResolvedValue({
      id: TARGET, app_id: APP, tenant_id: TENANT,
      email: 'p@x', display_name: 'Pendiente',
      pending_approval: true, revoked_at: null,
    })
    userRepo.approve.mockResolvedValue({
      id: TARGET, app_id: APP, tenant_id: TENANT,
      email: 'p@x', display_name: 'Pendiente', pending_approval: false,
    })

    const r = await approveUser(TARGET, ADMIN)

    expect(userRepo.approve).toHaveBeenCalledWith(client, TARGET)
    // Crea password_reset token (que el user usará como magic-link bienvenida)
    expect(resetRepo.createReset).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        userId: TARGET, appId: APP, tenantId: TENANT,
        expiresAt: expect.any(Date),
      }),
    )
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'auth.signup.approved',
        payload: expect.objectContaining({ userId: TARGET, email: 'p@x', token: expect.any(String) }),
      }),
    )
    expect(r.pending_approval).toBe(false)
  })

  it('un user del MISMO tenant pasa por el service (la role gate vive en routes/requireStaffOrAdmin)', async () => {
    // Documentamos el contrato actual: la función approveUser NO valida role.
    // El gate de role lo hace `requireStaffOrAdmin` en la capa de routes.
    // Si alguien expone approveUser fuera de los routes, se filtra. Test guard.
    pool.connect.mockResolvedValue(mockClient())
    userRepo.findAnywhereById.mockResolvedValue({
      id: TARGET, app_id: APP, tenant_id: TENANT,
      email: 'p@x', display_name: 'P', pending_approval: true,
    })
    userRepo.approve.mockResolvedValue({
      id: TARGET, app_id: APP, tenant_id: TENANT,
      email: 'p@x', display_name: 'P', pending_approval: false,
    })
    await expect(approveUser(TARGET, USER)).resolves.toBeDefined()
  })

  it('rechaza si no hay identity (sin login)', async () => {
    await expect(approveUser(TARGET, null)).rejects.toMatchObject({ statusCode: 403 })
    await expect(approveUser(TARGET, {})).rejects.toMatchObject({ statusCode: 403 })
  })

  it('rechaza si el target es de otro tenant y el caller NO es staff', async () => {
    pool.connect.mockResolvedValue(mockClient())
    userRepo.findAnywhereById.mockResolvedValue({
      id: TARGET, app_id: 'split-pay', tenant_id: 'other-tenant',
      pending_approval: true,
    })
    await expect(approveUser(TARGET, ADMIN)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('staff super_admin SÍ puede aprobar cross-tenant', async () => {
    pool.connect.mockResolvedValue(mockClient())
    userRepo.findAnywhereById.mockResolvedValue({
      id: TARGET, app_id: 'split-pay', tenant_id: 'other-tenant',
      email: 'x@x', display_name: 'X', pending_approval: true,
    })
    userRepo.approve.mockResolvedValue({
      id: TARGET, app_id: 'split-pay', tenant_id: 'other-tenant',
      email: 'x@x', display_name: 'X', pending_approval: false,
    })
    await expect(approveUser(TARGET, STAFF)).resolves.toBeDefined()
  })

  it('rechaza si el user NO está pendiente (NOT_PENDING 409)', async () => {
    pool.connect.mockResolvedValue(mockClient())
    userRepo.findAnywhereById.mockResolvedValue({
      id: TARGET, app_id: APP, tenant_id: TENANT, pending_approval: false,
    })
    await expect(approveUser(TARGET, ADMIN)).rejects.toMatchObject({
      code: 'NOT_PENDING', statusCode: 409,
    })
    expect(userRepo.approve).not.toHaveBeenCalled()
  })
})

// ── rejectUser ───────────────────────────────────────────────────────────

describe('rejectUser', () => {
  it('hard-delete + emite auth.signup.rejected con reason opcional', async () => {
    pool.connect.mockResolvedValue(mockClient())
    userRepo.findAnywhereById.mockResolvedValue({
      id: TARGET, app_id: APP, tenant_id: TENANT,
      email: 'r@x', display_name: 'Rechazado', pending_approval: true,
    })
    userRepo.hardDelete.mockResolvedValue(true)

    await rejectUser(TARGET, ADMIN, { reason: 'Datos incoherentes' })

    expect(userRepo.hardDelete).toHaveBeenCalled()
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'auth.signup.rejected',
        payload: expect.objectContaining({
          userId: TARGET, email: 'r@x', reason: 'Datos incoherentes',
        }),
      }),
    )
  })

  it('rechaza si el user NO estaba pendiente (use revoke)', async () => {
    pool.connect.mockResolvedValue(mockClient())
    userRepo.findAnywhereById.mockResolvedValue({
      id: TARGET, app_id: APP, tenant_id: TENANT, pending_approval: false,
    })
    await expect(rejectUser(TARGET, ADMIN)).rejects.toMatchObject({
      code: 'NOT_PENDING', statusCode: 409,
    })
    expect(userRepo.hardDelete).not.toHaveBeenCalled()
  })
})
