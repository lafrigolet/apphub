// JWT auth helpers. Token is stored in localStorage under a configurable
// key — by default `apphub.token`, but a host portal (e.g. aikikan) can
// `configureAuth({ tokenKey: 'aikikan_access_token' })` so the package
// reads/writes the same key the host already uses. configureAuth must be
// called BEFORE the AppProvider mounts (it reads the key synchronously
// in useState init).
import { api } from './api'

let TOKEN_KEY = 'apphub.token'
let consumed = false

const BASE = import.meta.env.VITE_API_BASE_URL ?? ''
// El refresh token se guarda junto al access token, bajo una clave derivada del
// mismo TOKEN_KEY que configure el host, para que ambos paquetes (este y el
// lib/auth propio del portal) coincidan en la convención.
const refreshKey = () => `${TOKEN_KEY}.refresh`

function decodePayload(token) {
  try {
    const [, b64] = token.split('.')
    return JSON.parse(atob(b64.replace(/-/g, '+').replace(/_/g, '/')))
  } catch { return null }
}
function isExpired(token) {
  const p = decodePayload(token)
  return !p || (p.exp && p.exp * 1000 < Date.now())
}
function saveSession({ accessToken, refreshToken }) {
  if (accessToken) localStorage.setItem(TOKEN_KEY, accessToken)
  if (refreshToken) localStorage.setItem(refreshKey(), refreshToken)
}
export function getRefreshToken() { return localStorage.getItem(refreshKey()) }

// Renueva el access token con el refresh token (rotándolo). Usa fetch directo
// —no el wrapper api— para no recursar en el manejo de 401. Devuelve el nuevo
// access token, o null si no se pudo (refresh ausente/caducado → sesión muerta).
let refreshing = null
export async function refreshSession() {
  if (refreshing) return refreshing
  refreshing = (async () => {
    const rt = getRefreshToken()
    const at = localStorage.getItem(TOKEN_KEY)
    const p = at && decodePayload(at)
    if (!rt || !p) return null
    try {
      const res = await fetch(`${BASE}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId: p.app_id, tenantId: p.tenant_id, userId: p.sub, refreshToken: rt }),
      })
      if (!res.ok) { logout(); return null }
      const data = (await res.json().catch(() => ({})))?.data ?? {}
      if (!data.accessToken) { logout(); return null }
      saveSession(data)
      return data.accessToken
    } catch { return null }
  })()
  try { return await refreshing } finally { refreshing = null }
}

// Sesión válida para arrancar: si el access token sigue vigente lo devuelve; si
// caducó pero hay refresh token, intenta renovarlo. Lo usan los hosts al montar
// para sobrevivir a recargas pasados los 15 min del access token.
export async function ensureSession() {
  const at = localStorage.getItem(TOKEN_KEY)
  if (at && !isExpired(at)) return getIdentity()
  if (getRefreshToken()) { await refreshSession() }
  return getIdentity()
}

export function configureAuth({ tokenKey } = {}) {
  if (tokenKey && tokenKey !== TOKEN_KEY) TOKEN_KEY = tokenKey
  // Re-run the fragment consumer with the (possibly new) key. Guarded so
  // we don't strip the URL on every render; the underlying matcher does
  // nothing when the fragment has already been removed.
  if (!consumed) {
    consumeTokenFromFragment()
    consumed = true
  }
}

// Cross-origin handoff: otros portales (aikikan, futuros) que tengan su
// propio login pueden mandar a un admin a la tenant-console pegándole un
// fragmento `#token=<jwt>`. Lo guardamos en localStorage y limpiamos el
// fragmento para que no quede en bookmarks ni en historial. Los fragments
// no viajan al server, así que el JWT no aparece en logs ni referers.
function consumeTokenFromFragment() {
  if (typeof window === 'undefined' || !window.location.hash) return
  const m = window.location.hash.match(/(?:^#|&)token=([^&]+)/)
  if (!m) return
  try {
    const token = decodeURIComponent(m[1])
    localStorage.setItem(TOKEN_KEY, token)
    const remaining = window.location.hash
      .replace(/(^#|&)token=[^&]+/, '')
      .replace(/^#&/, '#')
      .replace(/^#$/, '')
    window.history.replaceState(null, '', window.location.pathname + window.location.search + remaining)
  } catch {
    // malformed — ignore
  }
}
// Default no-op import-time call so apps that don't configure still get
// the legacy `apphub.token` behaviour. configureAuth re-runs it with the
// host's key when wired up.
consumeTokenFromFragment()

export async function login({ email, password }) {
  const res = await api.post('/api/auth/login', { email, password })
  const data = res?.data ?? res
  if (!data?.accessToken) throw new Error('Respuesta de login sin token')
  saveSession(data)
  return getIdentity()
}

// Magic-link de bootstrap. El owner llega desde el email con
// /activate?token=...; aquí consume el token, fija contraseña y guarda
// la sesión bajo el TOKEN_KEY del host. El backend devuelve par
// access/refresh listo para usar.
export async function activate({ token, password }) {
  const res = await api.post('/api/auth/activate', { token, password })
  const data = res?.data ?? res
  if (!data?.accessToken) throw new Error('Respuesta de activate sin token')
  saveSession(data)
  return getIdentity()
}

export function logout() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(refreshKey())
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY)
}

export function getIdentity() {
  const token = getToken()
  if (!token) return null
  try {
    const [, payloadB64] = token.split('.')
    const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')))
    // Caducado: NO hacemos logout aquí — conservamos el token para que
    // refreshSession() pueda leer sus claims (app/tenant/user) y renovarlo.
    if (payload.exp && payload.exp * 1000 < Date.now()) return null
    return {
      userId:   payload.sub,
      appId:    payload.app_id,
      tenantId: payload.tenant_id,
      role:     payload.role,
      email:    payload.email,
    }
  } catch {
    logout()
    return null
  }
}
