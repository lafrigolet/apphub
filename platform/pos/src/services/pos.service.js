import { pool, withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as repo from '../repositories/pos.repository.js'
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors.js'

const TAX_RATE = 0.10 // default 10%; tenants override via metadata.taxRate

function computeTotals(items, tipCents = 0, taxRate = TAX_RATE) {
  // Postgres returns BIGINT as a string, so coerce every numeric input through
  // Number() to avoid string concatenation in the total below.
  const tip      = Number(tipCents) || 0
  const subtotal = items.reduce((s, it) => s + Number(it.unit_price_cents) * Number(it.qty), 0)
  const tax      = Math.round(subtotal * taxRate)
  const total    = subtotal + tax + tip
  return { subtotal, tax, tip, total }
}

export async function openBill(ctx, body) {
  const bill = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (client) =>
    repo.insertBill(client, { ...body, appId: ctx.appId, tenantId: ctx.tenantId, subTenantId: ctx.subTenantId, serverUserId: ctx.userId }),
  )
  await publish({
    type: 'pos.bill.opened',
    payload: { appId: ctx.appId, tenantId: ctx.tenantId, billId: bill.id, tableId: bill.table_id },
  })
  return bill
}

export async function listBills(ctx, opts) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (client) =>
    repo.listBills(client, ctx.appId, ctx.tenantId, opts),
  )
}

async function loadFullBill(client, ctx, id) {
  const bill = await repo.findBillById(client, ctx.appId, ctx.tenantId, id)
  if (!bill) throw new NotFoundError('bill')
  const items    = await repo.listItemsByBill(client, ctx.appId, ctx.tenantId, id)
  const payments = await repo.listPaymentsByBill(client, ctx.appId, ctx.tenantId, id)
  const splits   = await repo.listSplits(client, ctx.appId, ctx.tenantId, id)
  return { ...bill, items, payments, splits }
}

export async function getBill(ctx, id) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (client) =>
    loadFullBill(client, ctx, id),
  )
}

export async function addItem(ctx, billId, item) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (client) => {
    const bill = await repo.findBillById(client, ctx.appId, ctx.tenantId, billId)
    if (!bill) throw new NotFoundError('bill')
    if (bill.status !== 'open') throw new ConflictError('bill is not open')
    await repo.insertBillItem(client, { ...item, appId: ctx.appId, tenantId: ctx.tenantId, billId })
    const items = await repo.listItemsByBill(client, ctx.appId, ctx.tenantId, billId)
    const totals = computeTotals(items, bill.tip_cents)
    return repo.setBillTotals(client, ctx.appId, ctx.tenantId, billId, totals)
  })
}

export async function splitBill(ctx, billId, mode, args = {}) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (client) => {
    const bill = await repo.findBillById(client, ctx.appId, ctx.tenantId, billId)
    if (!bill) throw new NotFoundError('bill')
    if (bill.status !== 'open') throw new ConflictError('can only split open bills')

    let amounts = []
    if (mode === 'equal') {
      const n = args.shares ?? 2
      if (n < 2) throw new ValidationError('shares must be >= 2')
      const base = Math.floor(Number(bill.total_cents) / n)
      const rem  = Number(bill.total_cents) - base * n
      amounts = Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0))
    } else if (mode === 'percent') {
      const pcts = args.percents ?? []
      const sum  = pcts.reduce((s, p) => s + p, 0)
      if (Math.abs(sum - 100) > 0.01) throw new ValidationError('percents must sum to 100')
      amounts = pcts.map((p) => Math.round(Number(bill.total_cents) * (p / 100)))
    } else if (mode === 'amounts') {
      amounts = args.amountsCents ?? []
      const sum = amounts.reduce((s, n) => s + n, 0)
      if (sum !== Number(bill.total_cents)) throw new ValidationError('split amounts must equal bill total')
    } else {
      throw new ValidationError('unknown split mode')
    }

    const splits = []
    for (let i = 0; i < amounts.length; i++) {
      const split = await repo.insertSplit(client, {
        appId: ctx.appId, tenantId: ctx.tenantId,
        parentBillId: billId, shareIndex: i, amountCents: amounts[i],
      })
      splits.push(split)
    }
    await repo.setBillStatus(client, ctx.appId, ctx.tenantId, billId, 'split')

    await publish({
      type: 'pos.bill.split',
      payload: { appId: ctx.appId, tenantId: ctx.tenantId, billId, mode, count: amounts.length },
    })

    return splits
  })
}

export async function payBill(ctx, billId, payment) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (client) => {
    const bill = await repo.findBillById(client, ctx.appId, ctx.tenantId, billId)
    if (!bill) throw new NotFoundError('bill')
    if (!['open','split'].includes(bill.status)) throw new ConflictError('bill cannot be paid in current status')

    const p = await repo.insertPayment(client, { ...payment, appId: ctx.appId, tenantId: ctx.tenantId, billId })

    if (payment.splitId) {
      await repo.markSplitPaid(client, ctx.appId, ctx.tenantId, payment.splitId, p.id)
      const splits = await repo.listSplits(client, ctx.appId, ctx.tenantId, billId)
      if (splits.every((s) => s.paid)) {
        await repo.setBillStatus(client, ctx.appId, ctx.tenantId, billId, 'paid')
      }
    } else {
      const payments = await repo.listPaymentsByBill(client, ctx.appId, ctx.tenantId, billId)
      const sum      = payments.reduce((s, x) => s + Number(x.amount_cents), 0)
      if (sum >= Number(bill.total_cents)) {
        await repo.setBillStatus(client, ctx.appId, ctx.tenantId, billId, 'paid')
      }
    }

    const updated = await loadFullBill(client, ctx, billId)
    if (updated.status === 'paid') {
      await publish({
        type: 'pos.bill.paid',
        payload: {
          appId: ctx.appId, tenantId: ctx.tenantId, billId,
          totalCents: Number(updated.total_cents), tipCents: Number(updated.tip_cents),
          tableId: updated.table_id,
          // also fire kitchen tickets if they hadn't been fired earlier (dine-in flow)
          orderId: billId, // pos bills act as their own order id for dine-in
          items: updated.items.map((i) => ({ sku: i.sku, name: i.name, qty: i.qty, course: i.course, modifiers: i.modifiers })),
        },
      })
    }
    return updated
  })
}

export async function closeBill(ctx, billId) {
  const updated = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (client) => {
    const bill = await repo.findBillById(client, ctx.appId, ctx.tenantId, billId)
    if (!bill) throw new NotFoundError('bill')
    if (bill.status !== 'paid') throw new ConflictError('only paid bills can be closed')
    return repo.setBillStatus(client, ctx.appId, ctx.tenantId, billId, 'closed')
  })
  await publish({
    type: 'pos.bill.closed',
    payload: { appId: ctx.appId, tenantId: ctx.tenantId, billId, totalCents: Number(updated.total_cents) },
  })
  return updated
}
