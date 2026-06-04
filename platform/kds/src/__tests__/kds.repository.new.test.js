// New repository SQL shapes: station update/delete/reassign, order grouping,
// cancellation, item status, all-day totals and timing metrics. All scoped by
// (app_id, tenant_id) with parameterized queries.
import { describe, it, expect, vi } from 'vitest'
import * as repo from '../repositories/kds.repository.js'

const APP = 'resto'
const TEN = 't1'
function mockClient(rows = [], rowCount = rows.length) {
  return { query: vi.fn().mockResolvedValue({ rows, rowCount }) }
}

describe('updateStation', () => {
  it('builds dynamic SET only for provided fields, scoped by app/tenant/id', async () => {
    const c = mockClient([{ id: 'st1' }])
    await repo.updateStation(c, APP, TEN, 'st1', { name: 'X', isActive: false })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/UPDATE platform_kds\.stations SET name = \$4, is_active = \$5/)
    expect(sql).toMatch(/WHERE app_id=\$1 AND tenant_id=\$2 AND id=\$3/)
    expect(params).toEqual([APP, TEN, 'st1', 'X', false])
  })
  it('with no fields → SELECT current row (no UPDATE)', async () => {
    const c = mockClient([{ id: 'st1' }])
    const r = await repo.updateStation(c, APP, TEN, 'st1', {})
    expect(c.query.mock.calls[0][0]).toMatch(/^SELECT \* FROM platform_kds\.stations/)
    expect(r).toEqual({ id: 'st1' })
  })
})

describe('deleteStation', () => {
  it('DELETE scoped; returns true when a row was removed', async () => {
    const c = mockClient([], 1)
    expect(await repo.deleteStation(c, APP, TEN, 'st1')).toBe(true)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/DELETE FROM platform_kds\.stations WHERE app_id=\$1 AND tenant_id=\$2 AND id=\$3/)
    expect(params).toEqual([APP, TEN, 'st1'])
  })
  it('returns false when nothing deleted', async () => {
    const c = mockClient([], 0)
    expect(await repo.deleteStation(c, APP, TEN, 'st1')).toBe(false)
  })
})

describe('reassignTicketsStation', () => {
  it('moves tickets from one station to another (or null), returns ids', async () => {
    const c = mockClient([{ id: 'tk1' }, { id: 'tk2' }])
    const r = await repo.reassignTicketsStation(c, APP, TEN, 'st1', null)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/UPDATE platform_kds\.tickets SET station_id=\$4/)
    expect(sql).toMatch(/WHERE app_id=\$1 AND tenant_id=\$2 AND station_id=\$3/)
    expect(params).toEqual([APP, TEN, 'st1', null])
    expect(r).toEqual(['tk1', 'tk2'])
  })
})

describe('listTicketsByOrder', () => {
  it('filters by order_id ordered by fired_at', async () => {
    const c = mockClient([{ id: 'tk1' }])
    await repo.listTicketsByOrder(c, APP, TEN, 'ord1')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/WHERE app_id=\$1 AND tenant_id=\$2 AND order_id=\$3/)
    expect(sql).toMatch(/ORDER BY fired_at ASC/)
    expect(params).toEqual([APP, TEN, 'ord1'])
  })
})

describe('setTicketStatus — cancelled path', () => {
  it('cancelled writes cancelled_at + cancel_reason', async () => {
    const c = mockClient([{ id: 'tk1', status: 'cancelled' }])
    await repo.setTicketStatus(c, APP, TEN, 'tk1', 'cancelled', 'cancelled_at', 'voided')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/SET status=\$4, cancelled_at=now\(\), cancel_reason=\$5/)
    expect(params).toEqual([APP, TEN, 'tk1', 'cancelled', 'voided'])
  })
  it('non-cancelled interpolates the tsCol and ignores reason', async () => {
    const c = mockClient([{ id: 'tk1' }])
    await repo.setTicketStatus(c, APP, TEN, 'tk1', 'ready', 'ready_at')
    expect(c.query.mock.calls[0][0]).toMatch(/SET status=\$4, ready_at=now\(\)/)
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, 'tk1', 'ready'])
  })
})

describe('cancelTicketsByOrder', () => {
  it('bulk-cancels only open tickets of an order', async () => {
    const c = mockClient([{ id: 'tk1' }])
    await repo.cancelTicketsByOrder(c, APP, TEN, 'ord1', 'auto')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/SET status='cancelled', cancelled_at=now\(\), cancel_reason=\$4/)
    expect(sql).toMatch(/status IN \('fired','in_progress','ready'\)/)
    expect(params).toEqual([APP, TEN, 'ord1', 'auto'])
  })
})

describe('setItemStatus', () => {
  it('ready stamps ready_at; scoped by app/tenant/id', async () => {
    const c = mockClient([{ id: 'i1', status: 'ready' }])
    await repo.setItemStatus(c, APP, TEN, 'i1', 'ready')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/SET status=\$4, ready_at=now\(\)/)
    expect(params).toEqual([APP, TEN, 'i1', 'ready'])
  })
  it('in_progress does not stamp ready_at', async () => {
    const c = mockClient([{ id: 'i1', status: 'in_progress' }])
    await repo.setItemStatus(c, APP, TEN, 'i1', 'in_progress')
    expect(c.query.mock.calls[0][0]).not.toMatch(/ready_at=now/)
  })
})

describe('allDayTotals', () => {
  it('joins items+tickets, sums active qty grouped by sku/name', async () => {
    const c = mockClient([{ sku: 'BURG', total: 12 }])
    await repo.allDayTotals(c, APP, TEN)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/FROM platform_kds\.ticket_items i/)
    expect(sql).toMatch(/JOIN platform_kds\.tickets t ON t\.id = i\.ticket_id/)
    expect(sql).toMatch(/GROUP BY i\.sku, i\.name/)
    expect(sql).toMatch(/t\.status IN \('fired','in_progress'\)/)
    expect(params).toEqual([APP, TEN])
  })
  it('adds a station filter when stationId given', async () => {
    const c = mockClient([])
    await repo.allDayTotals(c, APP, TEN, { stationId: 'st1' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/t\.station_id = \$3/)
    expect(params).toEqual([APP, TEN, 'st1'])
  })
})

describe('metrics', () => {
  it('aggregates timing avgs + cancellations by station/course', async () => {
    const c = mockClient([{ station_id: 'st1', avg_prep_secs: 300 }])
    await repo.metrics(c, APP, TEN, {})
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/AVG\(EXTRACT\(EPOCH FROM \(ready_at\s+- fired_at\)\)\)/)
    expect(sql).toMatch(/COUNT\(\*\) FILTER \(WHERE status = 'cancelled'\)/)
    expect(sql).toMatch(/GROUP BY station_id, course/)
    expect(params).toEqual([APP, TEN])
  })
  it('applies from/to window filters', async () => {
    const c = mockClient([])
    await repo.metrics(c, APP, TEN, { from: '2026-01-01', to: '2026-02-01' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/fired_at >= \$3/)
    expect(sql).toMatch(/fired_at <  \$4/)
    expect(params).toEqual([APP, TEN, '2026-01-01', '2026-02-01'])
  })
})
