// Promotions engine for the (Redis-only) basket module.
//
// Promotions are stored per-tenant in Redis under a fixed prefix; they're
// short, change rarely, and querying them once per checkout is cheap.
//   key   = basket:promo:<appId>:<tenantId>:<code>
//   value = JSON of { code, type, value, minSubtotalCents, maxUsesPerUser,
//                     freeShipping, expiresAt, enabled }
//
// type is one of:
//   - 'percent'      — value is basis points (e.g. 1000 = 10%)
//   - 'fixed_amount' — value is cents
//   - 'free_shipping'— value is ignored; the engine drops shipping to 0
//
// The engine is a pure function (evaluate); apply/clear mutate the basket
// JSON to remember the applied code, so subsequent /v1/basket/summary calls
// can re-derive totals without re-issuing the apply request.

import { redis } from '../lib/redis.js'
import { env } from '../lib/env.js'

const PROMO_PREFIX = 'basket:promo:'
const USAGE_PREFIX = 'basket:promo-usage:'   // per-user usage counter
const APPLIED_FIELD = 'appliedPromo'      // sits inside the basket JSON

function promoKey(appId, tenantId, code) {
  return `${PROMO_PREFIX}${appId}:${tenantId}:${code.toUpperCase()}`
}

function usageKey(appId, tenantId, code, userId) {
  return `${USAGE_PREFIX}${appId}:${tenantId}:${code.toUpperCase()}:${userId}`
}

function basketKey(appId, tenantId, userId) {
  return `basket:${appId}:${tenantId}:${userId}`
}

// ── Promo CRUD (staff/admin) ────────────────────────────────────────────

export async function upsertPromo({ appId, tenantId, code, def }) {
  const stored = {
    code:               code.toUpperCase(),
    type:               def.type,
    value:              def.value ?? 0,
    minSubtotalCents:   def.minSubtotalCents ?? 0,
    maxUsesPerUser:     def.maxUsesPerUser ?? null,
    freeShipping:       def.type === 'free_shipping' ? true : !!def.freeShipping,
    expiresAt:          def.expiresAt ?? null,
    enabled:            def.enabled !== false,
  }
  await redis.set(promoKey(appId, tenantId, code), JSON.stringify(stored))
  return stored
}

export async function getPromo({ appId, tenantId, code }) {
  if (!code) return null
  const raw = await redis.get(promoKey(appId, tenantId, code))
  return raw ? JSON.parse(raw) : null
}

export async function deletePromo({ appId, tenantId, code }) {
  await redis.del(promoKey(appId, tenantId, code))
}

export async function listPromos({ appId, tenantId }) {
  const prefix = `${PROMO_PREFIX}${appId}:${tenantId}:`
  let cursor = '0'
  const out = []
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 200)
    cursor = next
    if (keys.length) {
      const values = await redis.mget(...keys)
      for (const v of values) {
        if (!v) continue
        try { out.push(JSON.parse(v)) } catch { /* skip */ }
      }
    }
  } while (cursor !== '0')
  return out.sort((a, b) => a.code.localeCompare(b.code))
}

// ── Engine ──────────────────────────────────────────────────────────────

function basketSubtotal(basket) {
  return (basket.items ?? []).reduce(
    (sum, i) => sum + Number(i.priceCents || 0) * Number(i.quantity || 0), 0,
  )
}

// Pure: ({ items }, promo, opts) → { subtotalCents, discountCents, totalCents, freeShipping, error?, promoApplied? }
export function evaluate(basket, promo, { shippingCents = 0 } = {}) {
  const subtotalCents = basketSubtotal(basket)
  if (!promo) return { subtotalCents, discountCents: 0, freeShipping: false, totalCents: subtotalCents + shippingCents }
  if (!promo.enabled)         return reject('promo not enabled', subtotalCents, shippingCents)
  if (promo.expiresAt && new Date(promo.expiresAt).getTime() < Date.now())
                              return reject('promo expired', subtotalCents, shippingCents)
  if (subtotalCents < (promo.minSubtotalCents ?? 0))
                              return reject(`min subtotal not met (need ${promo.minSubtotalCents})`, subtotalCents, shippingCents)

  let discountCents = 0
  let freeShipping  = false

  if (promo.type === 'percent') {
    discountCents = Math.floor(subtotalCents * (Number(promo.value) || 0) / 10_000)
  } else if (promo.type === 'fixed_amount') {
    discountCents = Math.min(subtotalCents, Number(promo.value) || 0)
  } else if (promo.type === 'free_shipping') {
    freeShipping  = true
  } else {
    return reject(`unknown promo type: ${promo.type}`, subtotalCents, shippingCents)
  }

  const effectiveShipping = freeShipping ? 0 : shippingCents
  return {
    subtotalCents,
    discountCents,
    freeShipping,
    totalCents: Math.max(0, subtotalCents - discountCents) + effectiveShipping,
    promoApplied: promo.code,
  }
}

function reject(reason, subtotalCents, shippingCents) {
  return { subtotalCents, discountCents: 0, freeShipping: false, totalCents: subtotalCents + shippingCents, error: reason }
}

// ── Apply / clear / summary (mutates the basket JSON) ───────────────────

async function readBasket(appId, tenantId, userId) {
  const raw = await redis.get(basketKey(appId, tenantId, userId))
  return raw ? JSON.parse(raw) : { items: [] }
}

// Persist the basket while preserving its sliding TTL (KEEPTTL). Applying or
// clearing a promo must not extend or drop the cart's expiry set by mutations
// in basket.service.js.
async function writeBasket(appId, tenantId, userId, basket) {
  await redis.set(basketKey(appId, tenantId, userId), JSON.stringify(basket), 'KEEPTTL')
}

// Atomic per-user usage counter. INCR returns the post-increment value; if it
// exceeds maxUsesPerUser we roll it back (DECR) and report the cap was hit.
// The counter shares the promo's expiry so it can't grow unbounded.
async function tryReserveUsage(appId, tenantId, promo, userId) {
  if (promo.maxUsesPerUser == null) return { ok: true }
  const uKey = usageKey(appId, tenantId, promo.code, userId)
  const used = await redis.incr(uKey)
  if (used === 1 && promo.expiresAt) {
    const ttl = Math.floor((new Date(promo.expiresAt).getTime() - Date.now()) / 1000)
    if (ttl > 0) await redis.expire(uKey, ttl)
  }
  if (used > promo.maxUsesPerUser) {
    await redis.decr(uKey)
    return { ok: false }
  }
  return { ok: true }
}

async function releaseUsage(appId, tenantId, code, userId) {
  const uKey = usageKey(appId, tenantId, code, userId)
  const v = await redis.decr(uKey)
  if (v <= 0) await redis.del(uKey)
}

export async function applyPromo({ appId, tenantId, userId, code }) {
  const promo = await getPromo({ appId, tenantId, code })
  if (!promo) {
    const basket = await readBasket(appId, tenantId, userId)
    return { basket, summary: { ...evaluate(basket, null), error: 'promo not found' } }
  }
  const basket = await readBasket(appId, tenantId, userId)
  // Re-applying the same code already on the basket is idempotent — never
  // double-count usage.
  const alreadyApplied = basket[APPLIED_FIELD] === promo.code.toUpperCase()
  const summary = evaluate(basket, promo)
  if (summary.error) {
    // Don't persist an unapplied promo, but echo the engine's reason so the
    // frontend can render the right toast.
    return { basket, summary }
  }
  if (!alreadyApplied) {
    const reserved = await tryReserveUsage(appId, tenantId, promo, userId)
    if (!reserved.ok) {
      return {
        basket,
        summary: { ...evaluate(basket, null), error: `usage limit reached (max ${promo.maxUsesPerUser} per user)` },
      }
    }
  }
  basket[APPLIED_FIELD] = promo.code.toUpperCase()
  await writeBasket(appId, tenantId, userId, basket)
  return { basket, summary }
}

export async function clearPromo({ appId, tenantId, userId }) {
  const basket = await readBasket(appId, tenantId, userId)
  const prev = basket[APPLIED_FIELD]
  delete basket[APPLIED_FIELD]
  await writeBasket(appId, tenantId, userId, basket)
  // Free the per-user reservation so the customer can re-apply later.
  if (prev) {
    const promo = await getPromo({ appId, tenantId, code: prev })
    if (promo && promo.maxUsesPerUser != null) await releaseUsage(appId, tenantId, prev, userId)
  }
  return { basket, summary: evaluate(basket, null) }
}

export async function basketSummary({ appId, tenantId, userId, shippingCents = 0 }) {
  const basket = await readBasket(appId, tenantId, userId)
  const promo = basket[APPLIED_FIELD]
    ? await getPromo({ appId, tenantId, code: basket[APPLIED_FIELD] })
    : null
  // If the applied promo has been deleted/disabled, drop it from the basket
  // so the next read doesn't keep showing a phantom code.
  if (basket[APPLIED_FIELD] && (!promo || !promo.enabled)) {
    delete basket[APPLIED_FIELD]
    await writeBasket(appId, tenantId, userId, basket)
  }
  return { basket, summary: evaluate(basket, promo, { shippingCents }) }
}
