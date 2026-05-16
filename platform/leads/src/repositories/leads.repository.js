const SCHEMA = 'platform_leads'

export async function insert(client, lead) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.leads
       (contact_name, email, business_name, phone, industry, message, source, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, created_at, status`,
    [
      lead.contactName,
      lead.email,
      lead.businessName ?? null,
      lead.phone ?? null,
      lead.industry ?? null,
      lead.message ?? null,
      lead.source ?? null,
      lead.ip ?? null,
      lead.userAgent ?? null,
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
    `SELECT id, created_at, contact_name, email, business_name, phone,
            industry, message, source, status, staff_notes
       FROM ${SCHEMA}.leads
       ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  )
  return rows
}

export async function findById(client, id) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.leads WHERE id = $1`, [id],
  )
  return rows[0] ?? null
}

export async function updateStatus(client, id, status, staffNotes) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.leads
        SET status = $2,
            staff_notes = COALESCE($3, staff_notes)
      WHERE id = $1
      RETURNING id, status, staff_notes`,
    [id, status, staffNotes ?? null],
  )
  return rows[0] ?? null
}
