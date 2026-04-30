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
}))
vi.mock('../repositories/reservations.repository.js')

import * as service from '../services/reservations.service.js'
import { withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as repo from '../repositories/reservations.repository.js'
import { ConflictError, NotFoundError } from '@apphub/platform-sdk/errors'

const APP_ID    = 'yoga-studio'
const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const RES_ID    = '11111111-1111-1111-1111-111111111111'
const TABLE_ID  = '22222222-2222-2222-2222-222222222222'

const ctx = { appId: APP_ID, tenantId: TENANT_ID, subTenantId: null, userId: 'u1', role: 'host' }

function mockClient() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }
}

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(mockClient()))
})

// ── createReservation ─────────────────────────────────────────────────────
describe('createReservation', () => {
  it('persists, scopes to tenant, and emits reservation.created', async () => {
    repo.insertReservation.mockResolvedValue({
      id: RES_ID, status: 'requested', guest_email: 'g@a.com', guest_name: 'Guest',
      party_size: 4, reserved_for: '2026-05-01T20:00:00Z',
    })
    await service.createReservation(ctx, {
      guestName: 'Guest', guestEmail: 'g@a.com', partySize: 4, reservedFor: '2026-05-01T20:00:00Z',
    })
    expect(repo.insertReservation).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      appId: APP_ID, tenantId: TENANT_ID, guestName: 'Guest', partySize: 4,
    }))
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'reservation.created',
      payload: expect.objectContaining({ reservationId: RES_ID, guestEmail: 'g@a.com' }),
    }))
  })
})

describe('getReservation', () => {
  it('throws NotFoundError when missing', async () => {
    repo.findReservationById.mockResolvedValue(null)
    await expect(service.getReservation(ctx, RES_ID)).rejects.toThrow(NotFoundError)
  })

  it('returns reservation when present', async () => {
    repo.findReservationById.mockResolvedValue({ id: RES_ID, status: 'confirmed' })
    const r = await service.getReservation(ctx, RES_ID)
    expect(r.id).toBe(RES_ID)
  })
})

// ── changeStatus FSM ─────────────────────────────────────────────────────
describe('changeStatus FSM', () => {
  it('requested → confirmed publishes reservation.confirmed', async () => {
    repo.findReservationById.mockResolvedValue({ id: RES_ID, status: 'requested' })
    repo.updateReservationStatus.mockResolvedValue({
      id: RES_ID, status: 'confirmed', guest_email: 'g@a.com', guest_name: 'G',
      party_size: 2, reserved_for: '2026-05-01T20:00:00Z', table_id: null,
    })
    await service.changeStatus(ctx, RES_ID, 'confirmed')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'reservation.confirmed' }))
  })

  it('confirmed → seated stores tableId and publishes reservation.seated', async () => {
    repo.findReservationById.mockResolvedValue({ id: RES_ID, status: 'confirmed' })
    repo.updateReservationStatus.mockResolvedValue({
      id: RES_ID, status: 'seated', table_id: TABLE_ID,
      guest_email: 'g@a.com', guest_name: 'G', party_size: 2, reserved_for: 't',
    })
    await service.changeStatus(ctx, RES_ID, 'seated', TABLE_ID)
    expect(repo.updateReservationStatus).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, RES_ID, 'seated', TABLE_ID)
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'reservation.seated',
      payload: expect.objectContaining({ tableId: TABLE_ID }),
    }))
  })

  it('rejects invalid transition (requested → seated)', async () => {
    repo.findReservationById.mockResolvedValue({ id: RES_ID, status: 'requested' })
    await expect(service.changeStatus(ctx, RES_ID, 'seated')).rejects.toThrow(ConflictError)
  })

  it('rejects transition from terminal state cancelled', async () => {
    repo.findReservationById.mockResolvedValue({ id: RES_ID, status: 'cancelled' })
    await expect(service.changeStatus(ctx, RES_ID, 'confirmed')).rejects.toThrow(ConflictError)
  })

  it('throws NotFoundError when reservation missing', async () => {
    repo.findReservationById.mockResolvedValue(null)
    await expect(service.changeStatus(ctx, RES_ID, 'confirmed')).rejects.toThrow(NotFoundError)
  })
})

// ── waitlist ─────────────────────────────────────────────────────────────
describe('waitlist', () => {
  it('addToWaitlist persists and emits waitlist.added', async () => {
    repo.insertWaitlistEntry.mockResolvedValue({ id: 'w1', party_size: 3 })
    await service.addToWaitlist(ctx, { guestName: 'X', partySize: 3 })
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'waitlist.added',
      payload: expect.objectContaining({ waitlistId: 'w1', partySize: 3 }),
    }))
  })

  it('listWaitlist passes status filter through', async () => {
    repo.listWaitlist.mockResolvedValue([])
    await service.listWaitlist(ctx, { status: 'waiting' })
    expect(repo.listWaitlist).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, { status: 'waiting' })
  })

  it('notifyWaitlist marks notified and emits waitlist.notified', async () => {
    repo.updateWaitlistStatus.mockResolvedValue({ id: 'w1', guest_phone: '+34', guest_name: 'X' })
    await service.notifyWaitlist(ctx, 'w1')
    expect(repo.updateWaitlistStatus).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, 'w1', 'notified')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'waitlist.notified' }))
  })

  it('notifyWaitlist throws NotFoundError when entry missing', async () => {
    repo.updateWaitlistStatus.mockResolvedValue(null)
    await expect(service.notifyWaitlist(ctx, 'w1')).rejects.toThrow(NotFoundError)
  })
})

// ── service hours ────────────────────────────────────────────────────────
describe('service hours', () => {
  it('createServiceHours injects tenant scope', async () => {
    repo.insertServiceHours.mockResolvedValue({ id: 's1' })
    await service.createServiceHours(ctx, { dayOfWeek: 1, openMinute: 480, closeMinute: 1320 })
    expect(repo.insertServiceHours).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      appId: APP_ID, tenantId: TENANT_ID, dayOfWeek: 1, openMinute: 480, closeMinute: 1320,
    }))
  })

  it('listServiceHours delegates to repository', async () => {
    repo.listServiceHours.mockResolvedValue([])
    await service.listServiceHours(ctx)
    expect(repo.listServiceHours).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID)
  })
})
