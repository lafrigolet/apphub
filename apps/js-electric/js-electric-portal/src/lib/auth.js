// Auth passwordless del portal js-electric — magic-link only.
// El admin pide un enlace por email (POST /v1/auth/request-magic-link),
// hace click en el email y aterriza en /magic-login?token=... donde se
// canjea el token por sesión (POST /v1/auth/login-with-magic-link).
// El email lo manda platform/notifications consumiendo el evento
// `auth.magic_link_requested` y construye la URL como
// http(s)://<subdomain>.<domain>/magic-login?token=… (ver
// platform/notifications/src/services/event-consumer.js:115).
//
// Sin OAuth / sin password / sin signup público — la landing es marketing
// y el único user con cuenta es el admin seeded.
import { APP_ID, resolveTenantId } from './tenant.js'

const BASE = '/api/auth'

const ADMIN_ROLES = new Set(['owner', 'admin', 'staff', 'super_admin'])

const TOKEN_KEY   = 'js_electric_access_token'
const REFRESH_KEY = 'js_electric_refresh_token'
const USER_KEY    = 'js_electric_user_id'
const ROLE_KEY    = 'js_electric_role'

function compact(obj) {
  const out = {}
  for (const [k, v] of Object.entries(obj)) if (v !== '' && v != null) out[k] = v
  return out
}

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(compact(body)),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error?.message ?? json.message ?? 'Error desconocido')
  return json.data ?? json
}

function saveSession({ accessToken, refreshToken, userId, role }) {
  localStorage.setItem(TOKEN_KEY,   accessToken)
  localStorage.setItem(REFRESH_KEY, refreshToken)
  localStorage.setItem(USER_KEY,    userId)
  localStorage.setItem(ROLE_KEY,    role)
}

export function getAccessToken() {
  return localStorage.getItem(TOKEN_KEY)
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(REFRESH_KEY)
  localStorage.removeItem(USER_KEY)
  localStorage.removeItem(ROLE_KEY)
}

// Decodifica el JWT sin verificar firma — solo para drive UI.
// La verificación de firma sigue ocurriendo server-side en cada API call.
export function decodeToken(token) {
  if (!token) return null
  try {
    const [, payloadB64] = token.split('.')
    const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')))
    if (payload.exp && payload.exp * 1000 < Date.now()) return null
    return payload
  } catch {
    return null
  }
}

export function getIdentity() {
  const payload = decodeToken(getAccessToken())
  if (!payload) return null
  return {
    userId:   payload.sub,
    appId:    payload.app_id,
    tenantId: payload.tenant_id,
    role:     payload.role,
    email:    payload.email,
  }
}

export function isAdminRole(role) {
  return ADMIN_ROLES.has(role)
}

// Paso 1 — el visitante introduce email. El backend resuelve el user por
// (appId, tenantId, email) y emite `auth.magic_link_requested` para que
// notifications envíe el email. La respuesta es silenciosa ante emails
// desconocidos (no exposición de inventario de usuarios).
export async function requestMagicLink(email) {
  const tenantId = await resolveTenantId(APP_ID)
  return post('/request-magic-link', { appId: APP_ID, tenantId, email })
}

// Paso 2 — el user pulsa el link del email y aterriza en /magic-login?token=…
// MagicLogin.jsx llama aquí para canjear el token por sesión.
export async function loginWithMagicLink(token) {
  const data = await post('/login-with-magic-link', { token })
  saveSession(data)
  return data
}
