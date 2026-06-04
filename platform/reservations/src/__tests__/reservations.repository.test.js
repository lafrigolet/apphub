// reservations.repository — SQL shape for platform_reservations.* tables.
// Validates column projection, parametrized params (anti-injection), optional
// filters, COALESCE defaults, and tenant scoping on every query.
import { describe, it, expect, vi } from 'vitest'
import * as repo from '../repositories/reservations.repository.js'

function mockClient(rows = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) }
}

const APP = 'aikikan'
const TEN = 't1'

describe('insertReservation', () => {
  it('INSERT into platform_reservations.reservations with 16 params and COALESCE defaults', async () => {
    const c = mockClient([{ id: 'r1' }])
    const out = await repo.insertReservation(c, {
      appId: APP, tenantId: TEN, subTenantId: null, guestUserId: 'u1',
      guestName: 'Ana', guestEmail: 'ana@x.com', guestPhone: '+34',
      partySize: 4, reservedFor: '2026-05-01T20:00:00Z', durationMinutes: 120,
      tableId: 'tbl1', status: 'requested', notes: 'window', source: 'phone', locale: 'es',
      specialRequests: { highChair: true, allergens: ['nuts'] },
    })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_reservations\.reservations/)
    expect(sql).toMatch(/COALESCE\(\$10,90\)/)
    expect(sql).toMatch(/COALESCE\(\$12,'requested'\)/)
    expect(sql).toMatch(/COALESCE\(\$14,'portal'\)/)
    expect(sql).toMatch(/RETURNING \*/)
    expect(params).toEqual([
      APP, TEN, null, 'u1', 'Ana', 'ana@x.com', '+34',
      4, '2026-05-01T20:00:00Z', 120, 'tbl1', 'requested', 'window', 'phone', 'es',
      JSON.stringify({ highChair: true, allergens: ['nuts'] }),
    ])
    expect(out).toEqual({ id: 'r1' })
  })

  it('applies nullish defaults when optional fields absent', async () => {
    const c = mockClient([{ id: 'r1' }])
    await repo.insertReservation(c, {
      appId: APP, tenantId: TEN, guestName: 'Ana', partySize: 2, reservedFor: 't',
    })
    const params = c.query.mock.calls[0][1]
    expect(params).toEqual([
      APP, TEN, null, null, 'Ana', null, null,
      2, 't', 90, null, 'requested', null, 'portal', null, null,
    ])
  })
})

describe('listReservations', () => {
  it('no filters → only tenant scope + default limit', async () => {
    const c = mockClient([])
    await repo.listReservations(c, APP, TEN)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/WHERE app_id = \$1 AND tenant_id = \$2/)
    expect(sql).toMatch(/ORDER BY reserved_for ASC LIMIT \$3/)
    expect(params).toEqual([APP, TEN, 100])
  })

  it('all filters present → from/to/status appended in order', async () => {
    const c = mockClient([])
    await repo.listReservations(c, APP, TEN, { from: 'F', to: 'T', status: 'confirmed', limit: 10 })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/reserved_for >= \$3/)
    expect(sql).toMatch(/reserved_for <  \$4/)
    expect(sql).toMatch(/status = \$5/)
    expect(sql).toMatch(/LIMIT \$6/)
    expect(params).toEqual([APP, TEN, 'F', 'T', 'confirmed', 10])
  })
})

describe('findReservationById', () => {
  it('scopes by app/tenant/id; missing → null', async () => {
    const c = mockClient([])
    expect(await repo.findReservationById(c, APP, TEN, 'r9')).toBeNull()
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/WHERE app_id=\$1 AND tenant_id=\$2 AND id=\$3/)
    expect(params).toEqual([APP, TEN, 'r9'])
  })

  it('returns row when present', async () => {
    const c = mockClient([{ id: 'r1' }])
    expect(await repo.findReservationById(c, APP, TEN, 'r1')).toEqual({ id: 'r1' })
  })
})

describe('updateReservationStatus', () => {
  it('UPDATE with COALESCE table_id, cancellation metadata and tenant scope', async () => {
    const c = mockClient([{ id: 'r1', status: 'seated' }])
    await repo.updateReservationStatus(c, APP, TEN, 'r1', 'seated', 'tbl1')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/SET status=\$4/)
    expect(sql).toMatch(/table_id = COALESCE\(\$5, table_id\)/)
    expect(sql).toMatch(/cancellation_reason = CASE WHEN \$4 = 'cancelled' THEN \$6/)
    expect(sql).toMatch(/cancelled_by\s+= CASE WHEN \$4 = 'cancelled' THEN \$7/)
    expect(sql).toMatch(/WHERE app_id=\$1 AND tenant_id=\$2 AND id=\$3/)
    expect(params).toEqual([APP, TEN, 'r1', 'seated', 'tbl1', null, null])
  })

  it('null tableId/meta defaults; missing row → null', async () => {
    const c = mockClient([])
    expect(await repo.updateReservationStatus(c, APP, TEN, 'r1', 'cancelled')).toBeNull()
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, 'r1', 'cancelled', null, null, null])
  })

  it('passes cancellation reason and actor through meta', async () => {
    const c = mockClient([{ id: 'r1', status: 'cancelled' }])
    await repo.updateReservationStatus(c, APP, TEN, 'r1', 'cancelled', null, {
      cancellationReason: 'weather', cancelledBy: 'staff',
    })
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, 'r1', 'cancelled', null, 'weather', 'staff'])
  })
})

describe('insertWaitlistEntry', () => {
  it('INSERT with COALESCE status default and nullish optionals', async () => {
    const c = mockClient([{ id: 'w1' }])
    await repo.insertWaitlistEntry(c, {
      appId: APP, tenantId: TEN, guestName: 'X', partySize: 3,
    })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_reservations\.waitlist/)
    expect(sql).toMatch(/COALESCE\(\$6,'waiting'\)/)
    expect(params).toEqual([APP, TEN, 'X', null, 3, 'waiting', null, null])
  })

  it('passes through explicit optional fields', async () => {
    const c = mockClient([{ id: 'w1' }])
    await repo.insertWaitlistEntry(c, {
      appId: APP, tenantId: TEN, guestName: 'X', guestPhone: '+34', partySize: 3,
      status: 'notified', estimatedWaitMinutes: 15, notes: 'n',
    })
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, 'X', '+34', 3, 'notified', 15, 'n'])
  })
})

describe('listWaitlist', () => {
  it('no status → tenant scope only', async () => {
    const c = mockClient([])
    await repo.listWaitlist(c, APP, TEN)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).not.toMatch(/status =/)
    expect(sql).toMatch(/ORDER BY created_at ASC/)
    expect(params).toEqual([APP, TEN])
  })

  it('status filter appended', async () => {
    const c = mockClient([])
    await repo.listWaitlist(c, APP, TEN, { status: 'waiting' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/status = \$3/)
    expect(params).toEqual([APP, TEN, 'waiting'])
  })
})

describe('updateWaitlistStatus', () => {
  it('UPDATE waitlist scoped; missing → null', async () => {
    const c = mockClient([])
    expect(await repo.updateWaitlistStatus(c, APP, TEN, 'w1', 'notified')).toBeNull()
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/UPDATE platform_reservations\.waitlist SET status=\$4/)
    expect(params).toEqual([APP, TEN, 'w1', 'notified'])
  })

  it('returns updated row', async () => {
    const c = mockClient([{ id: 'w1', status: 'notified' }])
    expect(await repo.updateWaitlistStatus(c, APP, TEN, 'w1', 'notified')).toEqual({ id: 'w1', status: 'notified' })
  })
})

describe('insertServiceHours', () => {
  it('INSERT with COALESCE is_closed default FALSE and null max_covers', async () => {
    const c = mockClient([{ id: 's1' }])
    await repo.insertServiceHours(c, {
      appId: APP, tenantId: TEN, dayOfWeek: 1, openMinute: 480, closeMinute: 1320,
    })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_reservations\.service_hours/)
    expect(sql).toMatch(/COALESCE\(\$7,FALSE\)/)
    expect(params).toEqual([APP, TEN, 1, 480, 1320, null, false, null])
  })

  it('passes explicit label, isClosed and maxCovers', async () => {
    const c = mockClient([{ id: 's1' }])
    await repo.insertServiceHours(c, {
      appId: APP, tenantId: TEN, dayOfWeek: 0, openMinute: 0, closeMinute: 0,
      serviceLabel: 'brunch', isClosed: true, maxCovers: 40,
    })
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, 0, 0, 0, 'brunch', true, 40])
  })
})

describe('availability queries', () => {
  it('listOpenServiceHoursForDay filters open windows by weekday + tenant', async () => {
    const c = mockClient([{ id: 's1' }])
    await repo.listOpenServiceHoursForDay(c, APP, TEN, 5)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/day_of_week=\$3 AND is_closed = FALSE/)
    expect(params).toEqual([APP, TEN, 5])
  })

  it('findBlackoutCovering checks the instant inside [starts_at, ends_at)', async () => {
    const c = mockClient([{ id: 'b1', reason: 'holiday' }])
    const out = await repo.findBlackoutCovering(c, APP, TEN, '2026-05-01T20:00:00Z')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/starts_at <= \$3 AND ends_at > \$3/)
    expect(params).toEqual([APP, TEN, '2026-05-01T20:00:00Z'])
    expect(out).toEqual({ id: 'b1', reason: 'holiday' })
  })

  it('sumActiveCoversInWindow sums overlapping active reservations, excludes id', async () => {
    const c = mockClient([{ covers: 12 }])
    const out = await repo.sumActiveCoversInWindow(c, APP, TEN, 'F', 'T', 'self')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/SUM\(party_size\)/)
    expect(sql).toMatch(/status IN \('requested','confirmed','seated'\)/)
    expect(sql).toMatch(/reserved_for < \$4/)
    expect(params).toEqual([APP, TEN, 'F', 'T', 'self'])
    expect(out).toBe(12)
  })

  it('sumActiveCoversInWindow defaults exclude id to null', async () => {
    const c = mockClient([{ covers: 0 }])
    await repo.sumActiveCoversInWindow(c, APP, TEN, 'F', 'T')
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, 'F', 'T', null])
  })
})

describe('countNoShowsByGuest', () => {
  it('returns 0 without identifiers (no query issued)', async () => {
    const c = mockClient([])
    expect(await repo.countNoShowsByGuest(c, APP, TEN, {})).toBe(0)
    expect(c.query).not.toHaveBeenCalled()
  })

  it('counts no_show reservations scoped by user id / email', async () => {
    const c = mockClient([{ n: 3 }])
    const out = await repo.countNoShowsByGuest(c, APP, TEN, { guestUserId: 'u1', guestEmail: 'g@a.com' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/status='no_show'/)
    expect(params).toEqual([APP, TEN, 'u1', 'g@a.com'])
    expect(out).toBe(3)
  })
})

describe('findNextWaitingForCapacity', () => {
  it('returns FIFO waiting entry fitting capacity', async () => {
    const c = mockClient([{ id: 'w1', party_size: 2 }])
    const out = await repo.findNextWaitingForCapacity(c, APP, TEN, 4)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/status='waiting' AND party_size <= \$3/)
    expect(sql).toMatch(/ORDER BY created_at ASC/)
    expect(params).toEqual([APP, TEN, 4])
    expect(out).toEqual({ id: 'w1', party_size: 2 })
  })

  it('null when queue empty', async () => {
    const c = mockClient([])
    expect(await repo.findNextWaitingForCapacity(c, APP, TEN, 4)).toBeNull()
  })
})

describe('listServiceHours', () => {
  it('tenant scope + ORDER BY day_of_week, open_minute', async () => {
    const c = mockClient([{ id: 's1' }])
    const out = await repo.listServiceHours(c, APP, TEN)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/WHERE app_id=\$1 AND tenant_id=\$2/)
    expect(sql).toMatch(/ORDER BY day_of_week, open_minute/)
    expect(params).toEqual([APP, TEN])
    expect(out).toEqual([{ id: 's1' }])
  })
})
