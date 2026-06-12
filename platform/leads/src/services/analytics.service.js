import { pool } from '../lib/db.js'
import * as analytics from '../repositories/analytics.repository.js'
import * as leadsRepo from '../repositories/leads.repository.js'

export async function funnel(range) {
  const client = await pool.connect()
  try { return await analytics.funnel(client, range) } finally { client.release() }
}

export async function byDimension(dimension, range) {
  const client = await pool.connect()
  try { return await analytics.byDimension(client, dimension, range) } finally { client.release() }
}

export async function byOwner(range) {
  const client = await pool.connect()
  try { return await analytics.byOwner(client, range) } finally { client.release() }
}

export async function timeseries(granularity, range) {
  const client = await pool.connect()
  try { return await analytics.timeseries(client, granularity, range) } finally { client.release() }
}

// ── Export CSV ──────────────────────────────────────────────────────────────
// Reutiliza el mismo listado filtrado del CRM (mismas columnas LIST_COLS) y lo
// serializa a CSV. Tope alto por defecto para exportar el embudo completo.

const CSV_COLUMNS = [
  'id', 'created_at', 'updated_at', 'status', 'contact_name', 'email',
  'business_name', 'phone', 'industry', 'source', 'app_id', 'assigned_to',
  'score', 'lost_reason', 'tags', 'utm_source', 'utm_medium', 'utm_campaign',
  'next_follow_up_at', 'converted_tenant_id', 'converted_at',
]

// Escapa un valor para una celda CSV (RFC 4180): comillas dobladas y el campo
// entrecomillado si contiene coma, comilla o salto de línea.
function csvCell(value) {
  if (value === null || value === undefined) return ''
  let s = Array.isArray(value) ? value.join('; ') : String(value)
  if (value instanceof Date) s = value.toISOString()
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`
  return s
}

export function toCsv(rows, columns = CSV_COLUMNS) {
  const header = columns.join(',')
  const lines = rows.map((row) => columns.map((c) => csvCell(row[c])).join(','))
  return [header, ...lines].join('\n')
}

export async function exportCsv(filters) {
  const client = await pool.connect()
  let rows
  try {
    rows = await leadsRepo.list(client, { ...filters, limit: filters.limit ?? 5000, offset: filters.offset ?? 0 })
  } finally {
    client.release()
  }
  return toCsv(rows)
}
