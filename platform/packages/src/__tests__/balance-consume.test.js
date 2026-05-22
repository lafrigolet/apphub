// Contrato del consumo de balance (sesiones):
//   - redeem decrementa atómicamente (repo.decrementSessions). Si la
//     UPDATE no afecta filas → ConflictError (no quedan sesiones / pkg
//     expired / etc).
//   - Cuando la sesión consumida es la última, el row pasa a
//     status='exhausted' Y se publica `package.exhausted`.
//   - El authorization gate (owner / authorized user / staff) corre
//     antes de tocar el balance (test en packages.service.test.js).
//
// Estas asserts protegen contra dos bugs:
//   * Consumir más allá de 0 (race condition con 2 redeems concurrentes).
//   * Olvidar emitir package.exhausted → notifications no enviaría email.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../lib/db.js', () => ({
  pool: { connect: vi.fn() },
  withTenantTransaction: vi.fn(),
}))
vi.mock('../lib/redis.js', () => ({ publish: vi.fn(), subscribe: vi.fn() }))
vi.mock('../repositories/packages.repository.js')

import * as service from '../services/packages.service.js'
import { withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as repo from '../repositories/packages.repository.js'

const APP_ID    = 'yoga'
const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const PKG_ID    = '22222222-2222-2222-2222-222222222222'
const USER_ID   = '44444444-4444-4444-4444-444444444444'
const BOOK_ID   = '55555555-5555-5555-5555-555555555555'

const ctx = { appId: APP_ID, tenantId: TENANT_ID, subTenantId: null, userId: USER_ID, role: 'buyer' }

function mockClient() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }
}

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(mockClient()))
  // Owner del package es USER_ID → ensureRedeemAllowed pasa.
  repo.findPurchaseById.mockResolvedValue({
    id: PKG_ID, client_user_id: USER_ID, status: 'active', remaining_sessions: 5, total_sessions: 10,
  })
})

describe('redeem — consumo del balance', () => {
  it('decrementa atómicamente vía repo.decrementSessions (NO query manual)', async () => {
    repo.decrementSessions.mockResolvedValue({
      id: PKG_ID, status: 'active', remaining_sessions: 4, client_user_id: USER_ID,
    })
    await service.redeem(ctx, { packageId: PKG_ID, bookingId: BOOK_ID })
    expect(repo.decrementSessions).toHaveBeenCalledWith(
      expect.anything(), APP_ID, TENANT_ID, PKG_ID, -1,
    )
  })

  it('registra movement con delta=-1 y reason="redeem" + bookingId', async () => {
    repo.decrementSessions.mockResolvedValue({ id: PKG_ID, status: 'active', remaining_sessions: 3 })
    await service.redeem(ctx, { packageId: PKG_ID, bookingId: BOOK_ID })
    expect(repo.insertRedemption).toHaveBeenCalledWith(
      expect.anything(), APP_ID, TENANT_ID,
      expect.objectContaining({ packageId: PKG_ID, bookingId: BOOK_ID, delta: -1, reason: 'redeem' }),
    )
  })

  it('NO redeem cuando balance es 0 — repo devuelve null → ConflictError', async () => {
    // Simula: el UPDATE atómico no afectó filas (`WHERE remaining_sessions > 0`).
    repo.decrementSessions.mockResolvedValue(null)
    await expect(service.redeem(ctx, { packageId: PKG_ID }))
      .rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('no remaining sessions') })
    expect(repo.insertRedemption).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
  })

  it('al cruzar a remaining=0, repo marca status=exhausted → publica package.exhausted', async () => {
    repo.decrementSessions.mockResolvedValue({
      id: PKG_ID, status: 'exhausted', remaining_sessions: 0, client_user_id: USER_ID,
    })
    await service.redeem(ctx, { packageId: PKG_ID })
    expect(publish).toHaveBeenCalledWith({
      type: 'package.exhausted',
      payload: {
        appId: APP_ID, tenantId: TENANT_ID,
        packageId: PKG_ID, clientUserId: USER_ID,
      },
    })
  })

  it('cuando aún quedan sesiones (status="active"), NO publica package.exhausted', async () => {
    repo.decrementSessions.mockResolvedValue({
      id: PKG_ID, status: 'active', remaining_sessions: 4,
    })
    await service.redeem(ctx, { packageId: PKG_ID })
    expect(publish).not.toHaveBeenCalled()
  })

  it('race condition: 2 redeems con balance=1 → solo uno gana, el otro 409', async () => {
    // Simulamos atomicidad de decrementSessions: 1ª gana, 2ª null.
    repo.decrementSessions
      .mockResolvedValueOnce({ id: PKG_ID, status: 'exhausted', remaining_sessions: 0, client_user_id: USER_ID })
      .mockResolvedValueOnce(null)

    const [r1, r2] = await Promise.allSettled([
      service.redeem(ctx, { packageId: PKG_ID }),
      service.redeem(ctx, { packageId: PKG_ID }),
    ])
    expect(r1.status).toBe('fulfilled')
    expect(r2.status).toBe('rejected')
    expect(r2.reason.statusCode).toBe(409)
  })
})

// ── Authorization (resumen, contrato detallado en packages.service.test.js) ──

describe('redeem — gate de autorización', () => {
  it('staff bypassea el owner check (puede redeem cualquier pkg del tenant)', async () => {
    const staffCtx = { ...ctx, userId: 'staff-1', role: 'staff' }
    repo.decrementSessions.mockResolvedValue({ id: PKG_ID, status: 'active', remaining_sessions: 4 })
    await expect(service.redeem(staffCtx, { packageId: PKG_ID })).resolves.toBeDefined()
    // findPurchaseById NI siquiera se llama para staff (bypass temprano).
    expect(repo.findPurchaseById).not.toHaveBeenCalled()
  })

  it('user NO autorizado (ni owner ni shared) → ConflictError 409', async () => {
    const other = { ...ctx, userId: 'other-user' }
    repo.findPurchaseById.mockResolvedValue({ id: PKG_ID, client_user_id: USER_ID })
    repo.isAuthorized.mockResolvedValue(false)
    await expect(service.redeem(other, { packageId: PKG_ID })).rejects.toMatchObject({ statusCode: 409 })
    expect(repo.decrementSessions).not.toHaveBeenCalled()
  })

  it('user con authorized-user share del owner → SÍ puede redeem', async () => {
    const sharedUser = { ...ctx, userId: 'family-member' }
    repo.findPurchaseById.mockResolvedValue({ id: PKG_ID, client_user_id: USER_ID })
    repo.isAuthorized.mockResolvedValue(true)
    repo.decrementSessions.mockResolvedValue({ id: PKG_ID, status: 'active', remaining_sessions: 4 })
    await expect(service.redeem(sharedUser, { packageId: PKG_ID })).resolves.toBeDefined()
  })
})
