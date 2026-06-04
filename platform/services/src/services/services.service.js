import { pool, withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as repo from '../repositories/services.repository.js'
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors.js'

// Canonical cancellation_policy shape. The column stays free-form JSONB for
// backward compatibility, but when the caller adopts any of the canonical
// keys we validate the whole set: refund_pct ∈ [0,100], hours_before_cancel
// >= 0, no_show_fee_cents a non-negative integer. Unknown extra keys are
// allowed (apps may stash custom flags). Throws ValidationError on a bad
// shape so the API returns 400 instead of a raw DB CHECK violation.
const CANCELLATION_KEYS = ['hours_before_cancel', 'refund_pct', 'no_show_fee_cents']

export function validateCancellationPolicy(policy) {
  if (policy == null) return
  if (typeof policy !== 'object' || Array.isArray(policy)) {
    throw new ValidationError('cancellationPolicy must be an object')
  }
  const hasCanonical = CANCELLATION_KEYS.some((k) => k in policy)
  if (!hasCanonical) return // legacy free-form policy, leave as-is

  const { hours_before_cancel: hbc, refund_pct: pct, no_show_fee_cents: fee } = policy
  if (hbc !== undefined && (!Number.isFinite(hbc) || hbc < 0)) {
    throw new ValidationError('cancellationPolicy.hours_before_cancel must be a number >= 0')
  }
  if (pct !== undefined && (!Number.isFinite(pct) || pct < 0 || pct > 100)) {
    throw new ValidationError('cancellationPolicy.refund_pct must be a number in [0, 100]')
  }
  if (fee !== undefined && (!Number.isInteger(fee) || fee < 0)) {
    throw new ValidationError('cancellationPolicy.no_show_fee_cents must be an integer >= 0')
  }
}

// Pure: is `startsAt` within this service's booking window relative to `now`?
// Returns { ok, reason }. reason ∈ 'too_soon' | 'too_far' | null. Used by
// the /booking-window endpoint and reusable by platform/bookings, which is
// where the booking is actually rejected (cross-module enforcement).
export function checkBookingWindow(service, startsAt, now = new Date()) {
  const start = new Date(startsAt)
  if (Number.isNaN(+start)) throw new ValidationError('invalid startsAt')
  const minAdvance = Number(service.min_advance_minutes ?? 0)
  const maxDays    = service.max_advance_days == null ? null : Number(service.max_advance_days)

  const diffMinutes = (start.getTime() - now.getTime()) / 60000
  if (diffMinutes < minAdvance) return { ok: false, reason: 'too_soon' }
  if (maxDays != null && diffMinutes > maxDays * 24 * 60) return { ok: false, reason: 'too_far' }
  return { ok: true, reason: null }
}

export async function createService(ctx, body) {
  validateCancellationPolicy(body.cancellationPolicy)
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
  if (patch.cancellationPolicy !== undefined) validateCancellationPolicy(patch.cancellationPolicy)
  const updated = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.update(c, ctx.appId, ctx.tenantId, id, patch),
  )
  if (!updated) throw new NotFoundError('service')
  return updated
}

// Resolves the service then evaluates its booking window for `atIso`.
export async function evaluateBookingWindow(ctx, id, atIso) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const s = await repo.findById(c, ctx.appId, ctx.tenantId, id)
    if (!s) throw new NotFoundError('service')
    return checkBookingWindow(s, atIso)
  })
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

// ── i18n translations ─────────────────────────────────────────────────────

export async function listTranslations(ctx, serviceId) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const s = await repo.findById(c, ctx.appId, ctx.tenantId, serviceId)
    if (!s) throw new NotFoundError('service')
    return repo.listTranslations(c, ctx.appId, ctx.tenantId, serviceId)
  })
}

export async function upsertTranslation(ctx, serviceId, body) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const s = await repo.findById(c, ctx.appId, ctx.tenantId, serviceId)
    if (!s) throw new NotFoundError('service')
    return repo.upsertTranslation(c, ctx.appId, ctx.tenantId, serviceId, {
      ...body, locale: body.locale.toLowerCase(),
    })
  })
}

export async function removeTranslation(ctx, serviceId, locale) {
  const ok = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.deleteTranslation(c, ctx.appId, ctx.tenantId, serviceId, locale.toLowerCase()),
  )
  if (!ok) throw new NotFoundError('translation')
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
