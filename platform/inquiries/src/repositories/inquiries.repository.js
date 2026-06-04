const SCHEMA = 'platform_inquiries'

const COLS = `
  id, reference, app_id, tenant_id, sub_tenant_id,
  contact_name, email, phone, subject, message, source, metadata,
  status, staff_notes, assigned_to, category, close_reason,
  consent_text, consent_version, consent_at,
  csat_score, csat_comment, csat_submitted_at,
  ip, user_agent,
  created_at, updated_at, contacted_at, closed_at,
  deleted_at, anonymized_at
`

export async function insert(client, inquiry) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.inquiries
       (reference, app_id, tenant_id, sub_tenant_id,
        contact_name, email, phone, subject, message, source, metadata,
        category, consent_text, consent_version, consent_at,
        ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
             $12, $13, $14, $15, $16, $17)
     RETURNING ${COLS}`,
    [
      inquiry.reference,
      inquiry.appId,
      inquiry.tenantId,
      inquiry.subTenantId ?? null,
      inquiry.contactName,
      inquiry.email,
      inquiry.phone ?? null,
      inquiry.subject ?? null,
      inquiry.message,
      inquiry.source ?? null,
      inquiry.metadata ?? {},
      inquiry.category ?? null,
      inquiry.consentText ?? null,
      inquiry.consentVersion ?? null,
      inquiry.consentAt ?? null,
      inquiry.ip ?? null,
      inquiry.userAgent ?? null,
    ],
  )
  return rows[0]
}

// List con filtros combinados (#5/#8). Por defecto excluye soft-deleted.
// `assignedTo='me'` lo resuelve el service (sustituye por el userId del staff).
export async function list(client, {
  status, source, category, assignedTo, email,
  createdFrom, createdTo, q,
  includeDeleted = false,
  limit = 100, offset = 0,
} = {}) {
  const filters = []
  const params  = []
  const add = (sql, value) => { params.push(value); filters.push(sql.replace('?', `$${params.length}`)) }

  if (!includeDeleted) filters.push('deleted_at IS NULL')
  if (status)   add('status = ?', status)
  if (source)   add('source = ?', source)
  if (category) add('category = ?', category)
  if (email)    add('lower(email) = lower(?)', email)
  if (assignedTo === 'none') filters.push('assigned_to IS NULL')
  else if (assignedTo)       add('assigned_to = ?', assignedTo)
  if (createdFrom) add('created_at >= ?', createdFrom)
  if (createdTo)   add('created_at <= ?', createdTo)
  if (q) {
    // Full-text sobre la generated column; plainto_tsquery tolera input libre.
    add('search_tsv @@ plainto_tsquery(\'simple\', ?)', q)
  }

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : ''
  params.push(limit, offset)
  const { rows } = await client.query(
    `SELECT ${COLS}
       FROM ${SCHEMA}.inquiries
       ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  )
  return rows
}

export async function findById(client, id) {
  const { rows } = await client.query(
    `SELECT ${COLS} FROM ${SCHEMA}.inquiries WHERE id = $1`,
    [id],
  )
  return rows[0] ?? null
}

// Lookup público por referencia citable — usado por el flujo CSAT del visitante
// (que no tiene JWT). Excluye filas soft-deleted/anonimizadas. RLS sigue
// escopando por (app_id, tenant_id), así que la referencia sola no basta para
// leer la de otro tenant.
export async function findByReference(client, reference) {
  const { rows } = await client.query(
    `SELECT ${COLS} FROM ${SCHEMA}.inquiries
      WHERE reference = $1 AND deleted_at IS NULL AND anonymized_at IS NULL`,
    [reference],
  )
  return rows[0] ?? null
}

// FSM: stamp contacted_at/closed_at en la transición canónica.
// status puede ser cualquiera del CHECK constraint; el caller (service)
// valida la FSM ANTES de llamar aquí. closeReason se sella al cerrar/resolver.
export async function updateStatus(client, id, status, staffNotes, closeReason) {
  const stampField = status === 'contacted'
    ? 'contacted_at = COALESCE(contacted_at, now())'
    : (status === 'closed' || status === 'spam' || status === 'resolved')
      ? 'closed_at = COALESCE(closed_at, now())'
      : null
  const stampClause = stampField ? `, ${stampField}` : ''
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.inquiries
        SET status       = $2,
            staff_notes  = COALESCE($3, staff_notes),
            close_reason = COALESCE($4, close_reason)
            ${stampClause}
      WHERE id = $1
      RETURNING ${COLS}`,
    [id, status, staffNotes ?? null, closeReason ?? null],
  )
  return rows[0] ?? null
}

// Asignación a un miembro del staff (#8). assignedTo=null desasigna.
export async function assign(client, id, assignedTo) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.inquiries
        SET assigned_to = $2
      WHERE id = $1
      RETURNING ${COLS}`,
    [id, assignedTo ?? null],
  )
  return rows[0] ?? null
}

// CSAT — el visitante puntúa la atención. Solo se sella una vez.
export async function submitCsat(client, id, { score, comment }) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.inquiries
        SET csat_score        = $2,
            csat_comment      = $3,
            csat_submitted_at = now()
      WHERE id = $1 AND csat_submitted_at IS NULL
      RETURNING ${COLS}`,
    [id, score, comment ?? null],
  )
  return rows[0] ?? null
}

// GDPR — soft-delete (right to be forgotten sin perder auditoría). El evento
// que publique el service NO debe llevar PII.
export async function softDelete(client, id) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.inquiries
        SET deleted_at = COALESCE(deleted_at, now())
      WHERE id = $1
      RETURNING id, app_id, tenant_id`,
    [id],
  )
  return rows[0] ?? null
}

// GDPR — anonimización: borra PII del visitante conservando datos analíticos
// agregados (status, fechas, category). Usado por la purga de retención y por
// el ejercicio explícito del derecho de supresión.
export async function anonymize(client, id) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.inquiries
        SET contact_name  = '[anonymized]',
            email         = 'anonymized@removed.invalid',
            phone         = NULL,
            ip            = NULL,
            user_agent    = NULL,
            message       = '[anonymized]',
            staff_notes   = NULL,
            csat_comment  = NULL,
            metadata      = '{}'::jsonb,
            anonymized_at = COALESCE(anonymized_at, now())
      WHERE id = $1 AND anonymized_at IS NULL
      RETURNING ${COLS}`,
    [id],
  )
  return rows[0] ?? null
}

// GDPR retención (#9/#17): localiza consultas más viejas que `olderThan` aún
// sin anonimizar/soft-delete dentro del tenant. La purga real se hace fila a
// fila con anonymize() para reaprovechar la limpieza de PII. Escopado por RLS.
export async function findRetentionDue(client, olderThan, limit = 500) {
  const { rows } = await client.query(
    `SELECT id FROM ${SCHEMA}.inquiries
      WHERE created_at < $1
        AND anonymized_at IS NULL
        AND deleted_at IS NULL
      ORDER BY created_at ASC
      LIMIT $2`,
    [olderThan, limit],
  )
  return rows.map((r) => r.id)
}

// Analítica agregada por tenant (#15): conteo por estado, MTR (tiempo medio a
// primer contacto), MTTR (a cierre), tasa de spam, CSAT medio. Escopada por
// RLS (app_id+tenant_id) y por la ventana opcional [from, to].
export async function analytics(client, { createdFrom, createdTo } = {}) {
  const filters = ['deleted_at IS NULL']
  const params  = []
  if (createdFrom) { params.push(createdFrom); filters.push(`created_at >= $${params.length}`) }
  if (createdTo)   { params.push(createdTo);   filters.push(`created_at <= $${params.length}`) }
  const where = `WHERE ${filters.join(' AND ')}`
  const { rows } = await client.query(
    `SELECT
        count(*)::int                                                          AS total,
        count(*) FILTER (WHERE status = 'new')::int                            AS new_count,
        count(*) FILTER (WHERE status = 'contacted')::int                      AS contacted_count,
        count(*) FILTER (WHERE status = 'resolved')::int                       AS resolved_count,
        count(*) FILTER (WHERE status = 'closed')::int                         AS closed_count,
        count(*) FILTER (WHERE status = 'spam')::int                           AS spam_count,
        avg(EXTRACT(EPOCH FROM (contacted_at - created_at)))
          FILTER (WHERE contacted_at IS NOT NULL)                              AS avg_first_response_seconds,
        avg(EXTRACT(EPOCH FROM (closed_at - created_at)))
          FILTER (WHERE closed_at IS NOT NULL)                                 AS avg_resolution_seconds,
        avg(csat_score) FILTER (WHERE csat_score IS NOT NULL)                  AS avg_csat
       FROM ${SCHEMA}.inquiries
       ${where}`,
    params,
  )
  return rows[0]
}

// ── Timeline de actividad ────────────────────────────────────────────────

export async function insertActivity(client, inquiryId, entry) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.inquiry_activities
       (inquiry_id, app_id, tenant_id, author_user_id, author_email, type, body, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, created_at, author_user_id, author_email, type, body, metadata`,
    [
      inquiryId,
      entry.appId,
      entry.tenantId,
      entry.authorUserId ?? null,
      entry.authorEmail ?? null,
      entry.type,
      entry.body ?? null,
      entry.metadata ?? null,
    ],
  )
  return rows[0]
}

export async function listActivities(client, inquiryId, { limit = 100, offset = 0 } = {}) {
  const { rows } = await client.query(
    `SELECT id, created_at, author_user_id, author_email, type, body, metadata
       FROM ${SCHEMA}.inquiry_activities
      WHERE inquiry_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3`,
    [inquiryId, limit, offset],
  )
  return rows
}
