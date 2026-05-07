import { pool, withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as repo from '../repositories/services.repository.js'
import { ConflictError, NotFoundError } from '../utils/errors.js'

export async function createService(ctx, body) {
  const s = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    try {
      return await repo.insert(c, ctx.appId, ctx.tenantId, { ...body, subTenantId: ctx.subTenantId })
    } catch (err) {
      if (err.code === '23505') throw new ConflictError('service code already exists for this tenant')
      throw err
    }
  })
  await publish({
    type: 'service.published',
    payload: {
      appId: ctx.appId, tenantId: ctx.tenantId, serviceId: s.id, code: s.code, modality: s.modality,
    },
  })
  return s
}

export async function getService(ctx, id) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const s = await repo.findById(c, ctx.appId, ctx.tenantId, id)
    if (!s) throw new NotFoundError('service')
    return s
  })
}

export async function listServices(ctx, opts) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.listByTenant(c, ctx.appId, ctx.tenantId, opts),
  )
}

export async function updateService(ctx, id, patch) {
  const updated = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.update(c, ctx.appId, ctx.tenantId, id, patch),
  )
  if (!updated) throw new NotFoundError('service')
  return updated
}

export async function deactivateService(ctx, id) {
  const s = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.deactivate(c, ctx.appId, ctx.tenantId, id),
  )
  if (!s) throw new NotFoundError('service')
  await publish({
    type: 'service.deprecated',
    payload: { appId: ctx.appId, tenantId: ctx.tenantId, serviceId: id, code: s.code },
  })
  return s
}

export async function createCategory(ctx, body) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.insertCategory(c, ctx.appId, ctx.tenantId, body),
  )
}

export async function listCategories(ctx) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.listCategories(c, ctx.appId, ctx.tenantId),
  )
}

// ── Photo gallery ───────────────────────────────────────────────────────

export async function listImages(ctx, serviceId) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const s = await repo.findById(c, ctx.appId, ctx.tenantId, serviceId)
    if (!s) throw new NotFoundError('service')
    return repo.listImages(c, ctx.appId, ctx.tenantId, serviceId)
  })
}

export async function attachImage(ctx, serviceId, body) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const s = await repo.findById(c, ctx.appId, ctx.tenantId, serviceId)
    if (!s) throw new NotFoundError('service')
    return repo.insertImage(c, ctx.appId, ctx.tenantId, serviceId, body)
  })
}

export async function detachImage(ctx, imageId) {
  const ok = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.deleteImage(c, ctx.appId, ctx.tenantId, imageId),
  )
  if (!ok) throw new NotFoundError('image')
}

// ── Pricing tiers + resolver ────────────────────────────────────────────

export async function listPricingTiers(ctx, serviceId) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const s = await repo.findById(c, ctx.appId, ctx.tenantId, serviceId)
    if (!s) throw new NotFoundError('service')
    return repo.listPricingTiers(c, ctx.appId, ctx.tenantId, serviceId)
  })
}

export async function addPricingTier(ctx, serviceId, body) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const s = await repo.findById(c, ctx.appId, ctx.tenantId, serviceId)
    if (!s) throw new NotFoundError('service')
    return repo.insertPricingTier(c, ctx.appId, ctx.tenantId, serviceId, body)
  })
}

export async function removePricingTier(ctx, tierId) {
  const ok = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.deletePricingTier(c, ctx.appId, ctx.tenantId, tierId),
  )
  if (!ok) throw new NotFoundError('tier')
}

// Pure: pick the most-specific tier whose day + minute window contains
// the given booking start, falling back to the row-level price_cents.
//
// Specificity rule (from most → least specific):
//   1. tier with both days_of_week and minute window → preferred when both match
//   2. tier with only days_of_week → preferred when day matches
//   3. tier with only minute window → preferred when window matches
//   4. row-level price_cents (no tier)
//
// Within a specificity bucket, the smallest matching window (end - start)
// wins — that lets a "Friday 18-22" tier override a "Mon-Fri all day" tier.
export function resolvePrice(service, tiers, atDate) {
  const candidates = []
  const day = atDate.getUTCDay()                          // 0=Sun..6=Sat
  const minuteOfDay = atDate.getUTCHours() * 60 + atDate.getUTCMinutes()

  for (const t of tiers) {
    if (!t.enabled) continue
    const dayMatches    = !t.days_of_week || t.days_of_week.includes(day)
    const windowMatches = (t.start_minute == null && t.end_minute == null)
                       || (t.start_minute <= minuteOfDay && minuteOfDay < t.end_minute)
    if (!dayMatches || !windowMatches) continue
    const hasDays    = !!t.days_of_week
    const hasWindow  = t.start_minute != null
    const span       = hasWindow ? (t.end_minute - t.start_minute) : Infinity
    const specificity = (hasDays ? 2 : 0) + (hasWindow ? 1 : 0)
    candidates.push({ tier: t, specificity, span })
  }
  if (candidates.length === 0) return { priceCents: Number(service.price_cents), tier: null }
  candidates.sort((a, b) => b.specificity - a.specificity || a.span - b.span)
  const chosen = candidates[0]
  return { priceCents: Number(chosen.tier.price_cents), tier: chosen.tier }
}

export async function quotePrice(ctx, serviceId, atIso) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const s = await repo.findById(c, ctx.appId, ctx.tenantId, serviceId)
    if (!s) throw new NotFoundError('service')
    const tiers = await repo.listPricingTiers(c, ctx.appId, ctx.tenantId, serviceId)
    return resolvePrice(s, tiers, new Date(atIso))
  })
}
