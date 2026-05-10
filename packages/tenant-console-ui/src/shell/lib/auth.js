// JWT auth helpers. Token is stored in localStorage under a configurable
// key — by default `apphub.token`, but a host portal (e.g. aikikan) can
// `configureAuth({ tokenKey: 'aikikan_access_token' })` so the package
// reads/writes the same key the host already uses. configureAuth must be
// called BEFORE the AppProvider mounts (it reads the key synchronously
// in useState init).
import { api } from './api'

let TOKEN_KEY = 'apphub.token'
let consumed = false

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
  const accessToken = res?.data?.accessToken ?? res?.accessToken
  if (!accessToken) throw new Error('Respuesta de login sin token')
  localStorage.setItem(TOKEN_KEY, accessToken)
  return getIdentity()
}

// Magic-link de bootstrap. El owner llega desde el email con
// /activate?token=...; aquí consume el token, fija contraseña y guarda
// la sesión bajo el TOKEN_KEY del host. El backend devuelve par
// access/refresh listo para usar.
export async function activate({ token, password }) {
  const res = await api.post('/api/auth/activate', { token, password })
  const accessToken = res?.data?.accessToken ?? res?.accessToken
  if (!accessToken) throw new Error('Respuesta de activate sin token')
  localStorage.setItem(TOKEN_KEY, accessToken)
  return getIdentity()
}

export function logout() {
  localStorage.removeItem(TOKEN_KEY)
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
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      logout()
      return null
    }
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
