// HTTP client used by reviews.service.createReview to verify that an order
// referenced by a new review actually belongs to the buyer and is in a
// post-payment state. Lives behind a small client so the rest of the service
// stays unaware of HTTP details.
//
// Loopback by default: PLATFORM_CORE_URL = http://platform-core:3000, because
// reviews y orders corren en el mismo proceso platform-core (ADR 021). Se pega
// a la ruta real del módulo orders (/v1/orders/:id), no al prefijo /api/ del
// gateway nginx. Si orders se extrajera a su propio contenedor, basta cambiar
// el env var — sin tocar código.

import { env } from './env.js'
import { logger } from './logger.js'

const REQUEST_TIMEOUT_MS = 2000
const VALID_STATUSES = new Set(['paid', 'fulfilled', 'shipped', 'delivered', 'completed'])

export async function fetchOrder(orderId, jwt) {
  if (!orderId || !jwt) return null
  const url = `${env.PLATFORM_CORE_URL}/v1/orders/${orderId}`
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${jwt}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (res.status === 404) return null
    if (!res.ok) {
      logger.warn({ status: res.status, orderId }, 'order verification HTTP error')
      return null
    }
    return await res.json()
  } catch (err) {
    // Soft-fail: timeouts, network errors, JSON parse errors all fall through
    // and return null so the review still saves (with verified_purchase=false).
    logger.warn({ err: err?.message ?? String(err), orderId }, 'order verification failed')
    return null
  }
}

export async function isVerifiedPurchase(orderId, expectedBuyerUserId, jwt) {
  if (!orderId || !expectedBuyerUserId || !jwt) return false
  const order = await fetchOrder(orderId, jwt)
  if (!order) return false
  if (order.buyer_user_id !== expectedBuyerUserId) return false
  if (!VALID_STATUSES.has(order.status)) return false
  return true
}

// Exported only for tests.
export const _internals = { VALID_STATUSES, REQUEST_TIMEOUT_MS }
