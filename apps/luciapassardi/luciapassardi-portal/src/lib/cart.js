// Cliente de la cesta de la compra de la landing. Reutiliza platform/basket
// (Redis) con un token de invitado (lib/auth → cartToken). El checkout crea un
// pedido real en platform/orders e intenta iniciar el pago (Stripe); si el pago
// no está disponible, el pedido queda registrado (visible en el backoffice) y se
// confirma al cliente.
import { cartToken, APP_ID, TENANT_ID } from './auth.js'

const BASE = import.meta.env.VITE_API_BASE_URL ?? ''

// Llama a la API con el token de invitado; si caduca (401), lo re-emite y reintenta.
async function api(method, path, body, _retry = false) {
  const token = await cartToken(_retry)
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body != null ? JSON.stringify(body) : undefined,
  })
  if (res.status === 401 && !_retry) return api(method, path, body, true)
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json?.error?.message ?? json?.error?.code ?? `HTTP ${res.status}`)
  return json
}

// Carga la cesta + totales en una sola llamada (evita el 301 de GET /api/basket).
export async function loadCart() {
  const j = await api('GET', '/api/basket/summary')
  const items = j?.basket?.items ?? []
  return { items, subtotalCents: j?.summary?.subtotalCents ?? 0, totalCents: j?.summary?.totalCents ?? 0 }
}

// Fija la cantidad absoluta de un producto (PUT = upsert). quantity ≥ 1.
export async function putItem({ itemId, name, priceCents, quantity }) {
  return api('PUT', '/api/basket/items', { itemId, name, priceCents, quantity })
}
// Cambio relativo de cantidad (delta puede ser negativo; el backend lo clampa ≥1).
export async function changeQty(itemId, delta) {
  return api('PATCH', `/api/basket/items/${encodeURIComponent(itemId)}/quantity`, { delta })
}
export async function removeItem(itemId) {
  return api('DELETE', `/api/basket/items/${encodeURIComponent(itemId)}`)
}
// Vacía la cesta retirando cada línea (evita el 301 de DELETE /api/basket).
export async function clearCart(items) {
  for (const it of items) { await removeItem(it.itemId).catch(() => {}) }
}

// Checkout: crea el pedido real en platform/orders, intenta el pago Stripe y
// vacía la cesta. Devuelve { redirectUrl } si hay pago, o { orderId } si el
// pedido queda pendiente de pago (Stripe no disponible).
export async function checkout({ items, contact }) {
  const order = await api('POST', '/api/orders/', {
    currency: 'eur',
    items: items.map((it) => ({
      sku: it.itemId, productName: it.name, qty: it.quantity, unitPriceCents: it.priceCents,
    })),
    shippingAddress: {
      fullName: contact.nombre, line1: contact.direccion || undefined,
      city: contact.ciudad || undefined, postalCode: contact.cp || undefined,
      country: 'ES', phone: contact.telefono || undefined,
    },
    metadata: { buyerName: contact.nombre, buyerEmail: contact.email, buyerPhone: contact.telefono || '', appId: APP_ID, tenantId: TENANT_ID },
  })
  const ord = order?.data ?? order
  const totalCents = Number(ord.total_cents ?? ord.totalCents ?? 0)

  let redirectUrl = null
  try {
    const origin = window.location.origin
    const pay = await api('POST', '/api/payments/checkout-sessions', {
      amountCents: totalCents,
      metadata: { orderId: ord.id, kind: 'marketplace_order' },
      successUrl: `${origin}/?pedido=ok`,
      cancelUrl: `${origin}/?pedido=cancel`,
    })
    redirectUrl = (pay?.data ?? pay)?.url ?? null
  } catch {
    redirectUrl = null   // pago no disponible (p.ej. Stripe sin configurar): pedido queda pendiente
  }

  await clearCart(items)
  return { orderId: ord.id, totalCents, redirectUrl }
}
