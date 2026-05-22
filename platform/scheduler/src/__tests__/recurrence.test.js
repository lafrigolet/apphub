// booking-recurrence-expander.job — materializa bookings recurrentes.
// Contrato:
//   - meta.cron = "0 * * * *" (hourly).
//   - Lee platform_bookings.recurrences; para cada una expande rrule.
//   - Soporta freq 'weekly' (con byday + interval) y 'daily' (con interval).
//   - HORIZON_DAYS = 30 (materializa próximos 30 días desde HOY UTC).
//   - rrule.count limita el total de instancias generadas.
//   - rrule.endsOn cap absoluto (no materializa después).
//   - Dedup: si ya hay row (recurrence_id, starts_at) → skip (re-run idempotente).
//   - Necesita "seed booking" (booking #1 con recurrence_id set) para clonar
//     service_id, cliente, etc. Sin seed → skip toda la recurrencia.
//   - INSERT bookings + booking_resources + booking_events (audit). status='confirmed', source='recurrence'.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as job from '../jobs/booking-recurrence-expander.job.js'

const mkLogger = () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() })

const SEED = {
  service_id: 'svc-1', client_user_id: 'u1', client_name: 'Ana',
  client_email: 'a@b.com', client_phone: '+34',
  notes: null, metadata: {}, source: 'portal',
}

function makeDb(recurrences, existingByKey = new Set()) {
  const calls = []
  const db = {
    query: vi.fn(async (sql, params) => {
      calls.push({ sql, params })
      if (sql.includes('FROM platform_bookings.recurrences')) {
        return { rows: recurrences }
      }
      if (sql.includes('FROM platform_bookings.bookings') && sql.includes('LIMIT 1') &&
          sql.includes('client_user_id')) {
        // Seed lookup
        return { rows: [SEED] }
      }
      if (sql.includes('FROM platform_bookings.bookings') && sql.includes('starts_at=$4')) {
        // existing check
        const key = `${params[2]}|${params[3]}`
        return { rows: existingByKey.has(key) ? [{ id: 'dup' }] : [] }
      }
      return { rows: [] }   // INSERTs
    }),
    calls,
  }
  return db
}

// Fix time so HORIZON computations son deterministas: jueves 2026-05-21 UTC.
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-05-21T00:00:00Z'))
  vi.clearAllMocks()
})
afterEach(() => vi.useRealTimers())

// ── meta ────────────────────────────────────────────────────────────

describe('meta', () => {
  it('cron = "0 * * * *" (hourly)', () => {
    expect(job.meta.cron).toBe('0 * * * *')
  })
})

// ── freq = weekly + byday ───────────────────────────────────────────

describe('weekly recurrence', () => {
  it('byday=[MO,WE] interval=1 → genera ~9 instancias en 30d (4-5 lunes + 4-5 miércoles)', async () => {
    const db = makeDb([{
      id: 'rec-1', app_id: 'a', tenant_id: 't',
      rrule: { freq: 'weekly', interval: 1, byday: ['MO', 'WE'], time: '18:00', duration_minutes: 60 },
      starts_on: '2026-01-01', ends_on: null, count: null,
    }])
    const r = await job.run({ db, logger: mkLogger() })
    // 2026-05-21 (THU) → horizon = 2026-06-20. Lunes/miércoles en ese rango.
    // Lunes: 25 may, 1 jun, 8, 15. Miércoles: 27 may, 3, 10, 17 jun. → 8 instances
    expect(r.rowsAffected).toBe(8)
  })

  it('interval=2 → cada 2 semanas (descarta semanas pares respecto a starts_on)', async () => {
    const db = makeDb([{
      id: 'rec-1', app_id: 'a', tenant_id: 't',
      rrule: { freq: 'weekly', interval: 2, byday: ['MO'], time: '18:00', duration_minutes: 60 },
      starts_on: '2026-05-04', ends_on: null, count: null,
    }])
    const r = await job.run({ db, logger: mkLogger() })
    // starts 2026-05-04 (MO). Cada 2 sem desde ahí: 4 may, 18 may, 1 jun, 15 jun.
    // Solo cuentan las que están en [today=2026-05-21, horizon=2026-06-20]:
    // 25 may (semana 3) → impar % 2 != 0 → skip. 1 jun (sem 4) → 0 % 2 = 0 → SI. 15 jun (sem 6) → SI.
    expect(r.rowsAffected).toBe(2)
  })

  it('count limita el total emitido', async () => {
    const db = makeDb([{
      id: 'rec-1', app_id: 'a', tenant_id: 't',
      rrule: { freq: 'weekly', interval: 1, byday: ['MO', 'TU', 'WE', 'TH', 'FR'], time: '09:00', duration_minutes: 60 },
      starts_on: '2026-01-01', ends_on: null, count: 3,
    }])
    const r = await job.run({ db, logger: mkLogger() })
    expect(r.rowsAffected).toBe(3)
  })

  it('ends_on cap → no materializa después', async () => {
    const db = makeDb([{
      id: 'rec-1', app_id: 'a', tenant_id: 't',
      rrule: { freq: 'weekly', interval: 1, byday: ['MO'], time: '09:00', duration_minutes: 60 },
      starts_on: '2026-01-01', ends_on: '2026-05-25', count: null,
    }])
    const r = await job.run({ db, logger: mkLogger() })
    // Solo MO en [2026-05-21, 2026-05-25] → 2026-05-25 → 1 instance
    expect(r.rowsAffected).toBe(1)
  })

  it('byday ausente o vacío → 0 instancias (regla degenerada)', async () => {
    const db = makeDb([{
      id: 'rec-1', app_id: 'a', tenant_id: 't',
      rrule: { freq: 'weekly', interval: 1, byday: [], time: '09:00', duration_minutes: 60 },
      starts_on: '2026-01-01', ends_on: null, count: null,
    }])
    const r = await job.run({ db, logger: mkLogger() })
    expect(r.rowsAffected).toBe(0)
  })
})

// ── freq = daily ────────────────────────────────────────────────────

describe('daily recurrence', () => {
  it('daily interval=1 → 30 instancias en 30 días', async () => {
    const db = makeDb([{
      id: 'rec-1', app_id: 'a', tenant_id: 't',
      rrule: { freq: 'daily', interval: 1, time: '08:00', duration_minutes: 30 },
      starts_on: '2026-01-01', ends_on: null, count: null,
    }])
    const r = await job.run({ db, logger: mkLogger() })
    // today=2026-05-21, horizon=2026-06-20 inclusive → 31 días (5/21 .. 6/20)
    expect(r.rowsAffected).toBe(31)
  })

  it('daily interval=7 → 5 instancias (cada 7 días en 31 días)', async () => {
    const db = makeDb([{
      id: 'rec-1', app_id: 'a', tenant_id: 't',
      rrule: { freq: 'daily', interval: 7, time: '08:00', duration_minutes: 30 },
      starts_on: '2026-01-01', ends_on: null, count: null,
    }])
    const r = await job.run({ db, logger: mkLogger() })
    // From 5/21: 5/21, 5/28, 6/4, 6/11, 6/18 → 5
    expect(r.rowsAffected).toBe(5)
  })

  it('freq desconocido → 0 instancias (no crash)', async () => {
    const db = makeDb([{
      id: 'rec-1', app_id: 'a', tenant_id: 't',
      rrule: { freq: 'monthly', interval: 1, time: '08:00' },
      starts_on: '2026-01-01', ends_on: null, count: null,
    }])
    const r = await job.run({ db, logger: mkLogger() })
    expect(r.rowsAffected).toBe(0)
  })
})

// ── Idempotencia (dedup) ────────────────────────────────────────────

describe('idempotent re-runs', () => {
  it('row existente (recurrence_id, starts_at) → skip (no duplica)', async () => {
    // Marcamos como duplicada la 1ª instancia
    const existing = new Set()
    const db = makeDb(
      [{
        id: 'rec-1', app_id: 'a', tenant_id: 't',
        rrule: { freq: 'weekly', interval: 1, byday: ['MO'], time: '09:00', duration_minutes: 60 },
        starts_on: '2026-01-01', ends_on: null, count: 2,
      }],
      existing,
    )
    // Pre-populate existing with first generated slot
    // To compute it: first MO at/after 2026-05-21 = 2026-05-25T09:00:00.000Z
    existing.add('rec-1|2026-05-25T09:00:00.000Z')
    const r = await job.run({ db, logger: mkLogger() })
    expect(r.rowsAffected).toBe(1)   // Solo la 2ª (junio 1)
  })
})

// ── Seed required ──────────────────────────────────────────────────

describe('seed booking requirement', () => {
  it('sin seed booking (no row con recurrence_id) → skip toda la recurrence', async () => {
    const calls = []
    const db = {
      query: vi.fn(async (sql, params) => {
        calls.push({ sql, params })
        if (sql.includes('FROM platform_bookings.recurrences')) {
          return {
            rows: [{
              id: 'rec-1', app_id: 'a', tenant_id: 't',
              rrule: { freq: 'daily', interval: 1, time: '08:00' },
              starts_on: '2026-01-01', ends_on: null, count: null,
            }],
          }
        }
        if (sql.includes('client_user_id')) return { rows: [] }   // sin seed
        return { rows: [] }
      }),
    }
    const r = await job.run({ db, logger: mkLogger() })
    expect(r.rowsAffected).toBe(0)
    // No INSERT debe haberse ejecutado
    const inserts = calls.filter((c) => c.sql.includes('INSERT INTO platform_bookings.bookings'))
    expect(inserts).toHaveLength(0)
  })
})

// ── INSERT shape ────────────────────────────────────────────────────

describe('INSERT shape — verificación', () => {
  it('cada instancia genera 3 INSERTs: bookings + booking_resources + booking_events', async () => {
    const db = makeDb([{
      id: 'rec-1', app_id: 'a', tenant_id: 't',
      rrule: { freq: 'daily', interval: 1, time: '08:00', duration_minutes: 30 },
      starts_on: '2026-01-01', ends_on: '2026-05-22', count: null,   // solo 2 días: 5/21 y 5/22
    }])
    await job.run({ db, logger: mkLogger() })
    const bookings   = db.calls.filter((c) => c.sql.match(/INSERT INTO platform_bookings\.bookings\s*\(id/))
    const resources  = db.calls.filter((c) => c.sql.includes('INSERT INTO platform_bookings.booking_resources'))
    const events     = db.calls.filter((c) => c.sql.includes('INSERT INTO platform_bookings.booking_events'))
    expect(bookings).toHaveLength(2)
    expect(resources).toHaveLength(2)
    expect(events).toHaveLength(2)
  })

  it('status=confirmed + source=recurrence en cada INSERT', async () => {
    const db = makeDb([{
      id: 'rec-1', app_id: 'a', tenant_id: 't',
      rrule: { freq: 'daily', interval: 1, time: '08:00', duration_minutes: 30 },
      starts_on: '2026-01-01', ends_on: '2026-05-21', count: null,   // solo today
    }])
    await job.run({ db, logger: mkLogger() })
    const bookingInsert = db.calls.find((c) => c.sql.match(/INSERT INTO platform_bookings\.bookings\s*\(id/))
    expect(bookingInsert.sql).toMatch(/'confirmed'/)
    expect(bookingInsert.sql).toMatch(/'recurrence'/)
  })
})
