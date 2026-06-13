// Cliente de API de la landing: lee datos reales de los módulos de plataforma
// (services/sessions) y permite reservar / comprar bono. Degrada con elegancia:
// si el backend no responde, la UI usa los datos estáticos de content.js.
import { APP_ID, TENANT_ID, getToken } from './auth.js'

const BASE = import.meta.env.VITE_API_BASE_URL ?? ''

function authHeaders() {
  const t = getToken()
  return { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }
}

async function req(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method, headers: authHeaders(), body: body != null ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json?.error?.message ?? json?.error?.code ?? `HTTP ${res.status}`)
  return json
}

const qs = (kind, limit) =>
  `appId=${encodeURIComponent(APP_ID)}&tenantId=${encodeURIComponent(TENANT_ID)}&kind=${kind}${limit ? `&limit=${limit}` : ''}`

// Servicio "eventos" (kind=event) del seed; los próximos eventos son sus
// service_sessions. Override por env si cambia.
export const EVENTOS_SERVICE_ID =
  import.meta.env.VITE_LUCIAPASSARDI_EVENTOS_SERVICE_ID ?? '70000002-0000-0000-0000-000000000008'

// ── Admin de eventos (CRUD real sobre service_sessions del servicio eventos) ──
export async function listEventosAdmin() {
  const j = await req('GET', `/api/services/${EVENTOS_SERVICE_ID}/sessions`)
  return (j?.data ?? []).slice().sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))
}

export async function crearEvento({ titulo, startsAt, endsAt, location, capacity }) {
  return req('POST', `/api/services/${EVENTOS_SERVICE_ID}/sessions`, {
    startsAt, endsAt,
    description: titulo,
    location: location || undefined,
    capacity: capacity ? Number(capacity) : undefined,
  })
}

export async function editarEvento(sessionId, { titulo, startsAt, endsAt, location, capacity }) {
  return req('PATCH', `/api/services/sessions/${sessionId}`, {
    startsAt, endsAt,
    description: titulo,
    location: location || undefined,
    capacity: capacity ? Number(capacity) : undefined,
  })
}

export async function borrarEvento(sessionId) {
  return req('DELETE', `/api/services/sessions/${sessionId}`)
}

// ── Admin del calendario de clases (service_sessions kind=appointment) ──
// Tipos de clase = servicios kind=appointment (excluye el genérico 'clase' de
// los bonos y el servicio 'eventos').
export async function listClaseServices() {
  const j = await req('GET', '/api/services/?onlyActive=true')
  const arr = j?.data ?? j ?? []
  return arr.filter((s) => (s.kind ?? 'appointment') === 'appointment' && s.code !== 'clase')
}

// Lista las clases próximas (mismas que ve la web), con id para poder borrar.
export async function listClasesAdmin() {
  return fetchUpcoming('appointment', 300)
}

export async function crearClase({ serviceId, startsAt, endsAt, location, capacity }) {
  return req('POST', `/api/services/${serviceId}/sessions`, {
    startsAt, endsAt, location: location || undefined, capacity: capacity ? Number(capacity) : undefined,
  })
}

export async function editarClase(sessionId, { startsAt, endsAt, location, capacity }) {
  return req('PATCH', `/api/services/sessions/${sessionId}`, {
    startsAt, endsAt, location: location || undefined, capacity: capacity ? Number(capacity) : undefined,
  })
}

export async function borrarSesion(sessionId) {
  return req('DELETE', `/api/services/sessions/${sessionId}`)
}

// ── Admin de productos del marketplace (platform/catalog items) ──────
export async function listProductos() {
  const j = await req('GET', '/api/catalog/items?activeOnly=false&limit=200')
  return j?.data ?? j ?? []
}
export async function crearProducto({ name, priceCents, category, itemType, description }) {
  return req('POST', '/api/catalog/items', {
    name, priceCents, category: category || undefined, itemType: itemType || 'physical',
    description: description || undefined, currency: 'EUR',
  })
}
export async function editarProducto(id, body) {
  return req('PATCH', `/api/catalog/items/${id}`, body)
}
export async function borrarProducto(id) {
  return req('DELETE', `/api/catalog/items/${id}`)
}

// Sesiones públicas próximas (kind: 'event' | 'appointment').
export async function fetchUpcoming(kind, limit) {
  const j = await req('GET', `/api/services/sessions/upcoming?${qs(kind, limit)}`)
  return j?.data ?? []
}

// Normaliza una sesión al shape que usa la landing para "próximos eventos".
export function toEvento(s) {
  return {
    id: s.id,
    date: s.starts_at,
    name: s.session_description || s.service_name || s.description || 'Sesión',
    location: s.location || '',
  }
}

// Agrupa sesiones de clase (appointment) por día de la semana → shape de Horario.
const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
const CORTO = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB']
const ORDEN = [1, 2, 3, 4, 5, 6, 0] // Lun→Dom

export function sessionsToHorario(sessions) {
  const byDow = new Map(ORDEN.map((d) => [d, []]))
  for (const s of sessions) {
    const d = new Date(s.starts_at)
    const dow = d.getDay()
    const hora = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    if (!byDow.has(dow)) continue
    const arr = byDow.get(dow)
    // dedupe por (hora,tipo,ubicación) — varias semanas comparten la misma clase semanal
    const tipo = s.service_name || s.session_description || 'Clase'
    const key = `${hora}|${tipo}|${s.location}`
    if (arr.some((c) => c._key === key)) continue
    arr.push({ _key: key, hora, tipo, ubicacion: s.location || '', nivel: '' })
  }
  return ORDEN.map((d) => ({
    dia: DIAS[d], corto: CORTO[d],
    clases: byDow.get(d).sort((a, b) => a.hora.localeCompare(b.hora)),
  }))
}

// Reservar una sesión (requiere sesión de usuario). bookings module.
export async function reservarSesion({ sessionId, packageId } = {}) {
  return req('POST', '/api/bookings/', { sessionId, packageId })
}

// Comprar un bono: crea checkout en commerce + sesión de pago en payments.
export async function comprarBono({ templateId, amountCents }) {
  const co = await req('POST', '/api/commerce/checkouts', { kind: 'package', refId: templateId, amountCents })
  const checkoutId = co?.data?.id ?? co?.id
  const origin = window.location.origin
  const pay = await req('POST', '/api/payments/checkout-sessions', {
    amountCents,
    metadata: { commerceCheckoutId: checkoutId },
    successUrl: `${origin}/?bono=ok`,
    cancelUrl: `${origin}/?bono=cancel`,
  })
  const data = pay?.data ?? pay
  // enlaza la transacción al checkout para que commerce la case al cobrar
  if (checkoutId && data?.transactionId) {
    await req('PATCH', `/api/commerce/checkouts/${checkoutId}`, { providerTxId: data.transactionId }).catch(() => {})
  }
  return data // { url, qr, transactionId }
}
