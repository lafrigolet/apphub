import { getAccessToken } from './auth.js'

// Thin fetch wrapper for the aikikan portal admin views. Auto-attaches
// the JWT, parses JSON, throws on non-2xx with the error.message field
// the backend returns. Same shape as the helper duplicated in
// AdminSubscription.jsx / Events.jsx — extracted here so the new admin
// CRUD doesn't re-implement it once more.
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
  if (!res.ok) throw new Error(json.error?.message ?? res.statusText)
  return json
}
