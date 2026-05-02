// JWT auth helpers. The login form posts {email, password}; the auth service
// resolves (app_id, tenant_id, role) from the user record and returns an
// access token whose claims drive the rest of the shell.
import { api } from './api'

const TOKEN_KEY = 'apphub.token'

export async function login({ email, password }) {
  const res = await api.post('/api/auth/login', { email, password })
  const accessToken = res?.data?.accessToken ?? res?.accessToken
  if (!accessToken) throw new Error('Respuesta de login sin token')
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
