// Auth del portal (login del owner/staff). Reutiliza platform/auth. El JWT se
// guarda bajo una clave propia y se comparte con la consola embebida
// (@apphub/tenant-console-ui) vía configureAuth, así hay una sola fuente de
// verdad del token.
import { configureAuth, refreshSession, ensureSession } from '@apphub/tenant-console-ui'

export const APP_ID = 'luciapassardi'
// Tenant del seed (apps/luciapassardi/seed.sql). Override por env si hace falta.
export const TENANT_ID = import.meta.env.VITE_LUCIAPASSARDI_TENANT_ID ?? '70000000-0000-0000-0000-000000000001'
const TOKEN_KEY = 'lucia_access_token'
const REFRESH_KEY = `${TOKEN_KEY}.refresh`   // misma convención que tenant-console-ui

// La consola embebida lee/escribe el MISMO token. Reexportamos el refresh del
// paquete compartido (opera sobre TOKEN_KEY/REFRESH_KEY) para mantener la
// sesión viva con el refresh token (access 15 min, refresh 90 días).
configureAuth({ tokenKey: TOKEN_KEY })
export { refreshSession, ensureSession }

const BASE = import.meta.env.VITE_API_BASE_URL ?? ''

export async function login({ email, password }) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appId: APP_ID, tenantId: TENANT_ID, email, password }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json?.error?.message ?? json?.error?.code ?? `HTTP ${res.status}`)
  const data = json?.data ?? json
  if (!data?.accessToken) throw new Error('Login sin accessToken')
  localStorage.setItem(TOKEN_KEY, data.accessToken)
  if (data.refreshToken) localStorage.setItem(REFRESH_KEY, data.refreshToken)
  return getIdentity()
}

export function logout() { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(REFRESH_KEY) }
export function getToken() { return localStorage.getItem(TOKEN_KEY) }

export function getIdentity() {
  const token = getToken()
  if (!token) return null
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    // Caducado: devolvemos null SIN logout — conservamos el token para que
    // refreshSession() pueda renovar la sesión con el refresh token.
    if (payload.exp && payload.exp * 1000 < Date.now()) return null
    return { userId: payload.sub, appId: payload.app_id, tenantId: payload.tenant_id, role: payload.role, email: payload.email }
  } catch { return null }
}

const ADMIN_ROLES = new Set(['owner', 'admin', 'staff', 'super_admin'])
export function isAdmin(role) { return ADMIN_ROLES.has(role) }

// ── Sesión de invitado para la cesta de la landing (visitante anónimo) ──
// platform/basket y platform/orders exigen identidad; los visitantes anónimos
// usan un JWT role='guest' emitido por platform/auth (POST /api/auth/guest).
// Se cachea con su guestUserId para reanudar la misma cesta entre visitas.
const GUEST_KEY = 'lucia_guest'

function readGuest() {
  try { return JSON.parse(localStorage.getItem(GUEST_KEY) || 'null') } catch { return null }
}
function tokenExpired(token) {
  try {
    const p = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return p.exp && p.exp * 1000 < Date.now()
  } catch { return true }
}

async function mintGuest() {
  const prev = readGuest()
  const res = await fetch(`${BASE}/api/auth/guest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appId: APP_ID, tenantId: TENANT_ID, guestUserId: prev?.userId ?? null }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`)
  const data = json?.data ?? json
  const guest = { token: data.accessToken, userId: data.userId }
  localStorage.setItem(GUEST_KEY, JSON.stringify(guest))
  return guest.token
}

// Token para operar la cesta: el del usuario logueado si su token sigue vigente;
// si no hay (o caducó), un guest cacheado, re-emitido si caducó o si force=true
// (p.ej. tras un 401). Importante validar la caducidad del token de usuario: un
// lucia_access_token caducado en localStorage (de una sesión de backoffice
// previa) haría fallar la cesta con 401 si se reutilizara a ciegas.
export async function cartToken(force = false) {
  const user = getToken()
  if (user && !tokenExpired(user)) return user
  const guest = readGuest()
  if (!force && guest?.token && !tokenExpired(guest.token)) return guest.token
  return mintGuest()
}
