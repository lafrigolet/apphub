// SQL shape of the new repository functions: withholding settings resolution
// + upsert, payout schedules CRUD, accrual type, payout net/withholding cols.
import { describe, it, expect, vi } from 'vitest'
import * as repo from '../repositories/practitioner-payouts.repository.js'

function mockClient(rows = []) { return { query: vi.fn().mockResolvedValue({ rows }) } }

const APP = 'clinic'
const TEN = 't1'
const PRAC = 'prac1'

describe('resolveWithholdingPct', () => {
  it('prefers practitioner override over tenant default; returns Number', async () => {
    const c = mockClient([{ withholding_pct: '15.00', practitioner_id: PRAC }])
    expect(await repo.resolveWithholdingPct(c, APP, TEN, PRAC)).toBe(15)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/practitioner_id = \$3 OR practitioner_id IS NULL/)
    expect(sql).toMatch(/ORDER BY \(practitioner_id IS NULL\) ASC/)
    expect(params).toEqual([APP, TEN, PRAC])
  })
  it('no row → 0', async () => {
    const c = mockClient([])
    expect(await repo.resolveWithholdingPct(c, APP, TEN, PRAC)).toBe(0)
  })
})

describe('upsertWithholdingSetting', () => {
  it('tenant default (null practitioner) → conflict target without practitioner_id', async () => {
    const c = mockClient([{ id: 'w1' }])
    await repo.upsertWithholdingSetting(c, APP, TEN, { practitionerId: null, withholdingPct: 15 })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/ON CONFLICT \(app_id, tenant_id\) WHERE practitioner_id IS NULL/)
    expect(params).toEqual([APP, TEN, null, 15, {}])
  })
  it('practitioner override → conflict target includes practitioner_id', async () => {
    const c = mockClient([{ id: 'w2' }])
    await repo.upsertWithholdingSetting(c, APP, TEN, { practitionerId: PRAC, withholdingPct: 7, metadata: { y: 1 } })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/ON CONFLICT \(app_id, tenant_id, practitioner_id\) WHERE practitioner_id IS NOT NULL/)
    expect(params).toEqual([APP, TEN, PRAC, 7, { y: 1 }])
  })
})

describe('listWithholdingSettings', () => {
  it('scoped; tenant default first', async () => {
    const c = mockClient([])
    await repo.listWithholdingSettings(c, APP, TEN)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/ORDER BY \(practitioner_id IS NULL\) DESC/)
    expect(params).toEqual([APP, TEN])
  })
})

describe('schedules CRUD', () => {
  it('insertSchedule defaults', async () => {
    const c = mockClient([{ id: 'sch1' }])
    await repo.insertSchedule(c, APP, TEN, { practitionerId: PRAC, period: 'monthly', nextRunAt: 'd' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_practitioner_payouts\.payout_schedules/)
    expect(params[3]).toBe('monthly')
    expect(params[4]).toBe(1)     // anchorDay default
    expect(params[6]).toBe(true)  // isActive default
  })
  it('listSchedules with filters', async () => {
    const c = mockClient([])
    await repo.listSchedules(c, APP, TEN, { practitionerId: PRAC, isActive: false })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/practitioner_id = \$3/)
    expect(sql).toMatch(/is_active = \$4/)
    expect(params).toEqual([APP, TEN, PRAC, false])
  })
  it('findScheduleById scoped; null when absent', async () => {
    const c = mockClient([])
    expect(await repo.findScheduleById(c, APP, TEN, 'sch1')).toBeNull()
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, 'sch1'])
  })
  it('updateSchedule maps camelCase → snake_case, only set fields', async () => {
    const c = mockClient([{ id: 'sch1', is_active: false }])
    await repo.updateSchedule(c, APP, TEN, 'sch1', { isActive: false, anchorDay: 15 })
    const [sql, params] = c.query.mock.calls[0]
    // Map iterates in declaration order: anchor_day before is_active.
    expect(sql).toMatch(/anchor_day = \$4/)
    expect(sql).toMatch(/is_active = \$5/)
    expect(params).toEqual([APP, TEN, 'sch1', 15, false])
  })
  it('updateSchedule with empty patch falls back to findScheduleById', async () => {
    const c = mockClient([{ id: 'sch1' }])
    const r = await repo.updateSchedule(c, APP, TEN, 'sch1', {})
    expect(r).toEqual({ id: 'sch1' })
    expect(c.query.mock.calls[0][0]).toMatch(/SELECT \* FROM platform_practitioner_payouts\.payout_schedules/)
  })
  it('deleteSchedule scoped; null when absent', async () => {
    const c = mockClient([])
    expect(await repo.deleteSchedule(c, APP, TEN, 'sch1')).toBeNull()
    expect(c.query.mock.calls[0][0]).toMatch(/DELETE FROM platform_practitioner_payouts\.payout_schedules/)
  })
})

describe('setPayoutStatus expectedStatus guard', () => {
  it('adds status to WHERE when expectedStatus provided', async () => {
    const c = mockClient([{ id: 'p1', status: 'paid' }])
    await repo.setPayoutStatus(c, APP, TEN, 'p1', 'paid', 'ref', { expectedStatus: 'pending' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/WHERE app_id=\$1 AND tenant_id=\$2 AND id=\$3.*status = \$6/s)
    expect(params).toEqual([APP, TEN, 'p1', 'paid', 'ref', 'pending'])
  })
})

describe('findAccrualById', () => {
  it('scoped select', async () => {
    const c = mockClient([{ id: 'a1' }])
    expect(await repo.findAccrualById(c, APP, TEN, 'a1')).toEqual({ id: 'a1' })
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, 'a1'])
  })
})
