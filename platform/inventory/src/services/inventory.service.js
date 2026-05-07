import { pool, withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import { logger } from '../lib/logger.js'
import * as repo from '../repositories/inventory.repository.js'
import { ConflictError, NotFoundError } from '../utils/errors.js'

export async function getItem(ctx, sku) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (client) =>
    repo.findBySku(client, ctx.appId, ctx.tenantId, sku),
  )
}

export async function listItems(ctx, opts) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (client) =>
    repo.listByTenant(client, ctx.appId, ctx.tenantId, opts),
  )
}

export async function upsertItem(ctx, { sku, qtyOnHand, lowStockThreshold, parentSku, optionValues, displayName }) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (client) => {
    const before = await repo.findBySku(client, ctx.appId, ctx.tenantId, sku)
    const after  = await repo.upsert(client, {
      appId: ctx.appId, tenantId: ctx.tenantId, sku, qtyOnHand, lowStockThreshold,
      parentSku, optionValues, displayName,
    })
    const delta = after.qty_on_hand - (before?.qty_on_hand ?? 0)
    if (delta !== 0) {
      await repo.recordMovement(client, {
        appId: ctx.appId, tenantId: ctx.tenantId, sku,
        delta, reason: 'adjust', actorUserId: ctx.userId,
      })
    }
    await publish({ type: 'inventory.adjusted', payload: { appId: ctx.appId, tenantId: ctx.tenantId, sku, qtyOnHand: after.qty_on_hand } })
    return after
  })
}

// ── Variants ────────────────────────────────────────────────────────────

export async function listVariants(ctx, parentSku) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (client) => {
    const parent = await repo.findBySku(client, ctx.appId, ctx.tenantId, parentSku)
    if (!parent) throw new NotFoundError('parent SKU')
    const variants = await repo.listVariants(client, ctx.appId, ctx.tenantId, parentSku)
    return { parent, variants }
  })
}

export async function addVariant(ctx, parentSku, { sku, optionValues, qtyOnHand, lowStockThreshold, displayName }) {
  if (!sku || sku === parentSku) throw new ConflictError('variant SKU must differ from parent SKU')
  if (!optionValues || Object.keys(optionValues).length === 0) {
    throw new ConflictError('variant requires at least one option value (e.g. {"size":"M"})')
  }
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (client) => {
    const parent = await repo.findBySku(client, ctx.appId, ctx.tenantId, parentSku)
    if (!parent) throw new NotFoundError('parent SKU')
    if (parent.parent_sku) throw new ConflictError('parent SKU is itself a variant — flatten the hierarchy')

    const existing = await repo.findByParentAndOptions(client, ctx.appId, ctx.tenantId, parentSku, optionValues)
    if (existing) throw new ConflictError(`variant for these options already exists (sku=${existing.sku})`)

    try {
      return await repo.upsert(client, {
        appId: ctx.appId, tenantId: ctx.tenantId,
        sku, qtyOnHand: qtyOnHand ?? 0, lowStockThreshold,
        parentSku, optionValues, displayName,
      })
    } catch (err) {
      if (err.code === '23505') throw new ConflictError('variant collides with an existing row')
      throw err
    }
  })
}

export async function reserveItem(ctx, { sku, qty, refType, refId }) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (client) => {
    const updated = await repo.reserve(client, ctx.appId, ctx.tenantId, sku, qty)
    if (!updated) {
      const item = await repo.findBySku(client, ctx.appId, ctx.tenantId, sku)
      if (!item) throw new NotFoundError('inventory item')
      throw new ConflictError(`insufficient stock for ${sku}: requested ${qty}, available ${item.qty_on_hand - item.qty_reserved}`)
    }
    await repo.recordMovement(client, {
      appId: ctx.appId, tenantId: ctx.tenantId, sku,
      delta: 0, reason: 'reserve', refType, refId, actorUserId: ctx.userId,
    })
    return updated
  })
}

export async function releaseItem(ctx, { sku, qty, refType, refId }) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (client) => {
    const updated = await repo.release(client, ctx.appId, ctx.tenantId, sku, qty)
    if (!updated) throw new NotFoundError('inventory item')
    await repo.recordMovement(client, {
      appId: ctx.appId, tenantId: ctx.tenantId, sku,
      delta: 0, reason: 'release', refType, refId, actorUserId: ctx.userId,
    })
    return updated
  })
}

export async function commitItem(ctx, { sku, qty, refType, refId }) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (client) => {
    const updated = await repo.commit(client, ctx.appId, ctx.tenantId, sku, qty)
    if (!updated) throw new NotFoundError('inventory item or insufficient stock')
    await repo.recordMovement(client, {
      appId: ctx.appId, tenantId: ctx.tenantId, sku,
      delta: -qty, reason: 'commit', refType, refId, actorUserId: ctx.userId,
    })
    if (updated.qty_on_hand <= updated.low_stock_threshold) {
      await publish({ type: 'inventory.depleted', payload: { appId: ctx.appId, tenantId: ctx.tenantId, sku, qtyOnHand: updated.qty_on_hand, threshold: updated.low_stock_threshold } })
    }
    return updated
  })
}

// ── Event consumer: react to order lifecycle ──────────────────────────────
export async function handleOrderEvent(event) {
  const items = event?.payload?.items ?? []
  const ctx   = { appId: event?.payload?.appId, tenantId: event?.payload?.tenantId, subTenantId: null, userId: null }
  if (!ctx.appId || !ctx.tenantId || !items.length) return

  for (const item of items) {
    try {
      if (event.type === 'order.created') {
        await reserveItem(ctx, { sku: item.sku, qty: item.qty, refType: 'order', refId: event.payload.orderId })
      } else if (event.type === 'order.paid') {
        await commitItem(ctx, { sku: item.sku, qty: item.qty, refType: 'order', refId: event.payload.orderId })
      } else if (event.type === 'order.cancelled') {
        await releaseItem(ctx, { sku: item.sku, qty: item.qty, refType: 'order', refId: event.payload.orderId })
      }
    } catch (err) {
      logger.warn({ err, event: event.type, sku: item.sku }, 'inventory event handler error')
    }
  }
}
