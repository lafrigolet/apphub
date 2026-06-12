// API client del portal web. Llamadas relativas a /api/* → el gateway NGINX
// las enruta (auth, payments). En dev las proxya vite a nginx:80.
//
// El appId/tenantId NO se hardcodean: se resuelven por subdominio del host
// (tpv.hulkstein.com → tenant) vía resolveScope(), para que un mismo portal
// sirva a cualquier tenant configurado desde console.
import { resolveScope } from './tenant.js'

const DEV_EMAIL = 'cajero@tpv.local'
const DEV_PASSWORD = 'tpv1234'

let _token = null

async function req(method, path, { body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (auth && _token) headers.Authorization = `Bearer ${_token}`
  const res = await fetch(path, { method, headers, body: body != null ? JSON.stringify(body) : undefined })
  const text = await res.text()
  const json = text ? JSON.parse(text) : {}
  if (!res.ok) throw new Error(json?.error?.message ?? json?.error?.code ?? `HTTP ${res.status}`)
  return json
}

// Login silencioso del cajero (V1 sin pantalla de login — creds dev del seed).
// Resuelve appId/tenantId por subdominio antes de autenticar.
export async function login() {
  const { appId, tenantId } = await resolveScope()
  const { data } = await req('POST', '/api/auth/login', {
    auth: false,
    body: { appId, tenantId, email: DEV_EMAIL, password: DEV_PASSWORD },
  })
  _token = data.accessToken ?? data.tokens?.accessToken
  if (!_token) throw new Error('Login sin accessToken')
}

export async function createCheckoutSession(amountCents) {
  const origin = window.location.origin
  const { data } = await req('POST', '/api/payments/checkout-sessions', {
    body: {
      amountCents,
      successUrl: `${origin}/?paid=1`,
      cancelUrl: `${origin}/?canceled=1`,
    },
  })
  return data // { transactionId, sessionId, url, payUrl, qr, status, stub }
}

// Polling por transactionId: el webhook checkout.session.completed marca la
// transacción 'succeeded'.
export async function getCheckoutStatus(transactionId) {
  const { data } = await req('GET', `/api/payments/checkout-sessions/${transactionId}`)
  return data // transacción { id, status, ... }
}
