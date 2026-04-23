import { api } from './api'

const TOKEN_KEY = 'apphub.token'

// Voragine-console constants — kept exported because a few views/modals use them.
const APP_ID          = 'voragine-console'
const PLATFORM_APP    = 'platform'
const PLATFORM_TENANT = '00000000-0000-0000-0000-0000000000f0'

/**
 * Log in with email + password. The platform-auth service looks up the user's
 * (app_id, tenant_id) from the email, so the portal doesn't need to ask the
 * user to pick a tenant or declare whether they're staff.
 */
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

export { APP_ID, PLATFORM_APP, PLATFORM_TENANT }
