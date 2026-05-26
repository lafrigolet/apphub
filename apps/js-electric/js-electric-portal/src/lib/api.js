import { getAccessToken } from './auth.js'

// Wrapper fino sobre fetch. Adjunta automáticamente Bearer si hay token
// en localStorage. Los POST públicos (form de contacto del landing) van
// sin Authorization cuando no hay sesión — el módulo platform/inquiries
// declara la ruta con `config: { public: true }` así que appGuard lo deja
// pasar. Patrón fuente: apps/aikikan/aikikan-portal/src/lib/api.js.
export async function api(method, path, body) {
  const token = getAccessToken()
  const res = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  })
  if (res.status === 204) return null
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error?.message ?? json.message ?? res.statusText)
  return json
}
