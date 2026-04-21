import { redis } from '../lib/redis.js'

function key(appId, tenantId, userId) {
  return `basket:${appId}:${tenantId}:${userId}`
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
