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
}))
vi.mock('../repositories/pos.repository.js')

import * as service from '../services/pos.service.js'
import { withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as repo from '../repositories/pos.repository.js'
import { ConflictError, NotFoundError, ValidationError } from '@apphub/platform-sdk/errors'

const APP_ID    = 'yoga-studio'
const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const BILL_ID   = '11111111-1111-1111-1111-111111111111'
const PAY_ID    = '22222222-2222-2222-2222-222222222222'

const ctx = { appId: APP_ID, tenantId: TENANT_ID, subTenantId: null, userId: 'u1', role: 'server' }

function mockClient() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }
}

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(mockClient()))
  // safe defaults for repo fns consulted by loadFullBill / addItem
  repo.listSplitItems.mockResolvedValue([])
  repo.getSettings.mockResolvedValue(null)
})

// ── openBill ────────────────────────────────────────────────────────────
describe('openBill', () => {
  it('persists, scopes to tenant, emits pos.bill.opened', async () => {
    repo.insertBill.mockResolvedValue({ id: BILL_ID, table_id: 'tab1' })
    await service.openBill(ctx, { tableCode: 'T1' })
    expect(repo.insertBill).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      appId: APP_ID, tenantId: TENANT_ID, serverUserId: 'u1', tableCode: 'T1',
    }))
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'pos.bill.opened' }))
  })
})

// ── addItem ─────────────────────────────────────────────────────────────
describe('addItem', () => {
  it('throws when bill missing', async () => {
    repo.findBillById.mockResolvedValue(null)
    await expect(service.addItem(ctx, BILL_ID, { sku: 'X', name: 'X', qty: 1, unitPriceCents: 100 }))
      .rejects.toThrow(NotFoundError)
  })

  it('throws when bill not open', async () => {
    repo.findBillById.mockResolvedValue({ id: BILL_ID, status: 'paid', tip_cents: 0 })
    await expect(service.addItem(ctx, BILL_ID, { sku: 'X', name: 'X', qty: 1, unitPriceCents: 100 }))
      .rejects.toThrow(ConflictError)
  })

  it('inserts item and recomputes totals (subtotal + 10% tax)', async () => {
    repo.findBillById.mockResolvedValue({ id: BILL_ID, status: 'open', tip_cents: 0 })
    repo.insertBillItem.mockResolvedValue({ id: 'it1', sku: 'X', name: 'X', qty: 2, course: 'main', modifiers: [] })
    repo.listItemsByBill.mockResolvedValue([{ unit_price_cents: 1000, qty: 2 }])
    repo.setBillTotals.mockResolvedValue({ id: BILL_ID, subtotal_cents: 2000, tax_cents: 200, total_cents: 2200 })

    const result = await service.addItem(ctx, BILL_ID, { sku: 'X', name: 'X', qty: 2, unitPriceCents: 1000 })

    expect(repo.setBillTotals).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, BILL_ID, {
      subtotal: 2000, tax: 200, tip: 0, total: 2200,
    })
    expect(result.total_cents).toBe(2200)
  })
})

// ── splitBill ───────────────────────────────────────────────────────────
describe('splitBill', () => {
  it('rejects on closed bill', async () => {
    repo.findBillById.mockResolvedValue({ id: BILL_ID, status: 'paid', total_cents: 1000 })
    await expect(service.splitBill(ctx, BILL_ID, 'equal', { shares: 2 })).rejects.toThrow(ConflictError)
  })

  it('throws ValidationError for unknown mode', async () => {
    repo.findBillById.mockResolvedValue({ id: BILL_ID, status: 'open', total_cents: 1000 })
    await expect(service.splitBill(ctx, BILL_ID, 'foo', {})).rejects.toThrow(ValidationError)
  })

  it('equal mode distributes amount with rounding remainder on first share(s)', async () => {
    repo.findBillById.mockResolvedValue({ id: BILL_ID, status: 'open', total_cents: 1003 })
    repo.insertSplit.mockImplementation(async (_c, s) => ({ ...s, id: 'sp-' + s.shareIndex }))
    repo.setBillStatus.mockResolvedValue()

    const splits = await service.splitBill(ctx, BILL_ID, 'equal', { shares: 3 })
    // floor(1003/3)=334; remainder=1; first share gets +1.
    expect(splits.map((s) => s.amountCents)).toEqual([335, 334, 334])
    expect(repo.setBillStatus).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, BILL_ID, 'split')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'pos.bill.split' }))
  })

  it('equal mode rejects shares < 2', async () => {
    repo.findBillById.mockResolvedValue({ id: BILL_ID, status: 'open', total_cents: 100 })
    await expect(service.splitBill(ctx, BILL_ID, 'equal', { shares: 1 })).rejects.toThrow(ValidationError)
  })

  it('percent mode requires percents to sum to 100', async () => {
    repo.findBillById.mockResolvedValue({ id: BILL_ID, status: 'open', total_cents: 1000 })
    await expect(service.splitBill(ctx, BILL_ID, 'percent', { percents: [40, 40] })).rejects.toThrow(ValidationError)
  })

  it('percent mode applies share rounding', async () => {
    repo.findBillById.mockResolvedValue({ id: BILL_ID, status: 'open', total_cents: 1000 })
    repo.insertSplit.mockImplementation(async (_c, s) => ({ ...s, id: 's' }))
    repo.setBillStatus.mockResolvedValue()
    const splits = await service.splitBill(ctx, BILL_ID, 'percent', { percents: [60, 40] })
    expect(splits.map((s) => s.amountCents)).toEqual([600, 400])
  })

  it('amounts mode requires sum = bill total', async () => {
    repo.findBillById.mockResolvedValue({ id: BILL_ID, status: 'open', total_cents: 1000 })
    await expect(service.splitBill(ctx, BILL_ID, 'amounts', { amountsCents: [400, 400] }))
      .rejects.toThrow(ValidationError)
  })

  it('amounts mode succeeds when sum matches', async () => {
    repo.findBillById.mockResolvedValue({ id: BILL_ID, status: 'open', total_cents: 1000 })
    repo.insertSplit.mockImplementation(async (_c, s) => ({ ...s, id: 's' }))
    repo.setBillStatus.mockResolvedValue()
    const splits = await service.splitBill(ctx, BILL_ID, 'amounts', { amountsCents: [600, 400] })
    expect(splits).toHaveLength(2)
  })
})

// ── payBill ─────────────────────────────────────────────────────────────
describe('payBill', () => {
  function billWithTotals(total, status = 'open') {
    return { id: BILL_ID, status, total_cents: total, tip_cents: 0, table_id: 'tab1' }
  }

  it('rejects when bill is in terminal status', async () => {
    repo.findBillById.mockResolvedValue(billWithTotals(1000, 'paid'))
    await expect(service.payBill(ctx, BILL_ID, { method: 'card', amountCents: 1000 }))
      .rejects.toThrow(ConflictError)
  })

  it('partial payment leaves bill in open status (no pos.bill.paid event)', async () => {
    repo.findBillById
      .mockResolvedValueOnce(billWithTotals(1000))                  // initial check
      .mockResolvedValueOnce(billWithTotals(1000))                  // loadFullBill
    repo.insertPayment.mockResolvedValue({ id: PAY_ID, amount_cents: 400 })
    repo.listPaymentsByBill.mockResolvedValue([{ amount_cents: 400 }])
    repo.listItemsByBill.mockResolvedValue([])
    repo.listSplits.mockResolvedValue([])

    await service.payBill(ctx, BILL_ID, { method: 'card', amountCents: 400 })
    expect(publish).not.toHaveBeenCalled()
    expect(repo.setBillStatus).not.toHaveBeenCalled()
  })

  it('full payment marks bill paid and emits pos.bill.paid', async () => {
    repo.findBillById
      .mockResolvedValueOnce(billWithTotals(1000))
      .mockResolvedValueOnce({ ...billWithTotals(1000), status: 'paid' })
    repo.insertPayment.mockResolvedValue({ id: PAY_ID, amount_cents: 1000 })
    repo.listPaymentsByBill.mockResolvedValue([{ amount_cents: 1000 }])
    repo.setBillStatus.mockResolvedValue()
    repo.listItemsByBill.mockResolvedValue([{ sku: 'X', name: 'X', qty: 1, course: 'main', modifiers: [] }])
    repo.listSplits.mockResolvedValue([])

    const result = await service.payBill(ctx, BILL_ID, { method: 'card', amountCents: 1000 })
    expect(repo.setBillStatus).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, BILL_ID, 'paid')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'pos.bill.paid',
      payload: expect.objectContaining({ orderId: BILL_ID, totalCents: 1000 }),
    }))
    expect(result.status).toBe('paid')
  })

  it('pays a single split — keeps bill split until all splits paid', async () => {
    repo.findBillById
      .mockResolvedValueOnce({ id: BILL_ID, status: 'split', total_cents: 1000, tip_cents: 0, table_id: 'tab1' })
      .mockResolvedValueOnce({ id: BILL_ID, status: 'split', total_cents: 1000, tip_cents: 0, table_id: 'tab1' })
    repo.insertPayment.mockResolvedValue({ id: PAY_ID, amount_cents: 500 })
    repo.markSplitPaid.mockResolvedValue({ id: 'sp1', paid: true })
    repo.listSplits.mockResolvedValue([{ id: 'sp1', paid: true }, { id: 'sp2', paid: false }])
    repo.listItemsByBill.mockResolvedValue([])
    repo.listPaymentsByBill.mockResolvedValue([])

    await service.payBill(ctx, BILL_ID, { method: 'card', amountCents: 500, splitId: 'sp1' })
    expect(repo.markSplitPaid).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, 'sp1', PAY_ID)
    // not all paid yet → no setBillStatus
    expect(repo.setBillStatus).not.toHaveBeenCalled()
  })

  it('marks bill paid when all splits become paid', async () => {
    repo.findBillById
      .mockResolvedValueOnce({ id: BILL_ID, status: 'split', total_cents: 1000, tip_cents: 0, table_id: null })
      .mockResolvedValueOnce({ id: BILL_ID, status: 'paid',  total_cents: 1000, tip_cents: 0, table_id: null })
    repo.insertPayment.mockResolvedValue({ id: PAY_ID, amount_cents: 500 })
    repo.markSplitPaid.mockResolvedValue({ id: 'sp2', paid: true })
    repo.listSplits.mockResolvedValue([{ id: 'sp1', paid: true }, { id: 'sp2', paid: true }])
    repo.setBillStatus.mockResolvedValue()
    repo.listItemsByBill.mockResolvedValue([])
    repo.listPaymentsByBill.mockResolvedValue([])

    await service.payBill(ctx, BILL_ID, { method: 'card', amountCents: 500, splitId: 'sp2' })
    expect(repo.setBillStatus).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, BILL_ID, 'paid')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'pos.bill.paid' }))
  })
})

// ── closeBill ───────────────────────────────────────────────────────────
describe('closeBill', () => {
  it('only allows closing paid bills', async () => {
    repo.findBillById.mockResolvedValue({ id: BILL_ID, status: 'open' })
    await expect(service.closeBill(ctx, BILL_ID)).rejects.toThrow(ConflictError)
  })

  it('throws NotFoundError if bill missing', async () => {
    repo.findBillById.mockResolvedValue(null)
    await expect(service.closeBill(ctx, BILL_ID)).rejects.toThrow(NotFoundError)
  })

  it('closes a paid bill and emits pos.bill.closed', async () => {
    repo.findBillById.mockResolvedValue({ id: BILL_ID, status: 'paid' })
    repo.setBillStatus.mockResolvedValue({ id: BILL_ID, status: 'closed', total_cents: 1500 })
    await service.closeBill(ctx, BILL_ID)
    expect(repo.setBillStatus).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, BILL_ID, 'closed')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'pos.bill.closed' }))
  })
})

// ── getBill / listBills ─────────────────────────────────────────────────
describe('getBill / listBills', () => {
  it('getBill returns bill with items, payments, splits (+itemIds) and tipSuggestions', async () => {
    repo.findBillById.mockResolvedValue({ id: BILL_ID, status: 'open', total_cents: 1000 })
    repo.listItemsByBill.mockResolvedValue([{ sku: 'X' }])
    repo.listPaymentsByBill.mockResolvedValue([{ id: PAY_ID }])
    repo.listSplits.mockResolvedValue([{ id: 'sp1' }])
    repo.listSplitItems.mockResolvedValue([{ split_id: 'sp1', bill_item_id: 'it1' }])
    repo.getSettings.mockResolvedValue({ tip_suggestions: [10, 15], tip_allow_custom: true })
    const result = await service.getBill(ctx, BILL_ID)
    expect(result).toEqual(expect.objectContaining({
      id: BILL_ID, items: [{ sku: 'X' }], payments: [{ id: PAY_ID }],
      splits: [{ id: 'sp1', itemIds: ['it1'] }],
    }))
    expect(result.tipSuggestions.options).toEqual([
      { percent: 10, tipCents: 100 }, { percent: 15, tipCents: 150 },
    ])
  })

  it('getBill throws NotFoundError when missing', async () => {
    repo.findBillById.mockResolvedValue(null)
    await expect(service.getBill(ctx, BILL_ID)).rejects.toThrow(NotFoundError)
  })

  it('listBills passes filters through', async () => {
    repo.listBills.mockResolvedValue([])
    await service.listBills(ctx, { status: 'open', tableId: 'tab1' })
    expect(repo.listBills).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, { status: 'open', tableId: 'tab1' })
  })
})

// ── cancelBill (#1) ───────────────────────────────────────────────────────
describe('cancelBill', () => {
  it('throws NotFoundError when bill missing', async () => {
    repo.findBillById.mockResolvedValue(null)
    await expect(service.cancelBill(ctx, BILL_ID, 'x')).rejects.toThrow(NotFoundError)
  })

  it('rejects cancelling a paid bill', async () => {
    repo.findBillById.mockResolvedValue({ id: BILL_ID, status: 'paid' })
    await expect(service.cancelBill(ctx, BILL_ID, 'x')).rejects.toThrow(ConflictError)
  })

  it('cancels an open bill, records actor + reason, emits pos.bill.cancelled', async () => {
    repo.findBillById.mockResolvedValue({ id: BILL_ID, status: 'open' })
    repo.cancelBill.mockResolvedValue({ id: BILL_ID, status: 'cancelled', table_id: 'tab1' })
    const res = await service.cancelBill(ctx, BILL_ID, 'cliente se fue')
    expect(repo.cancelBill).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, BILL_ID, 'u1', 'cliente se fue')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'pos.bill.cancelled',
      payload: expect.objectContaining({ cancelledBy: 'u1', reason: 'cliente se fue' }),
    }))
    expect(res.status).toBe('cancelled')
  })

  it('allows cancelling a split bill', async () => {
    repo.findBillById.mockResolvedValue({ id: BILL_ID, status: 'split' })
    repo.cancelBill.mockResolvedValue({ id: BILL_ID, status: 'cancelled' })
    await service.cancelBill(ctx, BILL_ID, null)
    expect(repo.cancelBill).toHaveBeenCalled()
  })
})

// ── fireBill (#3) ─────────────────────────────────────────────────────────
describe('fireBill', () => {
  it('throws NotFoundError when bill missing', async () => {
    repo.findBillById.mockResolvedValue(null)
    await expect(service.fireBill(ctx, BILL_ID)).rejects.toThrow(NotFoundError)
  })

  it('rejects firing a closed bill', async () => {
    repo.findBillById.mockResolvedValue({ id: BILL_ID, status: 'closed' })
    await expect(service.fireBill(ctx, BILL_ID)).rejects.toThrow(ConflictError)
  })

  it('fires unfired items and emits pos.bill.fired', async () => {
    repo.findBillById.mockResolvedValue({ id: BILL_ID, status: 'open', table_id: 'tab1' })
    repo.markItemsFired.mockResolvedValue([{ id: 'it1', sku: 'X', name: 'X', qty: 1, course: 'main', modifiers: [], notes: null }])
    const res = await service.fireBill(ctx, BILL_ID, ['it1'])
    expect(repo.markItemsFired).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, BILL_ID, ['it1'])
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'pos.bill.fired',
      payload: expect.objectContaining({ orderId: BILL_ID }),
    }))
    expect(res.firedCount).toBe(1)
  })

  it('does not emit when nothing new fired (idempotent re-fire)', async () => {
    repo.findBillById.mockResolvedValue({ id: BILL_ID, status: 'open' })
    repo.markItemsFired.mockResolvedValue([])
    const res = await service.fireBill(ctx, BILL_ID)
    expect(publish).not.toHaveBeenCalled()
    expect(res.firedCount).toBe(0)
  })
})

// ── settings (#5) ─────────────────────────────────────────────────────────
describe('settings', () => {
  it('getSettings returns defaults when no row', async () => {
    repo.getSettings.mockResolvedValue(null)
    const res = await service.getSettings(ctx)
    expect(res).toMatchObject({ tip_suggestions: [], tip_allow_custom: true, default_tax_rate: null })
  })

  it('getSettings returns stored row', async () => {
    repo.getSettings.mockResolvedValue({ tip_suggestions: [10, 15], tip_allow_custom: false })
    const res = await service.getSettings(ctx)
    expect(res.tip_suggestions).toEqual([10, 15])
  })

  it('updateSettings upserts mapped fields', async () => {
    repo.upsertSettings.mockResolvedValue({ tip_suggestions: [10] })
    await service.updateSettings(ctx, { tipSuggestions: [10], tipAllowCustom: false, defaultTaxRate: 0.21 })
    expect(repo.upsertSettings).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      appId: APP_ID, tenantId: TENANT_ID, tipSuggestions: [10], tipAllowCustom: false, defaultTaxRate: 0.21,
    }))
  })
})

// ── splitBill items mode (#6) ─────────────────────────────────────────────
describe('splitBill items mode', () => {
  function openBill() {
    return { id: BILL_ID, status: 'open', total_cents: 3300, metadata: {} }
  }

  it('rejects when an assignment references a foreign item', async () => {
    repo.findBillById.mockResolvedValue(openBill())
    repo.listItemsByBill.mockResolvedValue([{ id: 'it1', unit_price_cents: 1000, qty: 1 }])
    repo.getSettings.mockResolvedValue(null)
    await expect(service.splitBill(ctx, BILL_ID, 'items', { assignments: [{ itemIds: ['nope'] }] }))
      .rejects.toThrow(ValidationError)
  })

  it('rejects when an item is assigned to two shares', async () => {
    repo.findBillById.mockResolvedValue(openBill())
    repo.listItemsByBill.mockResolvedValue([{ id: 'it1', unit_price_cents: 1000, qty: 1 }])
    repo.getSettings.mockResolvedValue(null)
    await expect(service.splitBill(ctx, BILL_ID, 'items', {
      assignments: [{ itemIds: ['it1'] }, { itemIds: ['it1'] }],
    })).rejects.toThrow(ValidationError)
  })

  it('rejects when not every item is assigned', async () => {
    repo.findBillById.mockResolvedValue(openBill())
    repo.listItemsByBill.mockResolvedValue([
      { id: 'it1', unit_price_cents: 1000, qty: 1 },
      { id: 'it2', unit_price_cents: 2000, qty: 1 },
    ])
    repo.getSettings.mockResolvedValue(null)
    await expect(service.splitBill(ctx, BILL_ID, 'items', { assignments: [{ itemIds: ['it1'] }] }))
      .rejects.toThrow(ValidationError)
  })

  it('creates splits with item-based amounts (subtotal + 10% tax) and persists associations', async () => {
    repo.findBillById.mockResolvedValue(openBill())
    repo.listItemsByBill.mockResolvedValue([
      { id: 'it1', unit_price_cents: 1000, qty: 1 },  // 1000 + 100 tax = 1100
      { id: 'it2', unit_price_cents: 2000, qty: 1 },  // 2000 + 200 tax = 2200
    ])
    repo.getSettings.mockResolvedValue(null)
    repo.insertSplit.mockImplementation(async (_c, s) => ({ ...s, id: 'sp-' + s.shareIndex }))
    repo.insertSplitItem.mockResolvedValue({})
    repo.setBillStatus.mockResolvedValue()

    const splits = await service.splitBill(ctx, BILL_ID, 'items', {
      assignments: [{ itemIds: ['it1'] }, { itemIds: ['it2'] }],
    })
    expect(splits.map((s) => s.amountCents)).toEqual([1100, 2200])
    expect(repo.insertSplitItem).toHaveBeenCalledTimes(2)
    expect(repo.setBillStatus).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, BILL_ID, 'split')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'pos.bill.split' }))
  })
})
