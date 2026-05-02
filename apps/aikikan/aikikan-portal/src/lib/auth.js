const APP_ID = import.meta.env.VITE_AIKIKAN_APP_ID ?? 'aikikan'
const TENANT_ID = import.meta.env.VITE_AIKIKAN_TENANT_ID ?? ''
const BASE = '/api/auth'

// Roles que reciben acceso a la tenant-console (rol "admin" en sentido
// amplio): owner del tenant, admin del tenant, y los roles de plataforma
// que se cuelan por error si alguien usa la misma cuenta. Cualquier otro
// rol (en la práctica `user`) es socio y se queda en el portal aikikan.
const ADMIN_ROLES = new Set(['owner', 'admin', 'staff', 'super_admin'])

// Strip falsy fields. El schema zod del backend declara los IDs como
// `.uuid().optional()`, lo cual acepta `undefined` pero NO una cadena
// vacía: si VITE_AIKIKAN_TENANT_ID no está poblada, mandar `tenantId: ''`
// devolvería 422. Eliminar las claves vacías antes de serializar evita
// ese caso y deja al servicio resolver el tenant por email.
function compact(obj) {
  const out = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v !== '' && v != null) out[k] = v
  }
  return out
}

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(compact(body)),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error?.message ?? 'Error desconocido')
  return json.data
}

function saveSession({ accessToken, refreshToken, userId, role }) {
  localStorage.setItem('aikikan_access_token', accessToken)
  localStorage.setItem('aikikan_refresh_token', refreshToken)
  localStorage.setItem('aikikan_user_id', userId)
  localStorage.setItem('aikikan_role', role)
}

export function getAccessToken() {
  return localStorage.getItem('aikikan_access_token')
}

export function clearSession() {
  localStorage.removeItem('aikikan_access_token')
  localStorage.removeItem('aikikan_refresh_token')
  localStorage.removeItem('aikikan_user_id')
  localStorage.removeItem('aikikan_role')
}

// Decodes the JWT payload without verifying the signature — we only need
// the claims to drive UI routing. Verification still happens server-side
// on every API call.
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
  const token = getAccessToken()
  const payload = decodeToken(token)
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

// Builds the URL of the per-tenant console for the current host. The
// suffix preserves whatever environment we're in (apphub.local:8080 in
// dev, apphub.com en prod) so this works sin tocar configuración.
// El access token viaja en el fragmento (#token=…); los fragments NO se
// envían al server, así que el JWT no aparece en logs de NGINX ni en
// referers. El tenant-console lo lee on-mount y lo guarda en su propio
// localStorage.
export function tenantConsoleUrl(accessToken) {
  if (typeof window === 'undefined') return '/'
  const { protocol, hostname, port } = window.location
  const suffix = hostname.split('.').slice(1).join('.') || hostname
  const portPart = port ? `:${port}` : ''
  return `${protocol}//tenant-console.${suffix}${portPart}/#token=${encodeURIComponent(accessToken)}`
}

export async function login({ email, password }) {
  const data = await post('/login', { appId: APP_ID, tenantId: TENANT_ID, email, password })
  saveSession(data)
  return data
}

export async function register({ email, password }) {
  const data = await post('/register', { appId: APP_ID, tenantId: TENANT_ID, email, password, role: 'user' })
  return data
}

export async function loginGoogle(credential) {
  const data = await post('/oauth/google', { appId: APP_ID, tenantId: TENANT_ID, credential })
  saveSession(data)
  return data
}

export async function loginFacebook(accessToken) {
  const data = await post('/oauth/facebook', { appId: APP_ID, tenantId: TENANT_ID, accessToken })
  saveSession(data)
  return data
}

export async function forgotPassword(email) {
  return post('/forgot-password', { appId: APP_ID, tenantId: TENANT_ID, email })
}
