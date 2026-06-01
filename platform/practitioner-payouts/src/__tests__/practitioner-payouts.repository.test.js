// practitioner-payouts.repository — SQL shape de platform_practitioner_payouts.
// Valida tabla, scoping (app_id/tenant_id), params, branches de filtros
// dinámicos (índices $N), COALESCE defaults y agregaciones.
import { describe, it, expect, vi } from 'vitest'
import * as repo from '../repositories/practitioner-payouts.repository.js'

function mockClient(rows = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) }
}

const APP = 'clinic'
const TEN = 't1'
const PRAC = 'prac1'
const SVC = 'svc1'
const SCHEMA = /platform_practitioner_payouts/

describe('insertCommissionRule', () => {
  it('INSERT con defaults via COALESCE', async () => {
    const c = mockClient([{ id: 'r1' }])
    await repo.insertCommissionRule(c, APP, TEN, { practitionerId: PRAC, ratePct: 30 })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(SCHEMA)
    expect(sql).toMatch(/INSERT INTO platform_practitioner_payouts\.commission_rules/)
    expect(params[0]).toBe(APP)
    expect(params[3]).toBeNull()   // serviceId default
    expect(params[5]).toBe(0)      // flatFeeCents default
    expect(params[6]).toBeNull()   // effectiveFrom (COALESCE now en SQL)
    expect(params[7]).toBeNull()   // effectiveUntil
    expect(params[8]).toEqual({})  // metadata default
  })

  it('respeta valores explícitos', async () => {
    const c = mockClient([{}])
    await repo.insertCommissionRule(c, APP, TEN, {
      practitionerId: PRAC, serviceId: SVC, ratePct: 20, flatFeeCents: 100,
      effectiveFrom: '2026-01-01', effectiveUntil: '2026-12-31', metadata: { k: 1 },
    })
    const params = c.query.mock.calls[0][1]
    expect(params[3]).toBe(SVC)
    expect(params[5]).toBe(100)
    expect(params[6]).toBe('2026-01-01')
    expect(params[7]).toBe('2026-12-31')
    expect(params[8]).toEqual({ k: 1 })
  })
})

describe('listCommissionRules', () => {
  it('sin filtros → solo app/tenant; ORDER BY effective_from DESC', async () => {
    const c = mockClient([])
    await repo.listCommissionRules(c, APP, TEN)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).not.toMatch(/practitioner_id =/)
    expect(sql).toMatch(/ORDER BY effective_from DESC/)
    expect(params).toEqual([APP, TEN])
  })

  it('con practitionerId + serviceId → filtros con índices y wildcard de service', async () => {
    const c = mockClient([])
    await repo.listCommissionRules(c, APP, TEN, { practitionerId: PRAC, serviceId: SVC })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/practitioner_id = \$3/)
    expect(sql).toMatch(/\(service_id = \$4 OR service_id IS NULL\)/)
    expect(params).toEqual([APP, TEN, PRAC, SVC])
  })
})

describe('findApplicableRule', () => {
  it('SELECT con preferencia de service específico; sin row → null', async () => {
    const c = mockClient([])
    expect(await repo.findApplicableRule(c, APP, TEN, PRAC, SVC, '2026-05-01')).toBeNull()
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/ORDER BY \(service_id IS NULL\) ASC, effective_from DESC/)
    expect(sql).toMatch(/LIMIT 1/)
    expect(params).toEqual([APP, TEN, PRAC, SVC, '2026-05-01'])
  })

  it('devuelve el row cuando existe', async () => {
    const c = mockClient([{ id: 'r1' }])
    expect(await repo.findApplicableRule(c, APP, TEN, PRAC, SVC, 'now')).toEqual({ id: 'r1' })
  })
})

describe('insertAccrual', () => {
  it('INSERT con defaults', async () => {
    const c = mockClient([{ id: 'a1' }])
    await repo.insertAccrual(c, APP, TEN, { practitionerId: PRAC, grossCents: 1000, commissionCents: 300 })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_practitioner_payouts\.accruals/)
    expect(params[3]).toBeNull()         // serviceId
    expect(params[4]).toBeNull()         // bookingId
    expect(params[7]).toBe('accrued')    // status default
    expect(params[8]).toBeNull()         // occurredAt
    expect(params[9]).toEqual({})        // metadata default
  })
})

describe('listAccruals', () => {
  it('sin filtros → solo app/tenant', async () => {
    const c = mockClient([])
    await repo.listAccruals(c, APP, TEN)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/ORDER BY occurred_at DESC/)
    expect(params).toEqual([APP, TEN])
  })

  it('con todos los filtros → índices encadenados', async () => {
    const c = mockClient([])
    await repo.listAccruals(c, APP, TEN, { practitionerId: PRAC, status: 'accrued', from: 'f', to: 't' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/practitioner_id = \$3/)
    expect(sql).toMatch(/status = \$4/)
    expect(sql).toMatch(/occurred_at >= \$5/)
    expect(sql).toMatch(/occurred_at <  \$6/)
    expect(params).toEqual([APP, TEN, PRAC, 'accrued', 'f', 't'])
  })
})

describe('findAccrualByBooking', () => {
  it('SELECT por booking_id con LIMIT 1; sin row → null', async () => {
    const c = mockClient([])
    expect(await repo.findAccrualByBooking(c, APP, TEN, 'b1')).toBeNull()
    expect(c.query.mock.calls[0][0]).toMatch(/booking_id=\$3 LIMIT 1/)
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, 'b1'])
  })
})

describe('reverseAccrual', () => {
  it("UPDATE status='reversed' scoped; sin row → null", async () => {
    const c = mockClient([])
    expect(await repo.reverseAccrual(c, APP, TEN, 'a1')).toBeNull()
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/SET status='reversed'/)
    expect(params).toEqual([APP, TEN, 'a1'])
  })
})

describe('insertPayout', () => {
  it('INSERT con currency/status defaults', async () => {
    const c = mockClient([{ id: 'pay1' }])
    await repo.insertPayout(c, APP, TEN, {
      practitionerId: PRAC, periodStart: 's', periodEnd: 'e', totalCommissionCents: 5000,
    })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_practitioner_payouts\.payouts/)
    expect(params[6]).toBe('EUR')      // currency default
    expect(params[7]).toBe('pending')  // status default
    expect(params[8]).toBeNull()       // notes
  })
})

describe('attachAccrualsToPayout', () => {
  it("UPDATE accruals a paid; suma commission_cents devueltos", async () => {
    const c = mockClient([{ commission_cents: '300' }, { commission_cents: '700' }])
    const total = await repo.attachAccrualsToPayout(c, APP, TEN, 'pay1', PRAC, 's', 'e')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/SET status='paid', payout_id=\$3/)
    expect(sql).toMatch(/status='accrued'/)
    expect(params).toEqual([APP, TEN, 'pay1', PRAC, 's', 'e'])
    expect(total).toBe(1000)
  })

  it('sin filas → suma 0', async () => {
    const c = mockClient([])
    expect(await repo.attachAccrualsToPayout(c, APP, TEN, 'pay1', PRAC, 's', 'e')).toBe(0)
  })
})

describe('setPayoutStatus', () => {
  it("status=paid → stampa paid_at=now() y sin externalRef", async () => {
    const c = mockClient([{ id: 'pay1', status: 'paid' }])
    await repo.setPayoutStatus(c, APP, TEN, 'pay1', 'paid')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/paid_at = now\(\)/)
    expect(sql).not.toMatch(/external_ref/)
    expect(params).toEqual([APP, TEN, 'pay1', 'paid'])
  })

  it('con externalRef → set adicional con índice correcto', async () => {
    const c = mockClient([{ id: 'pay1' }])
    await repo.setPayoutStatus(c, APP, TEN, 'pay1', 'paid', 'ext1')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/external_ref = \$5/)
    expect(params).toEqual([APP, TEN, 'pay1', 'paid', 'ext1'])
  })

  it('status no-paid sin ref → solo status; row inexistente → null', async () => {
    const c = mockClient([])
    expect(await repo.setPayoutStatus(c, APP, TEN, 'pay1', 'cancelled')).toBeNull()
    const sql = c.query.mock.calls[0][0]
    expect(sql).not.toMatch(/paid_at/)
    expect(sql).not.toMatch(/external_ref/)
  })
})

describe('findPayoutById', () => {
  it('SELECT scoped; sin row → null', async () => {
    const c = mockClient([])
    expect(await repo.findPayoutById(c, APP, TEN, 'pay1')).toBeNull()
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, 'pay1'])
  })
})

describe('listPayouts', () => {
  it('sin filtros → solo app/tenant; ORDER BY period_end DESC', async () => {
    const c = mockClient([])
    await repo.listPayouts(c, APP, TEN)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/ORDER BY period_end DESC/)
    expect(params).toEqual([APP, TEN])
  })

  it('con practitionerId + status → filtros con índices', async () => {
    const c = mockClient([])
    await repo.listPayouts(c, APP, TEN, { practitionerId: PRAC, status: 'pending' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/practitioner_id = \$3/)
    expect(sql).toMatch(/status = \$4/)
    expect(params).toEqual([APP, TEN, PRAC, 'pending'])
  })
})
