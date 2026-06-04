// Post-creation item editing + CSV export + shipment linkage.
//
// addItem / removeItem / changeItemQty:
//   - 404 si la order no existe.
//   - 409 si la order no es mutable (no pending/paid).
//   - happy: muta order_items, recomputa totales desde las filas vivas,
//     registra la modificación específica + un `totals_adjusted`, publica
//     order.modified.
//   - removeItem / changeItemQty: 404 si el item no existe.
//   - changeItemQty: ValidationError si qty < 1.
//
// exportOrdersCsv: header + filas escapadas; celdas con coma/comilla citadas.
//
// linkShipment: 404 si no existe; UPDATE shipment_id + publish order.modified.
//
// handleEvent: shipping.shipment.created → linkShipment.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../lib/db.js', () => ({ pool: {}, withTenantTransaction: vi.fn() }))
vi.mock('../lib/redis.js', () => ({ publish: vi.fn() }))
vi.mock('../repositories/orders.repository.js')

import * as service from '../services/orders.service.js'
import { withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as repo from '../repositories/orders.repository.js'

const ctx = { appId: 'mk', tenantId: 't1', subTenantId: null, userId: 'staff-1', role: 'admin' }
const OID = 'ord-1'
const ITEM = 'item-1'

// A paid (mutable) order with tax + shipping kept on recompute.
const ORDER = {
  id: OID, status: 'paid', buyer_user_id: 'b1',
  subtotal_cents: 2000, tax_cents: 200, shipping_cents: 100, total_cents: 2300,
}

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) =>
    fn({ query: vi.fn().mockResolvedValue({ rows: [] }) }))
})

// ── addItem ─────────────────────────────────────────────────────────────

describe('addItem', () => {
  const newItem = { sku: 'B', productName: 'Banana', qty: 2, unitPriceCents: 500 }

  it('404 si la order no existe', async () => {
    repo.findOrderById.mockResolvedValue(null)
    await expect(service.addItem(ctx, 'ghost', newItem)).rejects.toMatchObject({ statusCode: 404 })
  })

  it.each([['shipped'], ['delivered'], ['cancelled'], ['refunded']])(
    '409 si status="%s" (no mutable)', async (status) => {
      repo.findOrderById.mockResolvedValue({ ...ORDER, status })
      await expect(service.addItem(ctx, OID, newItem)).rejects.toMatchObject({ statusCode: 409 })
      expect(repo.insertItem).not.toHaveBeenCalled()
    },
  )

  it('happy: inserta item, recomputa totales y publica order.modified', async () => {
    repo.findOrderById.mockResolvedValue(ORDER)
    repo.insertItem.mockResolvedValue({ id: 'new', unit_price_cents: 500, qty: 2 })
    repo.insertModification.mockResolvedValueOnce({ id: 'mod-add' }).mockResolvedValueOnce({ id: 'mod-tot' })
    // surviving items after the add: original (2x1000) + new (2x500) = 3000
    repo.findItemsByOrderId.mockResolvedValue([
      { unit_price_cents: 1000, qty: 2 },
      { unit_price_cents: 500, qty: 2 },
    ])
    repo.updateTotals.mockResolvedValue({ id: OID, total_cents: 3300 })

    await service.addItem(ctx, OID, newItem, 'promo')

    expect(repo.insertItem).toHaveBeenCalled()
    expect(repo.updateTotals).toHaveBeenCalledWith(expect.anything(), ctx.appId, ctx.tenantId, OID, {
      subtotalCents: 3000, taxCents: 200, shippingCents: 100, totalCents: 3300,
    })
    // first modification = item_added, second = totals_adjusted
    expect(repo.insertModification).toHaveBeenCalledWith(expect.anything(),
      expect.objectContaining({ type: 'item_added', after: newItem }))
    expect(repo.insertModification).toHaveBeenCalledWith(expect.anything(),
      expect.objectContaining({ type: 'totals_adjusted' }))
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'order.modified',
      payload: expect.objectContaining({ modificationType: 'item_added', totalCents: 3300 }),
    }))
  })
})

// ── removeItem ───────────────────────────────────────────────────────────

describe('removeItem', () => {
  it('404 si el item no existe', async () => {
    repo.findOrderById.mockResolvedValue(ORDER)
    repo.findItemById.mockResolvedValue(null)
    await expect(service.removeItem(ctx, OID, 'ghost')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('happy: borra item, recomputa, registra item_removed', async () => {
    repo.findOrderById.mockResolvedValue(ORDER)
    repo.findItemById.mockResolvedValue({ id: ITEM, unit_price_cents: 1000, qty: 2 })
    repo.deleteItem.mockResolvedValue(1)
    repo.insertModification.mockResolvedValue({ id: 'mod' })
    repo.findItemsByOrderId.mockResolvedValue([]) // empty after removal
    repo.updateTotals.mockResolvedValue({ id: OID, total_cents: 300 })

    const res = await service.removeItem(ctx, OID, ITEM, 'returned')

    expect(repo.deleteItem).toHaveBeenCalledWith(expect.anything(), ctx.appId, ctx.tenantId, OID, ITEM)
    expect(repo.updateTotals).toHaveBeenCalledWith(expect.anything(), ctx.appId, ctx.tenantId, OID, {
      subtotalCents: 0, taxCents: 200, shippingCents: 100, totalCents: 300,
    })
    expect(res.removed).toEqual({ id: ITEM, unit_price_cents: 1000, qty: 2 })
    expect(repo.insertModification).toHaveBeenCalledWith(expect.anything(),
      expect.objectContaining({ type: 'item_removed' }))
  })
})

// ── changeItemQty ─────────────────────────────────────────────────────────

describe('changeItemQty', () => {
  it('ValidationError si qty < 1', async () => {
    await expect(service.changeItemQty(ctx, OID, ITEM, 0)).rejects.toMatchObject({ statusCode: 422 })
  })

  it('404 si el item no existe', async () => {
    repo.findOrderById.mockResolvedValue(ORDER)
    repo.findItemById.mockResolvedValue(null)
    await expect(service.changeItemQty(ctx, OID, 'ghost', 3)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('happy: cambia qty, recomputa', async () => {
    repo.findOrderById.mockResolvedValue(ORDER)
    repo.findItemById.mockResolvedValue({ id: ITEM, unit_price_cents: 1000, qty: 2 })
    repo.updateItemQty.mockResolvedValue({ id: ITEM, unit_price_cents: 1000, qty: 3 })
    repo.insertModification.mockResolvedValue({ id: 'mod' })
    repo.findItemsByOrderId.mockResolvedValue([{ unit_price_cents: 1000, qty: 3 }]) // 3000
    repo.updateTotals.mockResolvedValue({ id: OID, total_cents: 3300 })

    await service.changeItemQty(ctx, OID, ITEM, 3, 'more')

    expect(repo.updateItemQty).toHaveBeenCalledWith(expect.anything(), ctx.appId, ctx.tenantId, OID, ITEM, 3)
    expect(repo.updateTotals).toHaveBeenCalledWith(expect.anything(), ctx.appId, ctx.tenantId, OID, {
      subtotalCents: 3000, taxCents: 200, shippingCents: 100, totalCents: 3300,
    })
    expect(repo.insertModification).toHaveBeenCalledWith(expect.anything(),
      expect.objectContaining({ type: 'item_qty_changed', after: { itemId: ITEM, qty: 3 } }))
  })
})

// ── exportOrdersCsv ───────────────────────────────────────────────────────

describe('exportOrdersCsv', () => {
  it('header + filas; celdas con coma/comilla citadas', async () => {
    repo.exportOrders.mockResolvedValue([
      { id: 'o1', status: 'paid', currency: 'EUR', buyer_user_id: 'b1',
        subtotal_cents: 1000, tax_cents: 0, shipping_cents: 0, total_cents: 1000,
        stripe_payment_intent_id: 'pi,1', shipment_id: null,
        created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
    ])
    const csv = await service.exportOrdersCsv(ctx, { status: 'paid' })
    const [header, row] = csv.split('\n')
    expect(header).toBe('id,status,currency,buyer_user_id,subtotal_cents,tax_cents,shipping_cents,total_cents,stripe_payment_intent_id,shipment_id,created_at,updated_at')
    expect(row).toContain('o1,paid,EUR,b1,1000,0,0,1000,"pi,1",,')
    expect(repo.exportOrders).toHaveBeenCalledWith(expect.anything(), ctx.appId, ctx.tenantId, { status: 'paid' })
  })

  it('sin filas → solo header', async () => {
    repo.exportOrders.mockResolvedValue([])
    const csv = await service.exportOrdersCsv(ctx, {})
    expect(csv.split('\n')).toHaveLength(1)
  })
})

// ── linkShipment + handleEvent ───────────────────────────────────────────

describe('linkShipment', () => {
  it('404 si la order no existe', async () => {
    repo.findOrderById.mockResolvedValue(null)
    await expect(service.linkShipment(ctx, 'ghost', 'shp-1')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('happy: UPDATE shipment_id + publish order.modified', async () => {
    repo.findOrderById.mockResolvedValue(ORDER)
    repo.updateShipment.mockResolvedValue({ id: OID, shipment_id: 'shp-1' })
    const r = await service.linkShipment(ctx, OID, 'shp-1')
    expect(repo.updateShipment).toHaveBeenCalledWith(expect.anything(), ctx.appId, ctx.tenantId, OID, 'shp-1')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'order.modified',
      payload: expect.objectContaining({ modificationType: 'shipment_linked', shipmentId: 'shp-1' }),
    }))
    expect(r.shipment_id).toBe('shp-1')
  })
})

describe('handleEvent: shipping.shipment.created', () => {
  it('linka el shipment_id', async () => {
    repo.findOrderById.mockResolvedValue(ORDER)
    repo.updateShipment.mockResolvedValue({ id: OID, shipment_id: 'shp-9' })
    await service.handleEvent({
      type: 'shipping.shipment.created',
      payload: { appId: 'mk', tenantId: 't1', orderId: OID, shipmentId: 'shp-9' },
    })
    expect(repo.updateShipment).toHaveBeenCalledWith(expect.anything(), 'mk', 't1', OID, 'shp-9')
  })

  it('sin shipmentId → no-op', async () => {
    await service.handleEvent({
      type: 'shipping.shipment.created',
      payload: { appId: 'mk', tenantId: 't1', orderId: OID },
    })
    expect(repo.updateShipment).not.toHaveBeenCalled()
  })
})
