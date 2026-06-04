// pos.splitBill + tip + totals + payment FSM.
// Contrato split:
//   - mode='equal':
//       · shares < 2 → ValidationError.
//       · floor(total/n) reparto + remainders (centavos) distribuidos a los primeros índices.
//   - mode='percent':
//       · sum != 100 → ValidationError.
//       · cada split = round(total * (p/100)).
//   - mode='amounts':
//       · sum != total → ValidationError.
//       · usa los amounts tal cual.
//   - mode desconocido → ValidationError.
//   - bill.status != 'open' → ConflictError "can only split open bills".
//   - Tras split: status='split' + publish 'pos.bill.split' con count.
// Contrato tip + totals:
//   - tip se suma a subtotal+tax (TAX_RATE=0.10 hardcoded por default).
//   - Si todo cents → number coerce (BIGINT vuelve como string desde pg).
//   - addItem en bill cerrado → ConflictError.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../lib/db.js', () => ({ pool: {}, withTenantTransaction: vi.fn() }))
vi.mock('../lib/redis.js', () => ({ publish: vi.fn() }))
vi.mock('../repositories/pos.repository.js')

import { splitBill, addItem, payBill, closeBill } from '../services/pos.service.js'
import { withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as repo from '../repositories/pos.repository.js'

const ctx = { appId: 'demo-restaurant', tenantId: 't1', subTenantId: null, userId: 'svr-1' }

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn({}))
  // safe defaults for repo fns consulted by addItem / loadFullBill
  repo.insertBillItem.mockResolvedValue({ id: 'it1', sku: 'X', name: 'X', qty: 1, course: 'main', modifiers: [] })
  repo.listSplitItems.mockResolvedValue([])
  repo.getSettings.mockResolvedValue(null)
})

// ── splitBill — equal ───────────────────────────────────────────────

describe('splitBill mode="equal"', () => {
  it('shares < 2 → ValidationError', async () => {
    repo.findBillById.mockResolvedValue({ id: 'b1', status: 'open', total_cents: 1000 })
    await expect(splitBill(ctx, 'b1', 'equal', { shares: 1 })).rejects.toMatchObject({ statusCode: 422 })
  })

  it('total múltiplo del n: sin remainders → todos iguales', async () => {
    repo.findBillById.mockResolvedValue({ id: 'b1', status: 'open', total_cents: 4000 })
    repo.insertSplit.mockImplementation(async (_c, args) => ({ ...args, paid: false }))
    const r = await splitBill(ctx, 'b1', 'equal', { shares: 4 })
    expect(r.map((s) => s.amountCents)).toEqual([1000, 1000, 1000, 1000])
  })

  it('total NO múltiplo: remainders se dan a los primeros (1, 1, 0, 0)', async () => {
    repo.findBillById.mockResolvedValue({ id: 'b1', status: 'open', total_cents: 1002 })
    repo.insertSplit.mockImplementation(async (_c, args) => ({ ...args, paid: false }))
    const r = await splitBill(ctx, 'b1', 'equal', { shares: 4 })
    // floor(1002/4)=250, rem=2 → 251, 251, 250, 250
    expect(r.map((s) => s.amountCents)).toEqual([251, 251, 250, 250])
    // suma = total
    expect(r.reduce((s, x) => s + x.amountCents, 0)).toBe(1002)
  })

  it('total_cents llega como string (BIGINT) → se coerciona a number', async () => {
    repo.findBillById.mockResolvedValue({ id: 'b1', status: 'open', total_cents: '1000' })
    repo.insertSplit.mockImplementation(async (_c, args) => ({ ...args }))
    const r = await splitBill(ctx, 'b1', 'equal', { shares: 2 })
    expect(r.map((s) => s.amountCents)).toEqual([500, 500])
  })

  it('shares default = 2 cuando no se pasa', async () => {
    repo.findBillById.mockResolvedValue({ id: 'b1', status: 'open', total_cents: 1000 })
    repo.insertSplit.mockImplementation(async (_c, args) => ({ ...args }))
    const r = await splitBill(ctx, 'b1', 'equal', {})
    expect(r).toHaveLength(2)
  })
})

// ── splitBill — percent ────────────────────────────────────────────

describe('splitBill mode="percent"', () => {
  it('sum != 100 → ValidationError', async () => {
    repo.findBillById.mockResolvedValue({ id: 'b1', status: 'open', total_cents: 1000 })
    await expect(splitBill(ctx, 'b1', 'percent', { percents: [30, 40] })).rejects.toMatchObject({ statusCode: 422 })
    await expect(splitBill(ctx, 'b1', 'percent', { percents: [33.33, 33.33, 33.33] })).rejects.toMatchObject({ statusCode: 422 })
  })

  it('sum = 100 ± 0.01 (rounding tolerance) → OK', async () => {
    repo.findBillById.mockResolvedValue({ id: 'b1', status: 'open', total_cents: 1000 })
    repo.insertSplit.mockImplementation(async (_c, args) => ({ ...args }))
    const r = await splitBill(ctx, 'b1', 'percent', { percents: [33.34, 33.33, 33.33] })
    expect(r).toHaveLength(3)
  })

  it('reparte total * (p/100) redondeado', async () => {
    repo.findBillById.mockResolvedValue({ id: 'b1', status: 'open', total_cents: 1000 })
    repo.insertSplit.mockImplementation(async (_c, args) => ({ ...args }))
    const r = await splitBill(ctx, 'b1', 'percent', { percents: [60, 40] })
    expect(r.map((s) => s.amountCents)).toEqual([600, 400])
  })
})

// ── splitBill — amounts ────────────────────────────────────────────

describe('splitBill mode="amounts"', () => {
  it('sum != total → ValidationError', async () => {
    repo.findBillById.mockResolvedValue({ id: 'b1', status: 'open', total_cents: 1000 })
    await expect(splitBill(ctx, 'b1', 'amounts', { amountsCents: [400, 400] })).rejects.toMatchObject({ statusCode: 422 })
  })

  it('sum = total → usa amounts tal cual', async () => {
    repo.findBillById.mockResolvedValue({ id: 'b1', status: 'open', total_cents: 1000 })
    repo.insertSplit.mockImplementation(async (_c, args) => ({ ...args }))
    const r = await splitBill(ctx, 'b1', 'amounts', { amountsCents: [700, 300] })
    expect(r.map((s) => s.amountCents)).toEqual([700, 300])
  })
})

// ── splitBill — invariantes ─────────────────────────────────────────

describe('splitBill — guards e invariantes', () => {
  it('mode desconocido → ValidationError', async () => {
    repo.findBillById.mockResolvedValue({ id: 'b1', status: 'open', total_cents: 1000 })
    await expect(splitBill(ctx, 'b1', 'banana')).rejects.toMatchObject({ statusCode: 422 })
  })

  it('bill no existe → NotFoundError 404', async () => {
    repo.findBillById.mockResolvedValue(null)
    await expect(splitBill(ctx, 'ghost', 'equal')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('bill.status="paid" → ConflictError "can only split open bills"', async () => {
    repo.findBillById.mockResolvedValue({ id: 'b1', status: 'paid', total_cents: 1000 })
    await expect(splitBill(ctx, 'b1', 'equal')).rejects.toMatchObject({
      statusCode: 409, message: expect.stringContaining('open'),
    })
  })

  it('tras split: status → "split" + publish pos.bill.split', async () => {
    repo.findBillById.mockResolvedValue({ id: 'b1', status: 'open', total_cents: 2000 })
    repo.insertSplit.mockImplementation(async (_c, args) => ({ ...args }))
    await splitBill(ctx, 'b1', 'equal', { shares: 2 })
    expect(repo.setBillStatus).toHaveBeenCalledWith(expect.anything(), ctx.appId, ctx.tenantId, 'b1', 'split')
    expect(publish).toHaveBeenCalledWith({
      type: 'pos.bill.split',
      payload: { appId: ctx.appId, tenantId: ctx.tenantId, billId: 'b1', mode: 'equal', count: 2 },
    })
  })
})

// ── addItem + computeTotals (tip) ────────────────────────────────────

describe('addItem + tip handling', () => {
  it('addItem en bill no-open → ConflictError', async () => {
    repo.findBillById.mockResolvedValue({ id: 'b1', status: 'split' })
    await expect(addItem(ctx, 'b1', { sku: 'X', qty: 1, unit_price_cents: 100 }))
      .rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('not open') })
  })

  it('tip se suma a total: subtotal + tax(10%) + tip', async () => {
    repo.findBillById.mockResolvedValue({ id: 'b1', status: 'open', tip_cents: 200 })
    repo.listItemsByBill.mockResolvedValue([{ unit_price_cents: 1000, qty: 1 }])
    repo.setBillTotals.mockImplementation(async (_c, _a, _t, _id, totals) => totals)
    const r = await addItem(ctx, 'b1', { sku: 'X', qty: 1, unit_price_cents: 1000 })
    // subtotal=1000, tax=100, tip=200 → total=1300
    expect(r).toEqual({ subtotal: 1000, tax: 100, tip: 200, total: 1300 })
  })

  it('total propaga BIGINT-as-string: items y tip se coercen sin concat', async () => {
    repo.findBillById.mockResolvedValue({ id: 'b1', status: 'open', tip_cents: '50' })
    repo.listItemsByBill.mockResolvedValue([{ unit_price_cents: '500', qty: '2' }])
    repo.setBillTotals.mockImplementation(async (_c, _a, _t, _id, totals) => totals)
    const r = await addItem(ctx, 'b1', { sku: 'X', qty: 1, unit_price_cents: 100 })
    // subtotal=1000, tax=100, tip=50 → total=1150
    expect(r.total).toBe(1150)
    expect(typeof r.subtotal).toBe('number')
  })

  it('tax = round(subtotal * 0.10) (rate fija; tenants override vía metadata.taxRate fuera de scope)', async () => {
    repo.findBillById.mockResolvedValue({ id: 'b1', status: 'open', tip_cents: 0 })
    repo.listItemsByBill.mockResolvedValue([{ unit_price_cents: 333, qty: 1 }])
    repo.setBillTotals.mockImplementation(async (_c, _a, _t, _id, totals) => totals)
    const r = await addItem(ctx, 'b1', { sku: 'X', qty: 1, unit_price_cents: 333 })
    // 333 * 0.10 = 33.3 → round → 33
    expect(r.tax).toBe(33)
  })
})

// ── payBill FSM transitions ─────────────────────────────────────────

describe('payBill', () => {
  it('bill closed → ConflictError', async () => {
    repo.findBillById.mockResolvedValue({ id: 'b1', status: 'closed' })
    await expect(payBill(ctx, 'b1', { amount_cents: 100 })).rejects.toMatchObject({ statusCode: 409 })
  })

  it('split paid → marca el split + bill queda en split hasta que TODOS pagados', async () => {
    repo.findBillById.mockResolvedValue({ id: 'b1', status: 'split', total_cents: 1000, tip_cents: 0 })
    repo.insertPayment.mockResolvedValue({ id: 'p1' })
    repo.listSplits.mockResolvedValue([{ paid: true }, { paid: false }])  // queda 1 sin pagar
    repo.listItemsByBill.mockResolvedValue([])
    repo.listPaymentsByBill.mockResolvedValue([])
    await payBill(ctx, 'b1', { splitId: 'sp-1', amount_cents: 500 })
    expect(repo.markSplitPaid).toHaveBeenCalledWith(expect.anything(), ctx.appId, ctx.tenantId, 'sp-1', 'p1')
    // status NO se marca paid todavía (queda 1 split sin pagar)
    expect(repo.setBillStatus).not.toHaveBeenCalled()
  })

  it('último split → status="paid" + publish pos.bill.paid', async () => {
    // 1ª lookup: bill aún en split. 2ª lookup (dentro de loadFullBill): bill ya paid.
    repo.findBillById
      .mockResolvedValueOnce({ id: 'b1', status: 'split', total_cents: 1000, tip_cents: 0, table_id: 'tbl-1' })
      .mockResolvedValueOnce({ id: 'b1', status: 'paid',  total_cents: 1000, tip_cents: 0, table_id: 'tbl-1' })
    repo.insertPayment.mockResolvedValue({ id: 'p1' })
    repo.listSplits.mockResolvedValue([{ paid: true }, { paid: true }])
    repo.listItemsByBill.mockResolvedValue([{ sku: 'X', name: 'X', qty: 1, course: 'main', modifiers: [] }])
    repo.listPaymentsByBill.mockResolvedValue([])
    await payBill(ctx, 'b1', { splitId: 'sp-2', amount_cents: 500 })
    expect(repo.setBillStatus).toHaveBeenCalledWith(expect.anything(), ctx.appId, ctx.tenantId, 'b1', 'paid')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'pos.bill.paid' }))
  })

  it('payment full (no split) suficiente para cubrir total → "paid"', async () => {
    repo.findBillById.mockResolvedValue({ id: 'b1', status: 'open', total_cents: 1000, tip_cents: 0, table_id: 'tbl-1' })
    repo.insertPayment.mockResolvedValue({ id: 'p1' })
    repo.listPaymentsByBill.mockResolvedValue([{ amount_cents: 1000 }])
    repo.listItemsByBill.mockResolvedValue([])
    repo.listSplits.mockResolvedValue([])
    await payBill(ctx, 'b1', { amount_cents: 1000 })
    expect(repo.setBillStatus).toHaveBeenCalledWith(expect.anything(), ctx.appId, ctx.tenantId, 'b1', 'paid')
  })

  it('payment parcial → bill sigue open', async () => {
    repo.findBillById.mockResolvedValue({ id: 'b1', status: 'open', total_cents: 1000, tip_cents: 0 })
    repo.insertPayment.mockResolvedValue({ id: 'p1' })
    repo.listPaymentsByBill.mockResolvedValue([{ amount_cents: 400 }])
    repo.listItemsByBill.mockResolvedValue([])
    repo.listSplits.mockResolvedValue([])
    await payBill(ctx, 'b1', { amount_cents: 400 })
    expect(repo.setBillStatus).not.toHaveBeenCalled()
  })
})

// ── closeBill ───────────────────────────────────────────────────────

describe('closeBill', () => {
  it('solo bills paid se cierran → ConflictError si status != paid', async () => {
    repo.findBillById.mockResolvedValue({ id: 'b1', status: 'open' })
    await expect(closeBill(ctx, 'b1')).rejects.toMatchObject({ statusCode: 409 })
  })

  it('happy: status → closed + publish pos.bill.closed', async () => {
    repo.findBillById.mockResolvedValue({ id: 'b1', status: 'paid', total_cents: 1000 })
    repo.setBillStatus.mockResolvedValue({ id: 'b1', total_cents: 1000, status: 'closed' })
    await closeBill(ctx, 'b1')
    expect(publish).toHaveBeenCalledWith({
      type: 'pos.bill.closed',
      payload: { appId: ctx.appId, tenantId: ctx.tenantId, billId: 'b1', totalCents: 1000 },
    })
  })
})
