import { API_BASE, API_PREFIX, APP_ID, TENANT_ID, DEV_EMAIL, DEV_PASSWORD, CURRENCY } from '../config.js'

let _token = null

async function req(method, path, { body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (auth && _token) headers.Authorization = `Bearer ${_token}`
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  const json = text ? JSON.parse(text) : {}
  if (!res.ok) {
    const msg = json?.error?.message ?? json?.error?.code ?? `HTTP ${res.status}`
    throw new Error(msg)
  }
  return json
}

// Login silencioso del cajero → guarda el access token para el resto de llamadas.
export async function login() {
  const { data } = await req('POST', `${API_PREFIX}/auth/login`, {
    auth: false,
    body: { appId: APP_ID, tenantId: TENANT_ID, email: DEV_EMAIL, password: DEV_PASSWORD },
  })
  _token = data.accessToken ?? data.tokens?.accessToken
  if (!_token) throw new Error('Login sin accessToken')
  return _token
}

export function isLoggedIn() {
  return !!_token
}

// tokenProvider del SDK de Stripe Terminal: devuelve el connection token secret.
export async function fetchConnectionToken() {
  const { data } = await req('POST', `${API_PREFIX}/payments/terminal/connection-token`)
  return data // { secret, locationId, stub }
}

// Crea el PaymentIntent card_present para el importe del teclado.
export async function createTerminalIntent(amountCents) {
  const { data } = await req('POST', `${API_PREFIX}/payments/terminal/intents`, {
    body: { amountCents, currency: CURRENCY },
  })
  return data // { paymentIntentId, clientSecret, status, stub }
}
