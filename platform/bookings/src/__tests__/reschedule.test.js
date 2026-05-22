// Reschedule de bookings:
//   1) Valida endsAt > startsAt.
//   2) Marca el row original como rescheduled (libera el hold del slot).
//   3) Clona el booking a nueva fila status=confirmed.
//   4) Copia los resources del original a la fila clonada.
//   5) Registra 2 events (uno en el original from→rescheduled, otro en
//      el clon null→confirmed con reason "rescheduled from <id>").
//   6) Publica `booking.rescheduled` con oldBookingId + newBookingId.

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
vi.mock('../lib/redis.js', () => ({ publish: vi.fn() }))
vi.mock('../repositories/bookings.repository.js')

import { reschedule } from '../services/bookings.service.js'
import { withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as repo from '../repositories/bookings.repository.js'

const ctx = { appId: 'yoga', tenantId: '00000000-0000-0000-0000-000000000001', subTenantId: null, userId: 'admin-1', role: 'admin' }
const OLD = 'b-old'
const NEW = 'b-new'

function mockClient() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }
}

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(mockClient()))
  repo.setStatus.mockResolvedValue({ id: OLD, status: 'rescheduled' })
  repo.insertBooking.mockResolvedValue({ id: NEW, status: 'confirmed' })
  repo.listResources.mockResolvedValue(['res-1', 'res-2'])
  // loadFull al final lee el clon completo.
  repo.findById.mockImplementation(async (_c, _a, _t, id) => {
    if (id === OLD) return {
      id: OLD, status: 'confirmed', service_id: 'svc-1',
      client_user_id: 'cli-1', client_name: 'Ana', client_email: 'ana@x', client_phone: null,
      notes: 'Trae estera', internal_notes: null,
      recurrence_id: null, package_id: null, price_cents: 1000, currency: 'EUR', source: 'portal',
      metadata: {}, sub_tenant_id: null,
    }
    if (id === NEW) return { id: NEW, status: 'confirmed' }
    return null
  })
  repo.listEvents.mockResolvedValue([])
})

describe('reschedule — validación', () => {
  it('rechaza endsAt <= startsAt', async () => {
    await expect(reschedule(ctx, OLD, {
      startsAt: '2026-06-01T10:00:00Z', endsAt: '2026-06-01T10:00:00Z',
    })).rejects.toMatchObject({ statusCode: 422 })
  })

  it('rechaza endsAt anterior a startsAt', async () => {
    await expect(reschedule(ctx, OLD, {
      startsAt: '2026-06-01T11:00:00Z', endsAt: '2026-06-01T10:00:00Z',
    })).rejects.toMatchObject({ statusCode: 422 })
  })

  it('booking no existe → 404', async () => {
    repo.findById.mockResolvedValueOnce(null)
    await expect(reschedule(ctx, 'ghost', {
      startsAt: '2026-06-01T10:00:00Z', endsAt: '2026-06-01T11:00:00Z',
    })).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('reschedule — estados no permitidos', () => {
  it.each(['cancelled', 'no_show', 'completed', 'rescheduled'])(
    'status=%s no permite reschedule (409)',
    async (status) => {
      repo.findById.mockResolvedValueOnce({ id: OLD, status })
      await expect(reschedule(ctx, OLD, {
        startsAt: '2026-06-01T10:00:00Z', endsAt: '2026-06-01T11:00:00Z',
      })).rejects.toMatchObject({ statusCode: 409 })
      expect(repo.setStatus).not.toHaveBeenCalled()
      expect(repo.insertBooking).not.toHaveBeenCalled()
    },
  )
})

describe('reschedule — happy path', () => {
  const slots = { startsAt: '2026-06-01T10:00:00Z', endsAt: '2026-06-01T11:00:00Z' }

  it('marca el original como rescheduled (libera el hold de su slot)', async () => {
    await reschedule(ctx, OLD, slots)
    expect(repo.setStatus).toHaveBeenCalledWith(
      expect.anything(), ctx.appId, ctx.tenantId, OLD,
      'rescheduled', { startsAt: slots.startsAt, endsAt: slots.endsAt },
    )
  })

  it('clona el booking — nueva fila status=confirmed con parentBookingId=OLD', async () => {
    await reschedule(ctx, OLD, slots)
    expect(repo.insertBooking).toHaveBeenCalledWith(
      expect.anything(), ctx.appId, ctx.tenantId,
      expect.objectContaining({
        status: 'confirmed', parentBookingId: OLD,
        startsAt: slots.startsAt, endsAt: slots.endsAt,
        serviceId: 'svc-1', clientUserId: 'cli-1', clientEmail: 'ana@x',
      }),
    )
  })

  it('copia los resources del original al clon (attachResource × N)', async () => {
    await reschedule(ctx, OLD, slots)
    expect(repo.attachResource).toHaveBeenCalledTimes(2)
    expect(repo.attachResource).toHaveBeenCalledWith(
      expect.anything(), ctx.appId, ctx.tenantId, NEW, 'res-1',
    )
    expect(repo.attachResource).toHaveBeenCalledWith(
      expect.anything(), ctx.appId, ctx.tenantId, NEW, 'res-2',
    )
  })

  it('registra 2 events: original confirmed→rescheduled + clon null→confirmed', async () => {
    await reschedule(ctx, OLD, { ...slots, reason: 'cliente lo pidió' })
    expect(repo.recordEvent).toHaveBeenCalledWith(
      expect.anything(), ctx.appId, ctx.tenantId, OLD,
      'confirmed', 'rescheduled', ctx.userId, 'cliente lo pidió',
    )
    expect(repo.recordEvent).toHaveBeenCalledWith(
      expect.anything(), ctx.appId, ctx.tenantId, NEW,
      null, 'confirmed', ctx.userId, expect.stringContaining('rescheduled from'),
    )
  })

  it('publica booking.rescheduled con old + new id + slots', async () => {
    await reschedule(ctx, OLD, slots)
    expect(publish).toHaveBeenCalledWith({
      type: 'booking.rescheduled',
      payload: {
        appId: ctx.appId, tenantId: ctx.tenantId,
        oldBookingId: OLD, newBookingId: NEW,
        startsAt: slots.startsAt, endsAt: slots.endsAt,
      },
    })
  })

  it('si no se pasa reason, usa el default "rescheduled"', async () => {
    await reschedule(ctx, OLD, slots)
    const eventCalls = repo.recordEvent.mock.calls.filter((c) => c[3] === OLD)
    expect(eventCalls[0][7]).toBe('rescheduled')
  })
})
