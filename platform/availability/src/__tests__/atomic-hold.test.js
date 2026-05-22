// Atomic hold de slots — contrato: una sola transaction puede
// reservar un slot en presencia de N hold/booking concurrentes para el
// mismo recurso. La atomicidad la garantiza el INSERT...SELECT WHERE
// NOT EXISTS (overlapping_holds/bookings) en repo.insertHoldAtomic.
//
// El service `holdSlot` orquesta:
//   1. purgeExpiredHolds (limpia holds vencidos antes de competir).
//   2. insertHoldAtomic (atómico — devuelve null si choca).
//   3. Si null → ConflictError ("slot is no longer available").
//   4. Si OK → bumpResourceVersion (invalida cache de slots) + publish
//      'availability.held'.

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
vi.mock('../lib/redis.js', () => ({
  publish: vi.fn(),
  redis: { mget: vi.fn().mockResolvedValue([]), incr: vi.fn().mockResolvedValue(1), get: vi.fn(), set: vi.fn() },
}))
vi.mock('../repositories/availability.repository.js')

import { holdSlot, releaseHold } from '../services/availability.service.js'
import { withTenantTransaction } from '../lib/db.js'
import { publish, redis } from '../lib/redis.js'
import * as repo from '../repositories/availability.repository.js'

const ctx = { appId: 'yoga', tenantId: '00000000-0000-0000-0000-000000000001', subTenantId: null, userId: 'u1' }

function mockClient() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }
}

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(mockClient()))
  repo.purgeExpiredHolds.mockResolvedValue(undefined)
})

const slot = {
  serviceId: 'svc-1',
  resourceId: 'res-1',
  startsAt: '2026-06-01T09:00:00Z',
  endsAt:   '2026-06-01T10:00:00Z',
}

// ── happy path ───────────────────────────────────────────────────────

describe('holdSlot — atomic insertion', () => {
  it('purga holds vencidos ANTES de intentar el insert (race-window mitigation)', async () => {
    repo.insertHoldAtomic.mockResolvedValue({ id: 'hold-1', resource_id: 'res-1' })
    await holdSlot(ctx, slot)

    // El purge debe ocurrir antes que el insert.
    const purgeOrder  = repo.purgeExpiredHolds.mock.invocationCallOrder[0]
    const insertOrder = repo.insertHoldAtomic.mock.invocationCallOrder[0]
    expect(purgeOrder).toBeLessThan(insertOrder)
  })

  it('insert atómico recibe los parámetros del slot + clientUserId del ctx', async () => {
    repo.insertHoldAtomic.mockResolvedValue({ id: 'hold-1', resource_id: 'res-1' })
    await holdSlot(ctx, slot)

    expect(repo.insertHoldAtomic).toHaveBeenCalledWith(
      expect.anything(),                 // client (txn)
      'yoga',
      '00000000-0000-0000-0000-000000000001',
      expect.objectContaining({
        serviceId: 'svc-1', resourceId: 'res-1',
        startsAt: slot.startsAt, endsAt: slot.endsAt,
        clientUserId: 'u1',
        ttlSeconds: 300,                  // default
      }),
    )
  })

  it('ttlSeconds personalizable', async () => {
    repo.insertHoldAtomic.mockResolvedValue({ id: 'hold-1', resource_id: 'res-1' })
    await holdSlot(ctx, { ...slot, ttlSeconds: 600 })
    expect(repo.insertHoldAtomic).toHaveBeenCalledWith(
      expect.anything(), expect.any(String), expect.any(String),
      expect.objectContaining({ ttlSeconds: 600 }),
    )
  })

  it('al tener éxito: bumpa resource version (invalida cache de slots) y publica availability.held', async () => {
    repo.insertHoldAtomic.mockResolvedValue({ id: 'hold-X', resource_id: 'res-1' })
    await holdSlot(ctx, slot)
    expect(redis.incr).toHaveBeenCalledWith(
      expect.stringContaining('availability:rv:yoga:'),
    )
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'availability.held' }),
    )
  })
})

// ── race condition (lo importante) ───────────────────────────────────

describe('holdSlot — race condition guard', () => {
  it('si repo.insertHoldAtomic devuelve null (overlapping_holds/bookings) → ConflictError', async () => {
    repo.insertHoldAtomic.mockResolvedValue(null)
    await expect(holdSlot(ctx, slot)).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining('no longer available'),
    })
    // En el path de error, NO se debe bumpear version (cache sigue válida)
    // ni publicar held (no ocurrió el hold).
    expect(redis.incr).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
  })

  it('2 holdSlots concurrentes contra el MISMO slot — solo uno gana (atomicidad SQL)', async () => {
    // Simulamos atomicidad del SQL `INSERT ... WHERE NOT EXISTS`: la 1ª
    // llamada gana, la 2ª recibe null (overlapping_holds en t2 ve la
    // fila insertada por t1).
    repo.insertHoldAtomic
      .mockResolvedValueOnce({ id: 'hold-winner', resource_id: 'res-1' })
      .mockResolvedValueOnce(null)

    const [r1, r2] = await Promise.allSettled([
      holdSlot(ctx, slot),
      holdSlot(ctx, slot),
    ])

    expect(r1.status).toBe('fulfilled')
    expect(r2.status).toBe('rejected')
    expect(r2.reason.statusCode).toBe(409)
    // Una sola publicación de held; el segundo ni siquiera incrementó la version.
    expect(publish).toHaveBeenCalledTimes(1)
  })

  it('holds expirados se purgan ANTES de la competición → el slot vuelve a estar disponible', async () => {
    // 1) purge → 2) insert success
    repo.insertHoldAtomic.mockResolvedValue({ id: 'hold-1', resource_id: 'res-1' })
    await holdSlot(ctx, slot)
    expect(repo.purgeExpiredHolds).toHaveBeenCalledTimes(1)
  })
})

// ── releaseHold ──────────────────────────────────────────────────────

describe('releaseHold', () => {
  it('borra el hold, invalida cache (bumpea version) y publica availability.released', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [{ resource_id: 'res-1' }] }), release: vi.fn() }
    withTenantTransaction.mockImplementationOnce(async (_p, _a, _t, _s, fn) => fn(client))
    repo.deleteHold.mockResolvedValue(true)

    await releaseHold(ctx, 'hold-1')

    expect(repo.deleteHold).toHaveBeenCalledWith(expect.anything(), 'yoga', expect.any(String), 'hold-1')
    expect(redis.incr).toHaveBeenCalled()
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'availability.released' }))
  })

  it('hold inexistente (resource_id no encontrado en SELECT) → NotFoundError 404', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }
    withTenantTransaction.mockImplementationOnce(async (_p, _a, _t, _s, fn) => fn(client))
    repo.deleteHold.mockResolvedValue(true)

    await expect(releaseHold(ctx, 'ghost')).rejects.toMatchObject({ statusCode: 404 })
    expect(redis.incr).not.toHaveBeenCalled()
  })
})
