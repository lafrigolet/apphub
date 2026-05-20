// HTTP client del portal. Por defecto usa rutas relativas (vite proxy /api/* →
// nginx en dev; nginx directamente en prod). `VITE_API_BASE_URL` es solo un
// fallback cuando el portal corre fuera de su subdominio (p.ej. localhost:5179
// sin pasar por nginx).
const BASE = import.meta.env.VITE_API_BASE_URL ?? ''

// V1 — la landing pública resuelve el tenant por subdominio en el servidor
// (futuro). Mientras tanto, fijamos el tenant de la Fundación AulaVera para
// que ?tenantId=… pueda viajar en las GETs públicas hasta aulavera-server.
export const DEFAULT_TENANT_ID = '70000000-0000-0000-0000-000000000001'

async function req(method, path, body) {
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    const msg = err?.error?.message ?? err?.message ?? res.statusText
    throw Object.assign(new Error(msg), { status: res.status, body: err })
  }
  return res.status === 204 ? null : res.json()
}

export const api = {
  get:    (path)       => req('GET',    path),
  post:   (path, body) => req('POST',   path, body),
  put:    (path, body) => req('PUT',    path, body),
  patch:  (path, body) => req('PATCH',  path, body),
  delete: (path)       => req('DELETE', path),
}

// ─── Aulavera-server ────────────────────────────────────────────────────
const tq = `?tenantId=${DEFAULT_TENANT_ID}`

export const aulavera = {
  listEvents: (kind) =>
    api.get(`/api/aulavera/events${tq}${kind ? `&kind=${kind}` : ''}`),
  listDisciplines: () => api.get(`/api/aulavera/disciplines${tq}`),
  listResources: (type) =>
    api.get(`/api/aulavera/resources${tq}${type ? `&type=${type}` : ''}`),
}

// ─── Platform leads (contacto + reservas vía señal) ─────────────────────
export const leads = {
  create: (payload) => api.post('/api/leads/', payload),
}

// ─── Platform donations (one-shot + recurring) ──────────────────────────
export const donations = {
  // V1 — el subdominio aulavera.hulkstein.local sirve también /donations/ok
  // y /donations/cancel como rutas SPA; cualquier ruta no-prefijada cae en
  // el catch-all del router (Home). Para success/cancel se pueden definir
  // rutas concretas más adelante.
  checkout: (payload) => api.post('/api/donations/checkout', {
    appId:    'aulavera',
    tenantId: DEFAULT_TENANT_ID,
    currency: 'EUR',
    ...payload,
  }),
}
