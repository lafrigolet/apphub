// bookings.repository — SQL-shape de platform_bookings + lecturas cross-schema
// (service_sessions, services, holds). Verifica tablas, overlap-guards, filtros
// dinámicos (listBookings/listWaitlist), stamping (setStatus) y params.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as repo from '../repositories/bookings.repository.js'

function mockClient(rows = [], rowCount = rows.length) {
  return { query: vi.fn().mockResolvedValue({ rows, rowCount }) }
}

const APP = 'yoga'
const TENANT = 't1'
const SVC = 'svc1'
const RES = 'res1'
const BID = 'b1'

beforeEach(() => vi.clearAllMocks())

// ── insertBookingAtomic ─────────────────────────────────────────────

describe('insertBookingAtomic', () => {
  const base = {
    serviceId: SVC, clientUserId: 'u1', startsAt: 'S', endsAt: 'E',
    resourceIds: [RES],
  }

  it('throw si resourceIds vacío', async () => {
    const c = mockClient([])
    await expect(repo.insertBookingAtomic(c, APP, TENANT, { ...base, resourceIds: [] }))
      .rejects.toThrow(/resourceIds required/)
    await expect(repo.insertBookingAtomic(c, APP, TENANT, { ...base, resourceIds: undefined }))
      .rejects.toThrow(/resourceIds required/)
  })

  it('CTE overlapping + INSERT condicional; defaults; row', async () => {
    const c = mockClient([{ id: BID }])
    const r = await repo.insertBookingAtomic(c, APP, TENANT, base)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/WITH overlapping AS/)
    expect(sql).toMatch(/INSERT INTO platform_bookings\.bookings/)
    expect(sql).toMatch(/WHERE NOT EXISTS \(SELECT 1 FROM overlapping\)/)
    // $21 = resourceIds, $22 = locale
    expect(params[0]).toBe(APP)
    expect(params[1]).toBe(TENANT)
    expect(params[20]).toEqual([RES])  // resourceIds
    expect(params[2]).toBeNull()       // subTenantId default
    expect(params[19]).toEqual({})     // metadata default
    expect(r).toEqual({ id: BID })
  })

  it('conflicto → null', async () => {
    const c = mockClient([])
    expect(await repo.insertBookingAtomic(c, APP, TENANT, base)).toBeNull()
  })
})

// ── insertBookingForSession ─────────────────────────────────────────

describe('insertBookingForSession', () => {
  it('INSERT con session_id ($21); row + null', async () => {
    const c = mockClient([{ id: BID }])
    const r = await repo.insertBookingForSession(c, APP, TENANT, {
      serviceId: SVC, clientUserId: 'u1', startsAt: 'S', endsAt: 'E', sessionId: 'sess1',
    })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/session_id/)
    expect(params[21]).toBe('sess1') // session_id is last ($22) after locale($21)
    expect(params[20]).toBeNull()    // locale default
    expect(r).toEqual({ id: BID })
    const c2 = mockClient([])
    expect(await repo.insertBookingForSession(c2, APP, TENANT, { serviceId: SVC, clientUserId: 'u1', startsAt: 'S', endsAt: 'E', sessionId: 'sess1' })).toBeNull()
  })
})

// ── countBookingsForSession ─────────────────────────────────────────

describe('countBookingsForSession', () => {
  it('cuenta vivas; sin rows → 0', async () => {
    const c = mockClient([{ count: 4 }])
    expect(await repo.countBookingsForSession(c, APP, TENANT, 'sess1')).toBe(4)
    expect(c.query.mock.calls[0][0]).toMatch(/NOT IN \('cancelled','no_show','rescheduled'\)/)
    expect(c.query.mock.calls[0][1]).toEqual([APP, TENANT, 'sess1'])
    const c2 = mockClient([])
    expect(await repo.countBookingsForSession(c2, APP, TENANT, 'sess1')).toBe(0)
  })
})

// ── loadServiceSession ──────────────────────────────────────────────

describe('loadServiceSession', () => {
  it('row desde platform_services.service_sessions', async () => {
    const c = mockClient([{ id: 'sess1' }])
    expect(await repo.loadServiceSession(c, APP, TENANT, 'sess1')).toEqual({ id: 'sess1' })
    expect(c.query.mock.calls[0][0]).toMatch(/FROM platform_services\.service_sessions/)
  })

  it('sin row → null', async () => {
    const c = mockClient([])
    expect(await repo.loadServiceSession(c, APP, TENANT, 'sess1')).toBeNull()
  })

  it('query lanza (GRANT missing) → null', async () => {
    const c = { query: vi.fn().mockRejectedValue(new Error('permission denied')) }
    expect(await repo.loadServiceSession(c, APP, TENANT, 'sess1')).toBeNull()
  })
})

// ── loadServiceFor ──────────────────────────────────────────────────

describe('loadServiceFor', () => {
  it('row + null + catch', async () => {
    const c = mockClient([{ id: SVC, kind: 'event' }])
    expect(await repo.loadServiceFor(c, APP, TENANT, SVC)).toEqual({ id: SVC, kind: 'event' })
    expect(c.query.mock.calls[0][0]).toMatch(/FROM platform_services\.services/)
    const c2 = mockClient([])
    expect(await repo.loadServiceFor(c2, APP, TENANT, SVC)).toBeNull()
    const c3 = { query: vi.fn().mockRejectedValue(new Error('denied')) }
    expect(await repo.loadServiceFor(c3, APP, TENANT, SVC)).toBeNull()
  })
})

// ── insertBooking (legacy) ──────────────────────────────────────────

describe('insertBooking', () => {
  it('INSERT sin guard; devuelve row', async () => {
    const c = mockClient([{ id: BID }])
    const r = await repo.insertBooking(c, APP, TENANT, { serviceId: SVC, clientUserId: 'u1', startsAt: 'S', endsAt: 'E' })
    expect(c.query.mock.calls[0][0]).toMatch(/INSERT INTO platform_bookings\.bookings/)
    expect(c.query.mock.calls[0][0]).not.toMatch(/overlapping/)
    expect(r).toEqual({ id: BID })
  })
})

// ── consumeHold ─────────────────────────────────────────────────────

describe('consumeHold', () => {
  it('DELETE de platform_availability.holds con expires_at>now(); row + null', async () => {
    const c = mockClient([{ id: 'h1', resource_id: RES }])
    expect(await repo.consumeHold(c, APP, TENANT, 'h1')).toEqual({ id: 'h1', resource_id: RES })
    expect(c.query.mock.calls[0][0]).toMatch(/DELETE FROM platform_availability\.holds/)
    expect(c.query.mock.calls[0][0]).toMatch(/expires_at > now\(\)/)
    expect(c.query.mock.calls[0][1]).toEqual([APP, TENANT, 'h1'])
    const c2 = mockClient([])
    expect(await repo.consumeHold(c2, APP, TENANT, 'h1')).toBeNull()
  })
})

// ── attachResource / listResources ──────────────────────────────────

describe('attachResource / listResources', () => {
  it('attachResource → INSERT ON CONFLICT DO NOTHING', async () => {
    const c = mockClient([])
    await repo.attachResource(c, APP, TENANT, BID, RES)
    expect(c.query.mock.calls[0][0]).toMatch(/ON CONFLICT DO NOTHING/)
    expect(c.query.mock.calls[0][1]).toEqual([APP, TENANT, BID, RES])
  })

  it('listResources → array de resource_id', async () => {
    const c = mockClient([{ resource_id: RES }, { resource_id: 'res2' }])
    expect(await repo.listResources(c, APP, TENANT, BID)).toEqual([RES, 'res2'])
  })
})

// ── findById ────────────────────────────────────────────────────────

describe('findById', () => {
  it('row + null', async () => {
    const c = mockClient([{ id: BID }])
    expect(await repo.findById(c, APP, TENANT, BID)).toEqual({ id: BID })
    expect(c.query.mock.calls[0][1]).toEqual([APP, TENANT, BID])
    const c2 = mockClient([])
    expect(await repo.findById(c2, APP, TENANT, BID)).toBeNull()
  })
})

// ── listBookings ────────────────────────────────────────────────────

describe('listBookings', () => {
  it('sin filtros → app+tenant + LIMIT default 200', async () => {
    const c = mockClient([{ id: BID }])
    await repo.listBookings(c, APP, TENANT)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/ORDER BY b\.starts_at ASC/)
    expect(params).toEqual([APP, TENANT, 200])
  })

  it('todos los filtros + resourceId añade JOIN', async () => {
    const c = mockClient([])
    await repo.listBookings(c, APP, TENANT, {
      from: 'F', to: 'T', clientUserId: 'u1', resourceId: RES, sessionId: 'sess1', status: 'confirmed', limit: 50,
    })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/JOIN platform_bookings\.booking_resources br/)
    expect(sql).toMatch(/b\.starts_at >= \$3/)
    expect(sql).toMatch(/b\.starts_at <  \$4/)
    expect(sql).toMatch(/b\.client_user_id = \$5/)
    expect(sql).toMatch(/b\.session_id = \$6/)
    expect(sql).toMatch(/b\.status = \$7/)
    expect(sql).toMatch(/br\.resource_id = \$8/)
    expect(params).toEqual([APP, TENANT, 'F', 'T', 'u1', 'sess1', 'confirmed', RES, 50])
  })
})

// ── setStatus ───────────────────────────────────────────────────────

describe('setStatus', () => {
  it('sin extra → SET status + updated_at; row', async () => {
    const c = mockClient([{ id: BID, status: 'confirmed' }])
    const r = await repo.setStatus(c, APP, TENANT, BID, 'confirmed')
    expect(c.query.mock.calls[0][0]).toMatch(/SET status = \$4, updated_at = now\(\)/)
    expect(c.query.mock.calls[0][1]).toEqual([APP, TENANT, BID, 'confirmed'])
    expect(r).toEqual({ id: BID, status: 'confirmed' })
  })

  it('extra startsAt+endsAt → añade sets parametrizados', async () => {
    const c = mockClient([{ id: BID }])
    await repo.setStatus(c, APP, TENANT, BID, 'rescheduled', { startsAt: 'NS', endsAt: 'NE' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/starts_at = \$5/)
    expect(sql).toMatch(/ends_at   = \$6/)
    expect(params).toEqual([APP, TENANT, BID, 'rescheduled', 'NS', 'NE'])
  })

  it('sin row → null', async () => {
    const c = mockClient([])
    expect(await repo.setStatus(c, APP, TENANT, BID, 'confirmed')).toBeNull()
  })
})

// ── recordEvent / listEvents ────────────────────────────────────────

describe('recordEvent / listEvents', () => {
  it('recordEvent → INSERT booking_events; actor/reason null defaults', async () => {
    const c = mockClient([])
    await repo.recordEvent(c, APP, TENANT, BID, 'requested', 'confirmed')
    expect(c.query.mock.calls[0][0]).toMatch(/INSERT INTO platform_bookings\.booking_events/)
    expect(c.query.mock.calls[0][1]).toEqual([APP, TENANT, BID, 'requested', 'confirmed', null, null])
  })

  it('listEvents → ORDER BY ts ASC', async () => {
    const c = mockClient([{ id: 'e1' }])
    expect(await repo.listEvents(c, APP, TENANT, BID)).toEqual([{ id: 'e1' }])
    expect(c.query.mock.calls[0][0]).toMatch(/ORDER BY ts ASC/)
  })
})

// ── insertRecurrence ────────────────────────────────────────────────

describe('insertRecurrence', () => {
  it('INSERT recurrences; defaults', async () => {
    const c = mockClient([{ id: 'rec1' }])
    const r = await repo.insertRecurrence(c, APP, TENANT, { rrule: 'FREQ=WEEKLY', startsOn: '2026-01-01' })
    expect(c.query.mock.calls[0][0]).toMatch(/INSERT INTO platform_bookings\.recurrences/)
    expect(c.query.mock.calls[0][1]).toEqual([APP, TENANT, 'FREQ=WEEKLY', '2026-01-01', null, null, {}])
    expect(r).toEqual({ id: 'rec1' })
  })
})

// ── waitlist ────────────────────────────────────────────────────────

describe('waitlist', () => {
  it('insertWaitlist → defaults status=waiting', async () => {
    const c = mockClient([{ id: 'w1' }])
    await repo.insertWaitlist(c, APP, TENANT, { serviceId: SVC, clientUserId: 'u1' })
    expect(c.query.mock.calls[0][0]).toMatch(/INSERT INTO platform_bookings\.waitlist/)
    expect(c.query.mock.calls[0][1]).toEqual([APP, TENANT, SVC, null, 'u1', null, null, null, 'waiting'])
  })

  it('listWaitlist sin filtros → app+tenant ORDER BY created_at', async () => {
    const c = mockClient([{ id: 'w1' }])
    await repo.listWaitlist(c, APP, TENANT)
    expect(c.query.mock.calls[0][0]).toMatch(/ORDER BY created_at/)
    expect(c.query.mock.calls[0][1]).toEqual([APP, TENANT])
  })

  it('listWaitlist con serviceId+status', async () => {
    const c = mockClient([])
    await repo.listWaitlist(c, APP, TENANT, { serviceId: SVC, status: 'waiting' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/service_id = \$3/)
    expect(sql).toMatch(/status = \$4/)
    expect(params).toEqual([APP, TENANT, SVC, 'waiting'])
  })

  it('updateWaitlistStatus → SET status; row + null', async () => {
    const c = mockClient([{ id: 'w1', status: 'notified' }])
    expect(await repo.updateWaitlistStatus(c, APP, TENANT, 'w1', 'notified')).toEqual({ id: 'w1', status: 'notified' })
    expect(c.query.mock.calls[0][1]).toEqual([APP, TENANT, 'w1', 'notified'])
    const c2 = mockClient([])
    expect(await repo.updateWaitlistStatus(c2, APP, TENANT, 'w1', 'notified')).toBeNull()
  })
})

// ── clientAlreadyEnrolled ───────────────────────────────────────────

describe('clientAlreadyEnrolled', () => {
  it('true cuando hay inscripción viva', async () => {
    const c = mockClient([{ '?column?': 1 }])
    const r = await repo.clientAlreadyEnrolled(c, APP, TENANT, 'sess1', 'u1')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/session_id = \$3/)
    expect(sql).toMatch(/client_user_id = \$4/)
    expect(sql).toMatch(/status NOT IN/)
    expect(params).toEqual([APP, TENANT, 'sess1', 'u1'])
    expect(r).toBe(true)
  })

  it('false cuando no hay filas', async () => {
    const c = mockClient([])
    expect(await repo.clientAlreadyEnrolled(c, APP, TENANT, 'sess1', 'u1')).toBe(false)
  })
})

// ── promoteOldestWaiting ────────────────────────────────────────────

describe('promoteOldestWaiting', () => {
  it('sin resourceId → no añade filtro de recurso; FIFO + SKIP LOCKED', async () => {
    const c = mockClient([{ id: 'w1', status: 'notified' }])
    const r = await repo.promoteOldestWaiting(c, APP, TENANT, { serviceId: SVC })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/SET status = 'notified'/)
    expect(sql).toMatch(/status = 'waiting'/)
    expect(sql).toMatch(/ORDER BY created_at/)
    expect(sql).toMatch(/FOR UPDATE SKIP LOCKED/)
    expect(sql).not.toMatch(/resource_id IS NULL OR resource_id/)
    expect(params).toEqual([APP, TENANT, SVC])
    expect(r).toEqual({ id: 'w1', status: 'notified' })
  })

  it('con resourceId → filtra resource_id NULL o match ($4)', async () => {
    const c = mockClient([{ id: 'w1' }])
    await repo.promoteOldestWaiting(c, APP, TENANT, { serviceId: SVC, resourceId: RES })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/resource_id IS NULL OR resource_id = \$4/)
    expect(params).toEqual([APP, TENANT, SVC, RES])
  })

  it('sin entrada elegible → null', async () => {
    const c = mockClient([])
    expect(await repo.promoteOldestWaiting(c, APP, TENANT, { serviceId: SVC })).toBeNull()
  })
})

// ── recurrences read ────────────────────────────────────────────────

describe('listRecurrences / findRecurrenceById', () => {
  it('listRecurrences → app+tenant, LIMIT por defecto 200', async () => {
    const c = mockClient([{ id: 'r1' }])
    await repo.listRecurrences(c, APP, TENANT)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/FROM platform_bookings\.recurrences/)
    expect(sql).toMatch(/ORDER BY created_at DESC/)
    expect(params).toEqual([APP, TENANT, 200])
  })

  it('listRecurrences respeta limit', async () => {
    const c = mockClient([])
    await repo.listRecurrences(c, APP, TENANT, { limit: 5 })
    expect(c.query.mock.calls[0][1]).toEqual([APP, TENANT, 5])
  })

  it('findRecurrenceById → row o null', async () => {
    const c = mockClient([{ id: 'r1' }])
    expect(await repo.findRecurrenceById(c, APP, TENANT, 'r1')).toEqual({ id: 'r1' })
    const c2 = mockClient([])
    expect(await repo.findRecurrenceById(c2, APP, TENANT, 'r1')).toBeNull()
  })
})
