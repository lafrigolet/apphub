const BASE = import.meta.env.VITE_API_BASE_URL ?? ''

function getToken() {
  return localStorage.getItem('apphub.token')
}

async function request(method, path, body) {
  const headers = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  })

  // Unauthorized: clear token, drop to login screen
  if (res.status === 401) {
    localStorage.removeItem('apphub.token')
    window.dispatchEvent(new CustomEvent('apphub:unauthorized'))
    throw Object.assign(new Error('Unauthorized'), { status: 401 })
  }

  if (!res.ok) {
    let msg = res.statusText
    try {
      const body = await res.json()
      msg = body?.error?.message ?? msg
    } catch { /* ignore parse error */ }
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
