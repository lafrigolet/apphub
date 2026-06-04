import { redis, publish } from '../lib/redis.js'
import { env } from '../lib/env.js'

function key(appId, tenantId, userId) {
  return `basket:${appId}:${tenantId}:${userId}`
}

function savedKey(appId, tenantId, userId) {
  return `basket:saved:${appId}:${tenantId}:${userId}`
}

// Sliding TTL: every write refreshes the key's expiry. Guests get a shorter
// window than authenticated users. A 0 TTL means "no expiry" (PERSIST). An
// empty basket ({ items: [] }, no applied promo) is deleted instead of written
// so abandoned/empty keys don't leak Redis memory.
function ttlFor(isGuest) {
  return isGuest ? env.BASKET_TTL_GUEST_SECONDS : env.BASKET_TTL_AUTH_SECONDS
}

function isEmptyBasket(basket) {
  return (!basket.items || basket.items.length === 0) && !basket.appliedPromo
}

async function writeBasket(basketKey, basket, { isGuest = false } = {}) {
  if (isEmptyBasket(basket)) {
    await redis.del(basketKey)
    return
  }
  const ttl = ttlFor(isGuest)
  if (ttl > 0) await redis.set(basketKey, JSON.stringify(basket), 'EX', ttl)
  else         await redis.set(basketKey, JSON.stringify(basket))
}

// Publish a basket.updated event on platform.events after a mutation. Other
// modules (stock reservation, multi-device sync) subscribe to it. Best-effort:
// a publish failure must never break a cart write.
async function emitUpdated({ appId, tenantId, userId, action, basket }) {
  try {
    await publish({
      type: 'basket.updated',
      appId, tenantId, userId,
      action,
      itemCount: (basket?.items ?? []).reduce((n, i) => n + Number(i.quantity || 0), 0),
      lineCount: (basket?.items ?? []).length,
      at: new Date().toISOString(),
    })
  } catch { /* best-effort */ }
}

export async function getBasket({ appId, tenantId, userId }) {
  const raw = await redis.get(key(appId, tenantId, userId))
  if (!raw) return { items: [] }
  return JSON.parse(raw)
}

// Lightweight summary for the mini-cart badge: item/line count + subtotal +
// applied promo, without serialising the whole basket payload.
export async function getCount({ appId, tenantId, userId }) {
  const raw = await redis.get(key(appId, tenantId, userId))
  if (!raw) return { itemCount: 0, lineCount: 0, subtotalCents: 0, appliedPromo: null }
  const basket = JSON.parse(raw)
  const items = basket.items ?? []
  return {
    itemCount: items.reduce((n, i) => n + Number(i.quantity || 0), 0),
    lineCount: items.length,
    subtotalCents: items.reduce((s, i) => s + Number(i.priceCents || 0) * Number(i.quantity || 0), 0),
    appliedPromo: basket.appliedPromo ?? null,
  }
}

export async function upsertItem({ appId, tenantId, userId, itemId, quantity, name, priceCents, metadata, isGuest = false }) {
  const basketKey = key(appId, tenantId, userId)
  const raw = await redis.get(basketKey)
  const basket = raw ? JSON.parse(raw) : { items: [] }

  const idx = basket.items.findIndex((i) => i.itemId === itemId)
  const entry = { itemId, quantity, name, priceCents, metadata: metadata ?? null }

  if (idx >= 0) basket.items[idx] = entry
  else basket.items.push(entry)

  await writeBasket(basketKey, basket, { isGuest })
  await emitUpdated({ appId, tenantId, userId, action: 'upsert_item', basket })
  return basket
}

// Atomic relative quantity change for a single line. `delta` may be negative;
// the resulting quantity is clamped at 1 (use removeItem to delete a line).
// Returns the updated basket, or { items } unchanged if the item is absent.
export async function patchQuantity({ appId, tenantId, userId, itemId, delta, isGuest = false }) {
  const basketKey = key(appId, tenantId, userId)
  const raw = await redis.get(basketKey)
  const basket = raw ? JSON.parse(raw) : { items: [] }
  const idx = basket.items.findIndex((i) => i.itemId === itemId)
  if (idx < 0) return basket
  const next = Number(basket.items[idx].quantity || 0) + Number(delta || 0)
  basket.items[idx].quantity = Math.max(1, next)
  await writeBasket(basketKey, basket, { isGuest })
  await emitUpdated({ appId, tenantId, userId, action: 'patch_quantity', basket })
  return basket
}

export async function removeItem({ appId, tenantId, userId, itemId, isGuest = false }) {
  const basketKey = key(appId, tenantId, userId)
  const raw = await redis.get(basketKey)
  if (!raw) return { items: [] }
  const basket = JSON.parse(raw)
  basket.items = basket.items.filter((i) => i.itemId !== itemId)
  await writeBasket(basketKey, basket, { isGuest })
  await emitUpdated({ appId, tenantId, userId, action: 'remove_item', basket })
  return basket
}

export async function clearBasket({ appId, tenantId, userId }) {
  await redis.del(key(appId, tenantId, userId))
  await emitUpdated({ appId, tenantId, userId, action: 'clear', basket: { items: [] } })
}

// Merge a guest basket (identified by guestUserId — typically a UUID minted
// client-side and stored in localStorage before login) into the
// authenticated user's basket. Items already present are quantity-summed;
// items only in the guest basket are appended. The guest basket is removed
// at the end so a re-login on the same device starts fresh.
export async function mergeBaskets({ appId, tenantId, userId, guestUserId }) {
  if (userId === guestUserId) return getBasket({ appId, tenantId, userId })
  const userKey  = key(appId, tenantId, userId)
  const guestKey = key(appId, tenantId, guestUserId)
  const [userRaw, guestRaw] = await Promise.all([redis.get(userKey), redis.get(guestKey)])
  const user  = userRaw  ? JSON.parse(userRaw)  : { items: [] }
  const guest = guestRaw ? JSON.parse(guestRaw) : { items: [] }

  const byId = new Map(user.items.map((i) => [i.itemId, { ...i }]))
  for (const g of guest.items) {
    const existing = byId.get(g.itemId)
    if (existing) existing.quantity = Number(existing.quantity || 0) + Number(g.quantity || 0)
    else byId.set(g.itemId, { ...g })
  }
  const merged = { items: Array.from(byId.values()) }
  if (user.appliedPromo) merged.appliedPromo = user.appliedPromo
  await writeBasket(userKey, merged)        // authenticated TTL
  await redis.del(guestKey)
  await emitUpdated({ appId, tenantId, userId, action: 'merge', basket: merged })
  return merged
}

// ── Saved-for-later (parallel structure, never decrements stock) ──────

export async function listSaved({ appId, tenantId, userId }) {
  const raw = await redis.get(savedKey(appId, tenantId, userId))
  if (!raw) return { items: [] }
  return JSON.parse(raw)
}

export async function saveForLater({ appId, tenantId, userId, itemId, isGuest = false }) {
  const basketKey = key(appId, tenantId, userId)
  const raw = await redis.get(basketKey)
  const basket = raw ? JSON.parse(raw) : { items: [] }
  const idx = basket.items.findIndex((i) => i.itemId === itemId)
  if (idx < 0) return { saved: await listSaved({ appId, tenantId, userId }), basket }
  const [moved] = basket.items.splice(idx, 1)
  await writeBasket(basketKey, basket, { isGuest })

  const sKey = savedKey(appId, tenantId, userId)
  const sRaw = await redis.get(sKey)
  const saved = sRaw ? JSON.parse(sRaw) : { items: [] }
  saved.items.push(moved)
  await writeSaved(sKey, saved, isGuest)
  await emitUpdated({ appId, tenantId, userId, action: 'save_for_later', basket })
  return { saved, basket }
}

export async function moveBackToBasket({ appId, tenantId, userId, itemId, isGuest = false }) {
  const sKey = savedKey(appId, tenantId, userId)
  const sRaw = await redis.get(sKey)
  if (!sRaw) return { saved: { items: [] }, basket: await getBasket({ appId, tenantId, userId }) }
  const saved = JSON.parse(sRaw)
  const idx = saved.items.findIndex((i) => i.itemId === itemId)
  if (idx < 0) return { saved, basket: await getBasket({ appId, tenantId, userId }) }
  const [moved] = saved.items.splice(idx, 1)
  await writeSaved(sKey, saved, isGuest)
  const basket = await upsertItem({ appId, tenantId, userId, ...moved, isGuest })
  return { saved, basket }
}

export async function removeSaved({ appId, tenantId, userId, itemId, isGuest = false }) {
  const sKey = savedKey(appId, tenantId, userId)
  const sRaw = await redis.get(sKey)
  if (!sRaw) return { items: [] }
  const saved = JSON.parse(sRaw)
  saved.items = saved.items.filter((i) => i.itemId !== itemId)
  await writeSaved(sKey, saved, isGuest)
  return saved
}

// Saved-for-later shares the basket TTL policy; an empty saved list is deleted.
async function writeSaved(sKey, saved, isGuest) {
  if (!saved.items || saved.items.length === 0) { await redis.del(sKey); return }
  const ttl = ttlFor(isGuest)
  if (ttl > 0) await redis.set(sKey, JSON.stringify(saved), 'EX', ttl)
  else         await redis.set(sKey, JSON.stringify(saved))
}
