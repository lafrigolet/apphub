const APP_ID = import.meta.env.VITE_AIKIKAN_APP_ID ?? 'aikikan'
const TENANT_ID = import.meta.env.VITE_AIKIKAN_TENANT_ID ?? ''
const BASE = '/api/auth'

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
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
