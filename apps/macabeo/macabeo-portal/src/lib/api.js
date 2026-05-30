// Thin fetch wrapper. Auto-Bearer will be added by /opendragon-implementa
// once auth.js exists; for now the portal makes no authenticated calls.
export async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body != null ? JSON.stringify(body) : undefined,
  })
  if (res.status === 204) return null
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error?.message ?? json.message ?? res.statusText)
  return json
}
