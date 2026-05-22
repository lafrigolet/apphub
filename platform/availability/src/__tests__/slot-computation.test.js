// availability.service.listSlots — cómputo de huecos disponibles.
// Contrato:
//   - from/to obligatorios + from < to (else ValidationError).
//   - serviceId desconocido → NotFoundError.
//   - resource sin work_hours en el día → 0 slots (no error).
//   - Excepciones de recurso BLOQUEAN duro (no se generan slots).
//   - Bookings + holds DESCUENTAN capacity (no bloquean duro).
//   - capacity efectiva = min(service.capacity, resource.capacity).
//   - step_minutes default 15.
//   - totalMinutes = duration + buffer_before + buffer_after; slot startsAt =
//     cursor + buffer_before; endsAt = startsAt + duration (buffer_after queda
//     fuera del slot publicado).
//   - Cache Redis: clave incluye versión por recurso; HIT salta el compute.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))
const fakeRedis = vi.hoisted(() => ({
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue('OK'),
  mget: vi.fn().mockResolvedValue([]),
  incr: vi.fn().mockResolvedValue(1),
}))
vi.mock('../lib/redis.js', () => ({ redis: fakeRedis, publish: vi.fn() }))
vi.mock('../lib/db.js', () => ({ pool: {}, withTenantTransaction: vi.fn() }))
vi.mock('../repositories/availability.repository.js')

import { listSlots } from '../services/availability.service.js'
import { withTenantTransaction } from '../lib/db.js'
import * as repo from '../repositories/availability.repository.js'

const ctx = {
  appId: 'wellness', tenantId: 't1', subTenantId: null, userId: 'user-1',
}

// Service: 60 min, sin buffers, capacity 1, step 30.
const service60 = {
  id: 'svc-1', duration_minutes: 60, step_minutes: 30, capacity: 1,
  buffer_before_minutes: 0, buffer_after_minutes: 0,
}
// Resource: capacity 1
const resource1 = { id: 'r1', capacity: 1 }

beforeEach(() => {
  vi.clearAllMocks()
  fakeRedis.get.mockResolvedValue(null)
  fakeRedis.mget.mockResolvedValue([])
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn({}))
})

// Helper: configura el escenario base.
function setup({
  service = service60,
  resources = [resource1],
  workHours = [],
  exceptions = [],
  bookings = [],
  holds = [],
} = {}) {
  repo.getServiceById.mockResolvedValue(service)
  repo.getResourcesForService.mockResolvedValue(resources)
  repo.getWorkHours.mockResolvedValue(workHours)
  repo.getExceptions.mockResolvedValue(exceptions)
  repo.getBusyBookings.mockResolvedValue(bookings)
  repo.getActiveHolds.mockResolvedValue(holds)
}

// ── Validaciones ────────────────────────────────────────────────────

describe('validations', () => {
  it('from/to ausente → ValidationError', async () => {
    await expect(listSlots(ctx, { serviceId: 's' })).rejects.toMatchObject({ statusCode: 422 })
    await expect(listSlots(ctx, { serviceId: 's', from: 'x' })).rejects.toMatchObject({ statusCode: 422 })
  })

  it('from >= to → ValidationError', async () => {
    await expect(listSlots(ctx, {
      serviceId: 's', from: '2026-05-22T10:00:00Z', to: '2026-05-22T10:00:00Z',
    })).rejects.toMatchObject({ statusCode: 422 })
  })

  it('service inexistente → NotFoundError', async () => {
    repo.getServiceById.mockResolvedValue(null)
    await expect(listSlots(ctx, {
      serviceId: 'ghost', from: '2026-05-22T00:00:00Z', to: '2026-05-23T00:00:00Z',
    })).rejects.toMatchObject({ statusCode: 404 })
  })

  it('service sin resources → array vacío (no throw)', async () => {
    setup({ resources: [] })
    const r = await listSlots(ctx, {
      serviceId: 'svc-1', from: '2026-05-22T00:00:00Z', to: '2026-05-23T00:00:00Z',
    })
    expect(r).toEqual([])
  })
})

// ── Cómputo básico ───────────────────────────────────────────────────

describe('slot computation — caso simple', () => {
  it('work hours 10-12h, service 60min step 30min → slots 10:00, 10:30, 11:00', async () => {
    // 2026-05-22 es viernes (UTC dow=5)
    setup({
      workHours: [{
        day_of_week: 5,                                          // friday
        start_minute: 600,                                       // 10:00
        end_minute:   720,                                       // 12:00
      }],
    })
    const r = await listSlots(ctx, {
      serviceId: 'svc-1',
      from: '2026-05-22T00:00:00.000Z',
      to:   '2026-05-23T00:00:00.000Z',
    })
    expect(r.map((s) => s.startsAt)).toEqual([
      '2026-05-22T10:00:00.000Z',
      '2026-05-22T10:30:00.000Z',
      '2026-05-22T11:00:00.000Z',
    ])
    expect(r[0].endsAt).toBe('2026-05-22T11:00:00.000Z')
  })

  it('día sin work_hours configuradas → 0 slots', async () => {
    setup({ workHours: [{ day_of_week: 6, start_minute: 600, end_minute: 720 }] })  // saturday only
    const r = await listSlots(ctx, {
      serviceId: 'svc-1',
      from: '2026-05-22T00:00:00.000Z',                          // friday
      to:   '2026-05-23T00:00:00.000Z',
    })
    expect(r).toEqual([])
  })

  it('step_minutes ausente → default 15', async () => {
    const svc = { ...service60, step_minutes: null, duration_minutes: 30 }
    setup({
      service: svc,
      workHours: [{ day_of_week: 5, start_minute: 600, end_minute: 660 }],   // 10-11h
    })
    const r = await listSlots(ctx, {
      serviceId: 'svc-1',
      from: '2026-05-22T00:00:00.000Z',
      to:   '2026-05-23T00:00:00.000Z',
    })
    // 30min service, 15min step → 10:00, 10:15, 10:30 (10:45 ya no cabe → endsAt > 11h)
    expect(r.map((s) => s.startsAt)).toEqual([
      '2026-05-22T10:00:00.000Z',
      '2026-05-22T10:15:00.000Z',
      '2026-05-22T10:30:00.000Z',
    ])
  })
})

// ── Buffers ─────────────────────────────────────────────────────────

describe('buffers', () => {
  it('buffer_before 15 → startsAt del slot empieza 15min DESPUÉS del cursor', async () => {
    const svc = { ...service60, buffer_before_minutes: 15, duration_minutes: 30, step_minutes: 60 }
    setup({
      service: svc,
      workHours: [{ day_of_week: 5, start_minute: 600, end_minute: 720 }],   // 10-12h
    })
    const r = await listSlots(ctx, {
      serviceId: 'svc-1',
      from: '2026-05-22T00:00:00.000Z',
      to:   '2026-05-23T00:00:00.000Z',
    })
    // Cursor 10:00 + buffer_before 15 → startsAt 10:15, endsAt 10:45
    // Cursor 11:00 + 15 = 11:15 → 11:45. Cursor 12:00 ya no cabe (45 después > 12:00 work end)
    expect(r.map((s) => `${s.startsAt}|${s.endsAt}`)).toEqual([
      '2026-05-22T10:15:00.000Z|2026-05-22T10:45:00.000Z',
      '2026-05-22T11:15:00.000Z|2026-05-22T11:45:00.000Z',
    ])
  })

  it('buffer_after 30 → reduce los slots disponibles (cabe menos en la ventana)', async () => {
    const svc = { ...service60, buffer_after_minutes: 30, duration_minutes: 30, step_minutes: 30 }
    setup({
      service: svc,
      workHours: [{ day_of_week: 5, start_minute: 600, end_minute: 720 }],   // 10-12h (120 min)
    })
    const r = await listSlots(ctx, {
      serviceId: 'svc-1',
      from: '2026-05-22T00:00:00.000Z',
      to:   '2026-05-23T00:00:00.000Z',
    })
    // totalMinutes = 30 + 0 + 30 = 60 → cabe a 10:00, 10:30, 11:00 (último termina 12:00)
    expect(r.map((s) => s.startsAt)).toEqual([
      '2026-05-22T10:00:00.000Z',
      '2026-05-22T10:30:00.000Z',
      '2026-05-22T11:00:00.000Z',
    ])
  })
})

// ── Exceptions (hard blocks) ────────────────────────────────────────

describe('exceptions', () => {
  it('exception del recurso 10:30-11:00 → bloquea slots solapantes (10:00 y 10:30)', async () => {
    setup({
      workHours: [{ day_of_week: 5, start_minute: 600, end_minute: 720 }],
      exceptions: [{
        starts_at: '2026-05-22T10:30:00Z',
        ends_at:   '2026-05-22T11:00:00Z',
      }],
    })
    const r = await listSlots(ctx, {
      serviceId: 'svc-1', from: '2026-05-22T00:00:00.000Z', to: '2026-05-23T00:00:00.000Z',
    })
    // 10:00 (10-11) overlaps 10:30-11; 10:30 (10:30-11:30) overlaps; 11:00 (11-12) no overlap → solo 11:00
    expect(r.map((s) => s.startsAt)).toEqual(['2026-05-22T11:00:00.000Z'])
  })
})

// ── Bookings + holds descuentan capacidad ───────────────────────────

describe('capacity (bookings + holds)', () => {
  it('booking solapante + capacity=1 → 0 remaining → no aparece', async () => {
    setup({
      workHours: [{ day_of_week: 5, start_minute: 600, end_minute: 720 }],
      bookings: [{ starts_at: '2026-05-22T10:00:00Z', ends_at: '2026-05-22T11:00:00Z' }],
    })
    const r = await listSlots(ctx, {
      serviceId: 'svc-1', from: '2026-05-22T00:00:00.000Z', to: '2026-05-23T00:00:00.000Z',
    })
    expect(r.map((s) => s.startsAt)).toEqual(['2026-05-22T11:00:00.000Z'])
  })

  it('capacity=3 + 2 bookings + 1 hold solapantes → remaining 0 → slot oculto', async () => {
    setup({
      service: { ...service60, capacity: 3 },
      resources: [{ id: 'r1', capacity: 3 }],
      workHours: [{ day_of_week: 5, start_minute: 600, end_minute: 720 }],
      bookings: [
        { starts_at: '2026-05-22T10:00:00Z', ends_at: '2026-05-22T11:00:00Z' },
        { starts_at: '2026-05-22T10:00:00Z', ends_at: '2026-05-22T11:00:00Z' },
      ],
      holds: [{ starts_at: '2026-05-22T10:00:00Z', ends_at: '2026-05-22T11:00:00Z' }],
    })
    const r = await listSlots(ctx, {
      serviceId: 'svc-1', from: '2026-05-22T00:00:00.000Z', to: '2026-05-23T00:00:00.000Z',
    })
    // 10:00 (10-11): 3 consumers → remaining=0 → skip
    // 10:30 (10:30-11:30): solapan los 3 (terminan 11h, cursor 10:30 < 11h) → remaining=0
    // 11:00 (11-12): no solapan → remaining=3
    expect(r.map((s) => `${s.startsAt}|r=${s.remaining}`)).toEqual([
      '2026-05-22T11:00:00.000Z|r=3',
    ])
  })

  it('capacity efectiva = min(service.capacity, resource.capacity)', async () => {
    setup({
      service: { ...service60, capacity: 10 },
      resources: [{ id: 'r1', capacity: 3 }],
      workHours: [{ day_of_week: 5, start_minute: 600, end_minute: 660 }],
    })
    const r = await listSlots(ctx, {
      serviceId: 'svc-1', from: '2026-05-22T00:00:00.000Z', to: '2026-05-23T00:00:00.000Z',
    })
    expect(r[0].capacity).toBe(3)   // min(10, 3)
  })
})

// ── Cache ───────────────────────────────────────────────────────────

describe('Redis cache', () => {
  it('cache HIT → retorna del cache, no llama al repo', async () => {
    fakeRedis.get.mockResolvedValue(JSON.stringify([{ startsAt: 'cached' }]))
    repo.getServiceById.mockResolvedValue(service60)
    repo.getResourcesForService.mockResolvedValue([resource1])

    const r = await listSlots(ctx, {
      serviceId: 'svc-1', from: '2026-05-22T00:00:00.000Z', to: '2026-05-23T00:00:00.000Z',
    })
    expect(r).toEqual([{ startsAt: 'cached' }])
    expect(repo.getWorkHours).not.toHaveBeenCalled()
  })

  it('cache MISS → computa + SET con TTL 60s', async () => {
    fakeRedis.get.mockResolvedValue(null)
    setup({ workHours: [] })
    await listSlots(ctx, {
      serviceId: 'svc-1', from: '2026-05-22T00:00:00.000Z', to: '2026-05-23T00:00:00.000Z',
    })
    expect(fakeRedis.set).toHaveBeenCalledWith(
      expect.stringMatching(/^availability:slots:/),
      expect.any(String),
      'EX', 60,
    )
  })

  it('cache GET error → fall-through al compute (no propaga)', async () => {
    fakeRedis.get.mockRejectedValueOnce(new Error('redis down'))
    setup({ workHours: [{ day_of_week: 5, start_minute: 600, end_minute: 660 }] })
    await expect(listSlots(ctx, {
      serviceId: 'svc-1', from: '2026-05-22T00:00:00.000Z', to: '2026-05-23T00:00:00.000Z',
    })).resolves.toBeDefined()
  })
})
