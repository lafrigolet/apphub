// availability.service — ramas no cubiertas por availability.service.test.js:
// filtro por resourceId, cache-hit de redis, y capacidad de grupo.
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
  redis: {
    mget: vi.fn().mockResolvedValue([]),
    incr: vi.fn().mockResolvedValue(1),
    get: vi.fn(),
    set: vi.fn(),
    setex: vi.fn(),
    del: vi.fn(),
  },
}))
vi.mock('../repositories/availability.repository.js')

import * as service from '../services/availability.service.js'
import { withTenantTransaction } from '../lib/db.js'
import { redis } from '../lib/redis.js'
import * as repo from '../repositories/availability.repository.js'

const APP = 'yoga'
const TENANT = '00000000-0000-0000-0000-000000000001'
const SVC = '11111111-1111-1111-1111-111111111111'
const RES_A = '22222222-2222-2222-2222-222222222222'
const RES_B = '33333333-3333-3333-3333-333333333333'

const ctx = { appId: APP, tenantId: TENANT, subTenantId: null, userId: 'u1', role: 'buyer' }

function mockClient() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }
}

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(mockClient()))
  redis.get.mockResolvedValue(null)
})

describe('listSlots — resourceId filter', () => {
  it('filtra a un único resource (descarta los demás)', async () => {
    repo.getServiceById.mockResolvedValue({ id: SVC, duration_minutes: 30, buffer_before_minutes: 0, buffer_after_minutes: 0, capacity: 1 })
    repo.getResourcesForService.mockResolvedValue([{ id: RES_A }, { id: RES_B }])
    repo.getWorkHours.mockResolvedValue([{ day_of_week: 5, start_minute: 540, end_minute: 600 }])
    repo.getExceptions.mockResolvedValue([])
    repo.getBusyBookings.mockResolvedValue([])
    repo.getActiveHolds.mockResolvedValue([])

    const slots = await service.listSlots(ctx, {
      serviceId: SVC, resourceId: RES_A, from: '2026-05-01T00:00:00Z', to: '2026-05-02T00:00:00Z',
    })
    // Sólo RES_A debe producir slots.
    expect(slots.every((s) => s.resourceId === RES_A)).toBe(true)
    expect(slots.length).toBeGreaterThan(0)
  })

  it('resourceId que no existe → [] (filtro vacío)', async () => {
    repo.getServiceById.mockResolvedValue({ id: SVC, duration_minutes: 30, capacity: 1 })
    repo.getResourcesForService.mockResolvedValue([{ id: RES_A }])
    const slots = await service.listSlots(ctx, {
      serviceId: SVC, resourceId: 'nonexistent', from: '2026-05-01T00:00:00Z', to: '2026-05-02T00:00:00Z',
    })
    expect(slots).toEqual([])
  })
})

describe('listSlots — cache', () => {
  it('cache-hit → devuelve el JSON cacheado sin computar', async () => {
    repo.getServiceById.mockResolvedValue({ id: SVC, duration_minutes: 30, capacity: 1 })
    repo.getResourcesForService.mockResolvedValue([{ id: RES_A }])
    redis.get.mockResolvedValue(JSON.stringify([{ resourceId: RES_A, cached: true }]))

    const slots = await service.listSlots(ctx, {
      serviceId: SVC, from: '2026-05-01T00:00:00Z', to: '2026-05-02T00:00:00Z',
    })
    expect(slots).toEqual([{ resourceId: RES_A, cached: true }])
    expect(repo.getWorkHours).not.toHaveBeenCalled()
  })

  it('redis.get lanza → fall-through a computar', async () => {
    repo.getServiceById.mockResolvedValue({ id: SVC, duration_minutes: 30, buffer_before_minutes: 0, buffer_after_minutes: 0, capacity: 1, step_minutes: 30 })
    repo.getResourcesForService.mockResolvedValue([{ id: RES_A }])
    redis.get.mockRejectedValue(new Error('redis down'))
    repo.getWorkHours.mockResolvedValue([{ day_of_week: 5, start_minute: 540, end_minute: 600 }])
    repo.getExceptions.mockResolvedValue([])
    repo.getBusyBookings.mockResolvedValue([])
    repo.getActiveHolds.mockResolvedValue([])

    const slots = await service.listSlots(ctx, {
      serviceId: SVC, from: '2026-05-01T00:00:00Z', to: '2026-05-02T00:00:00Z',
    })
    expect(repo.getWorkHours).toHaveBeenCalled()
    expect(slots.length).toBeGreaterThan(0)
  })
})

describe('listSlots — group capacity', () => {
  it('capacity>1: slot con remaining = capacity - consumidores', async () => {
    repo.getServiceById.mockResolvedValue({ id: SVC, duration_minutes: 30, buffer_before_minutes: 0, buffer_after_minutes: 0, capacity: 3, step_minutes: 30 })
    repo.getResourcesForService.mockResolvedValue([{ id: RES_A, capacity: 5 }])
    repo.getWorkHours.mockResolvedValue([{ day_of_week: 5, start_minute: 540, end_minute: 570 }])
    repo.getExceptions.mockResolvedValue([])
    repo.getBusyBookings.mockResolvedValue([
      { starts_at: '2026-05-01T09:00:00Z', ends_at: '2026-05-01T09:30:00Z' },
    ])
    repo.getActiveHolds.mockResolvedValue([])

    const slots = await service.listSlots(ctx, {
      serviceId: SVC, from: '2026-05-01T00:00:00Z', to: '2026-05-02T00:00:00Z',
    })
    expect(slots[0]).toMatchObject({ capacity: 3, remaining: 2 })
  })

  it('buffer_before null (?? 0) + cursor no alineado (rem != 0)', async () => {
    // step 30; ventana arranca a las 09:10 (rem=10) → cursor se realinea a 09:30.
    repo.getServiceById.mockResolvedValue({ id: SVC, duration_minutes: 30, buffer_before_minutes: null, buffer_after_minutes: null, capacity: 1, step_minutes: 30 })
    repo.getResourcesForService.mockResolvedValue([{ id: RES_A }])
    repo.getWorkHours.mockResolvedValue([{ day_of_week: 5, start_minute: 550, end_minute: 660 }]) // 09:10–11:00
    repo.getExceptions.mockResolvedValue([])
    repo.getBusyBookings.mockResolvedValue([])
    repo.getActiveHolds.mockResolvedValue([])

    const slots = await service.listSlots(ctx, {
      serviceId: SVC, from: '2026-05-01T00:00:00Z', to: '2026-05-02T00:00:00Z',
    })
    expect(slots[0].startsAt).toBe('2026-05-01T09:30:00.000Z')
  })

  it('redis.set lanza → no propaga, devuelve slots', async () => {
    repo.getServiceById.mockResolvedValue({ id: SVC, duration_minutes: 30, buffer_before_minutes: 0, buffer_after_minutes: 0, capacity: 1, step_minutes: 30 })
    repo.getResourcesForService.mockResolvedValue([{ id: RES_A }])
    repo.getWorkHours.mockResolvedValue([{ day_of_week: 5, start_minute: 540, end_minute: 570 }])
    repo.getExceptions.mockResolvedValue([])
    repo.getBusyBookings.mockResolvedValue([])
    repo.getActiveHolds.mockResolvedValue([])
    redis.set.mockRejectedValue(new Error('redis write down'))

    const slots = await service.listSlots(ctx, {
      serviceId: SVC, from: '2026-05-01T00:00:00Z', to: '2026-05-02T00:00:00Z',
    })
    expect(slots.length).toBeGreaterThan(0)
  })

  it('hard block por exception → slot omitido', async () => {
    repo.getServiceById.mockResolvedValue({ id: SVC, duration_minutes: 30, buffer_before_minutes: 0, buffer_after_minutes: 0, capacity: 1, step_minutes: 30 })
    repo.getResourcesForService.mockResolvedValue([{ id: RES_A }])
    repo.getWorkHours.mockResolvedValue([{ day_of_week: 5, start_minute: 540, end_minute: 570 }])
    repo.getExceptions.mockResolvedValue([
      { starts_at: '2026-05-01T09:00:00Z', ends_at: '2026-05-01T09:30:00Z' },
    ])
    repo.getBusyBookings.mockResolvedValue([])
    repo.getActiveHolds.mockResolvedValue([])

    const slots = await service.listSlots(ctx, {
      serviceId: SVC, from: '2026-05-01T00:00:00Z', to: '2026-05-02T00:00:00Z',
    })
    expect(slots).toEqual([])
  })
})
