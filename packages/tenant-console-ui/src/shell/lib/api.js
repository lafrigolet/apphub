// Thin fetch wrapper used by every shell + module view.
// Same shape as voragine-console's lib/api.js (raises 'apphub:unauthorized'
// on 401 so the shell can drop to the login screen).
//
// Reads the JWT via the auth module so the host portal's tokenKey choice
// (configurable via configureAuth) is honored consistently.
import { getToken, logout } from './auth'

const BASE = import.meta.env.VITE_API_BASE_URL ?? ''

async function request(method, path, body) {
  const headers = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  })

  if (res.status === 401) {
    logout()
    window.dispatchEvent(new CustomEvent('apphub:unauthorized'))
    throw Object.assign(new Error('Unauthorized'), { status: 401 })
  }

  if (!res.ok) {
    let msg = res.statusText
    try {
      const b = await res.json()
      msg = b?.error?.message ?? msg
    } catch { /* ignore */ }
    throw Object.assign(new Error(msg), { status: res.status })
  }

  if (res.status === 204) return null
  return res.json()
}

export const api = {
  get:    (path)       => request('GET',    path),
  post:   (path, body) => request('POST',   path, body),
  put:    (path, body) => request('PUT',    path, body),
  patch:  (path, body) => request('PATCH',  path, body),
  delete: (path)       => request('DELETE', path),
}
