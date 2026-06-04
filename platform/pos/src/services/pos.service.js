import { pool, withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as repo from '../repositories/pos.repository.js'
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors.js'

const TAX_RATE = 0.10 // default 10%; tenants override via settings/metadata.taxRate

// Resolve the effective tax rate: bill metadata override → tenant settings → module default.
function resolveTaxRate(bill, settings) {
  const metaRate = bill?.metadata?.taxRate
  if (metaRate !== undefined && metaRate !== null && !Number.isNaN(Number(metaRate))) {
    return Number(metaRate)
  }
  if (settings?.default_tax_rate !== undefined && settings?.default_tax_rate !== null) {
    return Number(settings.default_tax_rate)
  }
  return TAX_RATE
}

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
  const items      = await repo.listItemsByBill(client, ctx.appId, ctx.tenantId, id)
  const payments   = await repo.listPaymentsByBill(client, ctx.appId, ctx.tenantId, id)
  const splits     = await repo.listSplits(client, ctx.appId, ctx.tenantId, id)
  const splitItems = await repo.listSplitItems(client, ctx.appId, ctx.tenantId, id)
  const settings   = await repo.getSettings(client, ctx.appId, ctx.tenantId, ctx.subTenantId)

  // Attach the bill_item ids assigned to each split (split-by-item, #6).
  const itemsBySplit = new Map()
  for (const si of splitItems) {
    if (!itemsBySplit.has(si.split_id)) itemsBySplit.set(si.split_id, [])
    itemsBySplit.get(si.split_id).push(si.bill_item_id)
  }
  const splitsOut = splits.map((s) => ({ ...s, itemIds: itemsBySplit.get(s.id) ?? [] }))

  // Tip suggestions (#5): percentages + precomputed cents off the current total.
  const total = Number(bill.total_cents)
  const pcts  = Array.isArray(settings?.tip_suggestions) ? settings.tip_suggestions.map(Number) : []
  const tipSuggestions = {
    percents:    pcts,
    allowCustom: settings ? settings.tip_allow_custom : true,
    options:     pcts.map((p) => ({ percent: p, tipCents: Math.round(total * (p / 100)) })),
  }

  return { ...bill, items, payments, splits: splitsOut, tipSuggestions }
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
    const inserted = await repo.insertBillItem(client, { ...item, appId: ctx.appId, tenantId: ctx.tenantId, billId })
    const items    = await repo.listItemsByBill(client, ctx.appId, ctx.tenantId, billId)
    const settings = await repo.getSettings(client, ctx.appId, ctx.tenantId, ctx.subTenantId)
    const totals   = computeTotals(items, bill.tip_cents, resolveTaxRate(bill, settings))
    const updated  = await repo.setBillTotals(client, ctx.appId, ctx.tenantId, billId, totals)

    await publish({
      type: 'pos.bill.item_added',
      payload: {
        appId: ctx.appId, tenantId: ctx.tenantId, billId, tableId: bill.table_id,
        item: { id: inserted.id, sku: inserted.sku, name: inserted.name, qty: inserted.qty, course: inserted.course, modifiers: inserted.modifiers },
      },
    })
    return updated
  })
}

export async function splitBill(ctx, billId, mode, args = {}) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (client) => {
    const bill = await repo.findBillById(client, ctx.appId, ctx.tenantId, billId)
    if (!bill) throw new NotFoundError('bill')
    if (bill.status !== 'open') throw new ConflictError('can only split open bills')

    // ── split-by-item (#6): each share owns concrete bill_items ───────────
    if (mode === 'items') {
      const assignments = args.assignments ?? []
      if (assignments.length < 1) throw new ValidationError('items split requires at least one assignment')

      const items = await repo.listItemsByBill(client, ctx.appId, ctx.tenantId, billId)
      const settings = await repo.getSettings(client, ctx.appId, ctx.tenantId, ctx.subTenantId)
      const taxRate = resolveTaxRate(bill, settings)
      const itemById = new Map(items.map((it) => [it.id, it]))

      const seen = new Set()
      const splits = []
      for (let i = 0; i < assignments.length; i++) {
        const itemIds = assignments[i].itemIds ?? []
        if (itemIds.length < 1) throw new ValidationError('each assignment must reference at least one item')
        const shareItems = []
        for (const itemId of itemIds) {
          if (seen.has(itemId)) throw new ValidationError(`item ${itemId} assigned to more than one share`)
          const it = itemById.get(itemId)
          if (!it) throw new ValidationError(`item ${itemId} does not belong to this bill`)
          seen.add(itemId)
          shareItems.push(it)
        }
        // Each share's amount = its items' subtotal + proportional tax.
        const subtotal = shareItems.reduce((s, it) => s + Number(it.unit_price_cents) * Number(it.qty), 0)
        const amountCents = subtotal + Math.round(subtotal * taxRate)
        const split = await repo.insertSplit(client, {
          appId: ctx.appId, tenantId: ctx.tenantId,
          parentBillId: billId, shareIndex: i, amountCents,
        })
        for (const itemId of itemIds) {
          await repo.insertSplitItem(client, { appId: ctx.appId, tenantId: ctx.tenantId, splitId: split.id, billItemId: itemId })
        }
        splits.push({ ...split, itemIds })
      }
      if (seen.size !== items.length) {
        throw new ValidationError('every bill item must be assigned to exactly one share')
      }
      await repo.setBillStatus(client, ctx.appId, ctx.tenantId, billId, 'split')
      await publish({
        type: 'pos.bill.split',
        payload: { appId: ctx.appId, tenantId: ctx.tenantId, billId, mode, count: splits.length },
      })
      return splits
    }

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

// ── #1 cancel a bill (open/split) with audit + event ──────────────────────
export async function cancelBill(ctx, billId, reason) {
  const updated = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (client) => {
    const bill = await repo.findBillById(client, ctx.appId, ctx.tenantId, billId)
    if (!bill) throw new NotFoundError('bill')
    if (!['open', 'split'].includes(bill.status)) {
      throw new ConflictError('only open or split bills can be cancelled')
    }
    return repo.cancelBill(client, ctx.appId, ctx.tenantId, billId, ctx.userId, reason ?? null)
  })
  await publish({
    type: 'pos.bill.cancelled',
    payload: {
      appId: ctx.appId, tenantId: ctx.tenantId, billId,
      cancelledBy: ctx.userId, reason: reason ?? null, tableId: updated.table_id,
    },
  })
  return updated
}

// ── #3 fire (send to kitchen) decoupled from payment ──────────────────────
export async function fireBill(ctx, billId, itemIds) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (client) => {
    const bill = await repo.findBillById(client, ctx.appId, ctx.tenantId, billId)
    if (!bill) throw new NotFoundError('bill')
    if (!['open', 'split'].includes(bill.status)) throw new ConflictError('can only fire open or split bills')

    const fired = await repo.markItemsFired(client, ctx.appId, ctx.tenantId, billId, itemIds)
    if (fired.length > 0) {
      await publish({
        type: 'pos.bill.fired',
        payload: {
          appId: ctx.appId, tenantId: ctx.tenantId, billId,
          orderId: billId, // pos bill is its own order id for dine-in KDS
          tableId: bill.table_id,
          items: fired.map((i) => ({ id: i.id, sku: i.sku, name: i.name, qty: i.qty, course: i.course, modifiers: i.modifiers, notes: i.notes })),
        },
      })
    }
    return { billId, firedCount: fired.length, items: fired }
  })
}

// ── #5 per-tenant POS settings (tip suggestions, default tax) ─────────────
export async function getSettings(ctx) {
  const row = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (client) =>
    repo.getSettings(client, ctx.appId, ctx.tenantId, ctx.subTenantId),
  )
  return row ?? {
    app_id: ctx.appId, tenant_id: ctx.tenantId, sub_tenant_id: ctx.subTenantId ?? null,
    tip_suggestions: [], tip_allow_custom: true, default_tax_rate: null,
  }
}

export async function updateSettings(ctx, body) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (client) =>
    repo.upsertSettings(client, {
      appId: ctx.appId, tenantId: ctx.tenantId, subTenantId: ctx.subTenantId,
      tipSuggestions: body.tipSuggestions,
      tipAllowCustom: body.tipAllowCustom,
      defaultTaxRate: body.defaultTaxRate,
    }),
  )
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
