import { redis } from '../lib/redis.js'

function key(appId, tenantId, userId) {
  return `basket:${appId}:${tenantId}:${userId}`
}

function savedKey(appId, tenantId, userId) {
  return `basket:saved:${appId}:${tenantId}:${userId}`
}

export async function getBasket({ appId, tenantId, userId }) {
  const raw = await redis.get(key(appId, tenantId, userId))
  if (!raw) return { items: [] }
  return JSON.parse(raw)
}

export async function upsertItem({ appId, tenantId, userId, itemId, quantity, name, priceCents, metadata }) {
  const basketKey = key(appId, tenantId, userId)
  const raw = await redis.get(basketKey)
  const basket = raw ? JSON.parse(raw) : { items: [] }

  const idx = basket.items.findIndex((i) => i.itemId === itemId)
  const entry = { itemId, quantity, name, priceCents, metadata: metadata ?? null }

  if (idx >= 0) basket.items[idx] = entry
  else basket.items.push(entry)

  await redis.set(basketKey, JSON.stringify(basket))
  return basket
}

export async function removeItem({ appId, tenantId, userId, itemId }) {
  const basketKey = key(appId, tenantId, userId)
  const raw = await redis.get(basketKey)
  if (!raw) return { items: [] }
  const basket = JSON.parse(raw)
  basket.items = basket.items.filter((i) => i.itemId !== itemId)
  await redis.set(basketKey, JSON.stringify(basket))
  return basket
}

export async function clearBasket({ appId, tenantId, userId }) {
  await redis.del(key(appId, tenantId, userId))
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
  await redis.set(userKey, JSON.stringify(merged))
  await redis.del(guestKey)
  return merged
}

// ── Saved-for-later (parallel structure, never decrements stock) ──────

export async function listSaved({ appId, tenantId, userId }) {
  const raw = await redis.get(savedKey(appId, tenantId, userId))
  if (!raw) return { items: [] }
  return JSON.parse(raw)
}

export async function saveForLater({ appId, tenantId, userId, itemId }) {
  const basketKey = key(appId, tenantId, userId)
  const raw = await redis.get(basketKey)
  const basket = raw ? JSON.parse(raw) : { items: [] }
  const idx = basket.items.findIndex((i) => i.itemId === itemId)
  if (idx < 0) return { saved: await listSaved({ appId, tenantId, userId }), basket }
  const [moved] = basket.items.splice(idx, 1)
  await redis.set(basketKey, JSON.stringify(basket))

  const sKey = savedKey(appId, tenantId, userId)
  const sRaw = await redis.get(sKey)
  const saved = sRaw ? JSON.parse(sRaw) : { items: [] }
  saved.items.push(moved)
  await redis.set(sKey, JSON.stringify(saved))
  return { saved, basket }
}

export async function moveBackToBasket({ appId, tenantId, userId, itemId }) {
  const sKey = savedKey(appId, tenantId, userId)
  const sRaw = await redis.get(sKey)
  if (!sRaw) return { saved: { items: [] }, basket: await getBasket({ appId, tenantId, userId }) }
  const saved = JSON.parse(sRaw)
  const idx = saved.items.findIndex((i) => i.itemId === itemId)
  if (idx < 0) return { saved, basket: await getBasket({ appId, tenantId, userId }) }
  const [moved] = saved.items.splice(idx, 1)
  await redis.set(sKey, JSON.stringify(saved))
  const basket = await upsertItem({ appId, tenantId, userId, ...moved })
  return { saved, basket }
}

export async function removeSaved({ appId, tenantId, userId, itemId }) {
  const sKey = savedKey(appId, tenantId, userId)
  const sRaw = await redis.get(sKey)
  if (!sRaw) return { items: [] }
  const saved = JSON.parse(sRaw)
  saved.items = saved.items.filter((i) => i.itemId !== itemId)
  await redis.set(sKey, JSON.stringify(saved))
  return saved
}
