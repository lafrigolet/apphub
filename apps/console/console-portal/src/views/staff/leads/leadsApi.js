import { api } from '../../../lib/api'

// Traduce la bandeja + filtros del CRM a la querystring que espera
// GET /api/leads/admin/. Pura (testeable sin red).
//   inbox: 'all' | 'mine' | 'unassigned' | 'followup'
//   filters: { status, q }
export function buildListQuery(inbox, filters = {}) {
  const p = new URLSearchParams()
  if (inbox === 'mine')       p.set('assignedTo', 'me')
  if (inbox === 'unassigned') p.set('assignedTo', 'none')
  if (inbox === 'followup')   p.set('followUpDue', 'true')
  if (filters.status && filters.status !== 'ALL') p.set('status', filters.status)
  if (filters.q) p.set('q', filters.q)
  p.set('limit', '200')
  return p.toString()
}

export function listLeads(inbox, filters) {
  return api.get(`/api/leads/admin/?${buildListQuery(inbox, filters)}`).then((r) => r?.data ?? [])
}

export function getLead(id) {
  return api.get(`/api/leads/admin/${id}`).then((r) => r?.data ?? null)
}

export function getActivities(id) {
  return api.get(`/api/leads/admin/${id}/activities`).then((r) => r?.data ?? [])
}

export function patchLead(id, patch) {
  return api.patch(`/api/leads/admin/${id}`, patch).then((r) => r?.data ?? null)
}

export function addActivity(id, entry) {
  return api.post(`/api/leads/admin/${id}/activities`, entry).then((r) => r?.data ?? null)
}

export function deleteLead(id) {
  return api.delete(`/api/leads/admin/${id}`)
}

export function convertLead(id, tenantId) {
  return api.post(`/api/leads/admin/${id}/convert`, { tenantId }).then((r) => r?.data ?? null)
}

// ── Analítica (Fase 1) ──────────────────────────────────────────────────────
export function getFunnel() {
  return api.get('/api/leads/admin/analytics/funnel').then((r) => r?.data ?? { statusCounts: [], milestones: [] })
}
export function getByDimension(dimension) {
  return api.get(`/api/leads/admin/analytics/by-dimension?dimension=${dimension}`).then((r) => r?.data ?? [])
}
export function getByOwner() {
  return api.get('/api/leads/admin/analytics/by-owner').then((r) => r?.data ?? [])
}
export function getTimeseries(granularity) {
  return api.get(`/api/leads/admin/analytics/timeseries?granularity=${granularity}`).then((r) => r?.data ?? [])
}

// Export CSV: el endpoint devuelve text/csv (no JSON), así que esquivamos
// api.js y hacemos un fetch directo con el token, descargando el blob.
export async function downloadLeadsCsv(inbox, filters) {
  const base = import.meta.env.VITE_API_BASE_URL ?? ''
  const token = localStorage.getItem('apphub.token')
  const res = await fetch(`${base}/api/leads/admin/analytics/export.csv?${buildListQuery(inbox, filters)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) throw new Error('export failed')
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'leads-export.csv'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
