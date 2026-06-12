const SCHEMA = 'platform_leads'

// Construye el fragmento WHERE de rango de fechas compartido por todos los
// reportes. Devuelve { clause, params } con los placeholders ya numerados a
// partir de `start` (1-based). `col` permite cualificar la columna cuando el
// FROM tiene join (p.ej. 'l.created_at') y `created_at` sería ambigua.
function dateRange({ createdFrom, createdTo } = {}, start = 1, col = 'created_at') {
  const parts = []
  const params = []
  if (createdFrom) { params.push(createdFrom); parts.push(`${col} >= $${start + params.length - 1}`) }
  if (createdTo)   { params.push(createdTo);   parts.push(`${col} <= $${start + params.length - 1}`) }
  return { clause: parts.length ? `WHERE ${parts.join(' AND ')}` : '', params }
}

// ── Embudo ────────────────────────────────────────────────────────────────
// (a) recuento actual por estado y (b) hitos del embudo: cuántos leads
// llegaron alguna vez a contacted/qualified/won/lost y el tiempo medio desde
// el alta hasta la primera entrada en ese estado. Los hitos salen del timeline
// (lead_activities type status_change), no del estado actual, para no perder
// los leads que ya avanzaron y retrocedieron.
export async function funnel(client, range = {}) {
  const counts = dateRange(range, 1)
  const { rows: statusCounts } = await client.query(
    `SELECT status, count(*)::int AS count
       FROM ${SCHEMA}.leads
       ${counts.clause}
       GROUP BY status`,
    counts.params,
  )

  const timing = dateRange(range, 1, 'l.created_at')
  const { rows: milestones } = await client.query(
    `WITH first_entry AS (
       SELECT a.lead_id, a.metadata->>'to' AS to_status, min(a.created_at) AS entered_at
         FROM ${SCHEMA}.lead_activities a
        WHERE a.type = 'status_change'
        GROUP BY a.lead_id, a.metadata->>'to'
     )
     SELECT fe.to_status AS status,
            count(*)::int AS reached,
            round(avg(extract(epoch FROM (fe.entered_at - l.created_at)) / 3600.0)::numeric, 2) AS avg_hours_from_creation
       FROM first_entry fe
       JOIN ${SCHEMA}.leads l ON l.id = fe.lead_id
       ${timing.clause}
       GROUP BY fe.to_status`,
    timing.params,
  )

  return { statusCounts, milestones }
}

// ── Por dimensión ───────────────────────────────────────────────────────────
// Volumen + ganados/perdidos por una dimensión de la fila. La columna NO es
// user-input libre: el caller pasa una clave validada y aquí la mapeamos a un
// nombre de columna de la whitelist (defensa en profundidad frente a inyección).
const DIMENSION_COLUMNS = {
  source:       'source',
  app_id:       'app_id',
  industry:     'industry',
  utm_source:   'utm_source',
  utm_campaign: 'utm_campaign',
}

export async function byDimension(client, dimension, range = {}) {
  const col = DIMENSION_COLUMNS[dimension]
  if (!col) throw new Error(`unknown analytics dimension: ${dimension}`)
  const { clause, params } = dateRange(range, 1)
  const { rows } = await client.query(
    `SELECT coalesce(${col}, '(none)') AS dimension,
            count(*)::int                                  AS total,
            count(*) FILTER (WHERE status = 'won')::int    AS won,
            count(*) FILTER (WHERE status = 'lost')::int   AS lost
       FROM ${SCHEMA}.leads
       ${clause}
       GROUP BY ${col}
       ORDER BY total DESC`,
    params,
  )
  return rows
}

// ── Productividad por comercial (owner) ─────────────────────────────────────
export async function byOwner(client, range = {}) {
  const { clause, params } = dateRange(range, 1)
  const where = clause ? `${clause} AND assigned_to IS NOT NULL` : 'WHERE assigned_to IS NOT NULL'
  const { rows } = await client.query(
    `SELECT assigned_to,
            count(*)::int                                                        AS total,
            count(*) FILTER (WHERE status = 'won')::int                          AS won,
            count(*) FILTER (WHERE status = 'lost')::int                         AS lost,
            count(*) FILTER (WHERE status IN ('new','contacted','qualified'))::int AS open,
            round((avg(extract(epoch FROM (converted_at - created_at)) / 3600.0)
                   FILTER (WHERE converted_at IS NOT NULL))::numeric, 2)         AS avg_hours_to_won
       FROM ${SCHEMA}.leads
       ${where}
       GROUP BY assigned_to
       ORDER BY total DESC`,
    params,
  )
  return rows
}

// ── Serie temporal ──────────────────────────────────────────────────────────
// Leads creados y ganados por bucket. La granularidad la valida el caller
// (enum day|week|month) — date_trunc la admite como texto parametrizado.
export async function timeseries(client, granularity, range = {}) {
  const counts = dateRange(range, 2) // $1 reservado para la granularidad
  const { rows } = await client.query(
    `SELECT date_trunc($1, created_at) AS bucket,
            count(*)::int                               AS created,
            count(*) FILTER (WHERE status = 'won')::int AS won
       FROM ${SCHEMA}.leads
       ${counts.clause}
       GROUP BY bucket
       ORDER BY bucket`,
    [granularity, ...counts.params],
  )
  return rows
}
