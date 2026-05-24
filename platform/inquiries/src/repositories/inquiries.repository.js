const SCHEMA = 'platform_inquiries'

const COLS = `
  id, reference, app_id, tenant_id, sub_tenant_id,
  contact_name, email, phone, subject, message, source, metadata,
  status, staff_notes, ip, user_agent,
  created_at, updated_at, contacted_at, closed_at
`

export async function insert(client, inquiry) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.inquiries
       (reference, app_id, tenant_id, sub_tenant_id,
        contact_name, email, phone, subject, message, source, metadata,
        ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
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
      inquiry.ip ?? null,
      inquiry.userAgent ?? null,
    ],
  )
  return rows[0]
}

export async function list(client, { status, limit = 100, offset = 0 } = {}) {
  const filters = []
  const params  = []
  if (status) {
    filters.push(`status = $${params.length + 1}`)
    params.push(status)
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

// FSM: stamp contacted_at/closed_at en la transición canónica.
// status puede ser cualquiera del CHECK constraint; el caller (service)
// valida la FSM ANTES de llamar aquí.
export async function updateStatus(client, id, status, staffNotes) {
  const stampField = status === 'contacted'
    ? 'contacted_at = COALESCE(contacted_at, now())'
    : (status === 'closed' || status === 'spam')
      ? 'closed_at = COALESCE(closed_at, now())'
      : null
  const stampClause = stampField ? `, ${stampField}` : ''
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.inquiries
        SET status      = $2,
            staff_notes = COALESCE($3, staff_notes)
            ${stampClause}
      WHERE id = $1
      RETURNING ${COLS}`,
    [id, status, staffNotes ?? null],
  )
  return rows[0] ?? null
}
