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
vi.mock('../repositories/availability.repository.js')

import * as service from '../services/availability.service.js'
import { withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as repo from '../repositories/availability.repository.js'
import { ConflictError, NotFoundError, ValidationError } from '@apphub/platform-sdk/errors'

const APP_ID    = 'yoga-studio'
const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const SVC_ID    = '11111111-1111-1111-1111-111111111111'
const RES_ID    = '22222222-2222-2222-2222-222222222222'

const ctx = { appId: APP_ID, tenantId: TENANT_ID, subTenantId: null, userId: 'u1', role: 'buyer' }

function mockClient() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }
}

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(mockClient()))
})

describe('listSlots', () => {
  it('rejects missing from/to', async () => {
    await expect(service.listSlots(ctx, { serviceId: SVC_ID })).rejects.toThrow(ValidationError)
  })

  it('rejects from >= to', async () => {
    await expect(service.listSlots(ctx, {
      serviceId: SVC_ID, from: '2026-05-02T00:00:00Z', to: '2026-05-01T00:00:00Z',
    })).rejects.toThrow(ValidationError)
  })

  it('throws NotFoundError when service missing', async () => {
    repo.getServiceById.mockResolvedValue(null)
    await expect(service.listSlots(ctx, {
      serviceId: SVC_ID, from: '2026-05-01T00:00:00Z', to: '2026-05-02T00:00:00Z',
    })).rejects.toThrow(NotFoundError)
  })

  it('returns [] when no resources are configured', async () => {
    repo.getServiceById.mockResolvedValue({ id: SVC_ID, duration_minutes: 30, buffer_before_minutes: 0, buffer_after_minutes: 0, capacity: 1 })
    repo.getResourcesForService.mockResolvedValue([])
    const slots = await service.listSlots(ctx, {
      serviceId: SVC_ID, from: '2026-05-01T00:00:00Z', to: '2026-05-02T00:00:00Z',
    })
    expect(slots).toEqual([])
  })

  it('emits step-aligned slots inside the work window', async () => {
    // Service: 30-min duration, no buffers.
    repo.getServiceById.mockResolvedValue({ id: SVC_ID, duration_minutes: 30, buffer_before_minutes: 0, buffer_after_minutes: 0, capacity: 1 })
    repo.getResourcesForService.mockResolvedValue([{ id: RES_ID }])
    // Friday 2026-05-01 is dayOfWeek 5 in UTC.
    repo.getWorkHours.mockResolvedValue([{ day_of_week: 5, start_minute: 540, end_minute: 660 }]) // 09:00–11:00
    repo.getExceptions.mockResolvedValue([])
    repo.getBusyBookings.mockResolvedValue([])
    repo.getActiveHolds.mockResolvedValue([])

    const slots = await service.listSlots(ctx, {
      serviceId: SVC_ID, from: '2026-05-01T00:00:00Z', to: '2026-05-02T00:00:00Z',
    })

    // Slot starts every 15 min, must end within 11:00. Last slot starts at 10:30.
    expect(slots.length).toBe(7)
    expect(slots[0]).toMatchObject({ resourceId: RES_ID, startsAt: '2026-05-01T09:00:00.000Z', endsAt: '2026-05-01T09:30:00.000Z' })
    expect(slots[slots.length - 1].startsAt).toBe('2026-05-01T10:30:00.000Z')
  })

  it('skips slots that overlap an existing booking', async () => {
    repo.getServiceById.mockResolvedValue({ id: SVC_ID, duration_minutes: 30, buffer_before_minutes: 0, buffer_after_minutes: 0, capacity: 1 })
    repo.getResourcesForService.mockResolvedValue([{ id: RES_ID }])
    repo.getWorkHours.mockResolvedValue([{ day_of_week: 5, start_minute: 540, end_minute: 660 }])
    repo.getExceptions.mockResolvedValue([])
    // 09:30–10:00 is busy
    repo.getBusyBookings.mockResolvedValue([{ starts_at: '2026-05-01T09:30:00Z', ends_at: '2026-05-01T10:00:00Z' }])
    repo.getActiveHolds.mockResolvedValue([])

    const slots = await service.listSlots(ctx, {
      serviceId: SVC_ID, from: '2026-05-01T00:00:00Z', to: '2026-05-02T00:00:00Z',
    })
    // 09:00, 10:00, 10:15, 10:30 — others overlap the busy block
    const starts = slots.map((s) => s.startsAt)
    expect(starts).toContain('2026-05-01T09:00:00.000Z')
    expect(starts).not.toContain('2026-05-01T09:15:00.000Z')
    expect(starts).not.toContain('2026-05-01T09:30:00.000Z')
    expect(starts).not.toContain('2026-05-01T09:45:00.000Z')
    expect(starts).toContain('2026-05-01T10:00:00.000Z')
  })

  it('respects buffers (prepends buffer_before, postpones startsAt)', async () => {
    repo.getServiceById.mockResolvedValue({ id: SVC_ID, duration_minutes: 30, buffer_before_minutes: 15, buffer_after_minutes: 0, capacity: 1 })
    repo.getResourcesForService.mockResolvedValue([{ id: RES_ID }])
    repo.getWorkHours.mockResolvedValue([{ day_of_week: 5, start_minute: 540, end_minute: 660 }])
    repo.getExceptions.mockResolvedValue([])
    repo.getBusyBookings.mockResolvedValue([])
    repo.getActiveHolds.mockResolvedValue([])

    const slots = await service.listSlots(ctx, {
      serviceId: SVC_ID, from: '2026-05-01T00:00:00Z', to: '2026-05-02T00:00:00Z',
    })
    // First slot's *appointment* start is 09:00 + 15 min buffer = 09:15
    expect(slots[0]).toMatchObject({
      startsAt: '2026-05-01T09:15:00.000Z',
      endsAt:   '2026-05-01T09:45:00.000Z',
    })
  })
})

describe('holdSlot / releaseHold', () => {
  it('purges expired and inserts an atomic hold', async () => {
    repo.purgeExpiredHolds.mockResolvedValue()
    repo.insertHoldAtomic.mockResolvedValue({ id: 'h1', expires_at: '2026-05-01T09:05:00Z' })
    const r = await service.holdSlot(ctx, {
      serviceId: SVC_ID, resourceId: RES_ID,
      startsAt: '2026-05-01T09:00:00Z', endsAt: '2026-05-01T09:30:00Z',
    })
    expect(repo.purgeExpiredHolds).toHaveBeenCalled()
    expect(repo.insertHoldAtomic).toHaveBeenCalledWith(
      expect.anything(), APP_ID, TENANT_ID,
      expect.objectContaining({ serviceId: SVC_ID, resourceId: RES_ID, ttlSeconds: 300 }),
    )
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'availability.held' }))
    expect(r.id).toBe('h1')
  })

  it('throws ConflictError when atomic insert fails (slot taken)', async () => {
    repo.purgeExpiredHolds.mockResolvedValue()
    repo.insertHoldAtomic.mockResolvedValue(null)
    await expect(service.holdSlot(ctx, {
      serviceId: SVC_ID, resourceId: RES_ID,
      startsAt: '2026-05-01T09:00:00Z', endsAt: '2026-05-01T09:30:00Z',
    })).rejects.toThrow(ConflictError)
  })

  it('releaseHold deletes and emits event', async () => {
    repo.deleteHold.mockResolvedValue(true)
    await service.releaseHold(ctx, 'h1')
    expect(repo.deleteHold).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, 'h1')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'availability.released' }))
  })

  it('releaseHold throws NotFoundError when missing', async () => {
    repo.deleteHold.mockResolvedValue(false)
    await expect(service.releaseHold(ctx, 'h1')).rejects.toThrow(NotFoundError)
  })
})
