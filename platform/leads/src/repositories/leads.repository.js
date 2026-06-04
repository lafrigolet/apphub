const SCHEMA = 'platform_leads'

// Columnas devueltas en listados (sin ip/user_agent — solo en findById).
const LIST_COLS = `id, created_at, updated_at, contact_name, email, business_name,
       phone, industry, message, source, status, staff_notes, assigned_to,
       score, lost_reason, tags, app_id, utm_source, utm_medium, utm_campaign,
       next_follow_up_at, converted_tenant_id, converted_at`

export async function insert(client, lead) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.leads
       (contact_name, email, business_name, phone, industry, message, source,
        ip, user_agent, app_id, custom_fields,
        utm_source, utm_medium, utm_campaign, utm_term, utm_content,
        referrer, landing_url, consent_text, consent_version, consent_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
             $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
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
      lead.appId ?? null,
      lead.customFields ?? null,
      lead.utmSource ?? null,
      lead.utmMedium ?? null,
      lead.utmCampaign ?? null,
      lead.utmTerm ?? null,
      lead.utmContent ?? null,
      lead.referrer ?? null,
      lead.landingUrl ?? null,
      lead.consentText ?? null,
      lead.consentVersion ?? null,
      lead.consentAt ?? null,
    ],
  )
  return rows[0]
}

export async function list(client, {
  status, assignedTo, industry, source, appId, tag, q,
  followUpDue, createdFrom, createdTo,
  sort = 'created_at', dir = 'desc', limit = 100, offset = 0,
} = {}) {
  const filters = []
  const params  = []
  const add = (sql, value) => { params.push(value); filters.push(sql.replace('?', `$${params.length}`)) }

  if (status)   add('status = ?', status)
  if (industry) add('industry = ?', industry)
  if (source)   add('source = ?', source)
  if (appId)    add('app_id = ?', appId)
  if (tag)      add('? = ANY(tags)', tag)
  if (assignedTo === 'none') filters.push('assigned_to IS NULL')
  else if (assignedTo)       add('assigned_to = ?', assignedTo)
  if (createdFrom) add('created_at >= ?', createdFrom)
  if (createdTo)   add('created_at <= ?', createdTo)
  if (followUpDue) filters.push('next_follow_up_at IS NOT NULL AND next_follow_up_at <= now()')
  if (q) {
    params.push(`%${q}%`)
    const p = `$${params.length}`
    filters.push(`(contact_name ILIKE ${p} OR email ILIKE ${p} OR business_name ILIKE ${p} OR message ILIKE ${p})`)
  }

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : ''
  // sort/dir vienen validados por el zod enum de la ruta — nunca user-input libre.
  const orderBy = `ORDER BY ${sort} ${dir === 'asc' ? 'ASC' : 'DESC'}`
  params.push(limit, offset)
  const { rows } = await client.query(
    `SELECT ${LIST_COLS}
       FROM ${SCHEMA}.leads
       ${where}
       ${orderBy}
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

// Update parcial: solo toca las columnas presentes en `fields` (camelCase).
// Siempre refresca updated_at. Devuelve la fila completa actualizada.
const UPDATABLE = {
  status:         'status',
  staffNotes:     'staff_notes',
  assignedTo:     'assigned_to',
  score:          'score',
  lostReason:     'lost_reason',
  tags:           'tags',
  customFields:   'custom_fields',
  nextFollowUpAt: 'next_follow_up_at',
}

export async function update(client, id, fields) {
  const sets   = []
  const params = [id]
  for (const [key, col] of Object.entries(UPDATABLE)) {
    if (fields[key] === undefined) continue
    params.push(fields[key])
    sets.push(`${col} = $${params.length}`)
  }
  if (sets.length === 0) return findById(client, id)
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.leads
        SET ${sets.join(', ')}, updated_at = now()
      WHERE id = $1
      RETURNING *`,
    params,
  )
  return rows[0] ?? null
}

// Conversión lead → tenant. Solo convierte una vez (converted_tenant_id IS
// NULL) — el caller traduce "0 filas" a 409 si el lead ya estaba convertido.
export async function convert(client, id, tenantId) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.leads
        SET converted_tenant_id = $2, converted_at = now(),
            status = 'won', updated_at = now()
      WHERE id = $1 AND converted_tenant_id IS NULL
      RETURNING *`,
    [id, tenantId],
  )
  return rows[0] ?? null
}

// GDPR — borrado físico. lead_activities cae por ON DELETE CASCADE.
export async function remove(client, id) {
  const { rows } = await client.query(
    `DELETE FROM ${SCHEMA}.leads WHERE id = $1 RETURNING id, email`, [id],
  )
  return rows[0] ?? null
}

export async function updateStatus(client, id, status, staffNotes) {
  // Legacy — conservado para compatibilidad; el camino nuevo es update().
  return update(client, id, { status, ...(staffNotes != null ? { staffNotes } : {}) })
}

// ── Timeline de actividad ────────────────────────────────────────────────

export async function insertActivity(client, leadId, entry) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.lead_activities
       (lead_id, author_user_id, author_email, type, body, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, created_at, type`,
    [
      leadId,
      entry.authorUserId ?? null,
      entry.authorEmail ?? null,
      entry.type,
      entry.body ?? null,
      entry.metadata ?? null,
    ],
  )
  return rows[0]
}

export async function listActivities(client, leadId, { limit = 100, offset = 0 } = {}) {
  const { rows } = await client.query(
    `SELECT id, created_at, author_user_id, author_email, type, body, metadata
       FROM ${SCHEMA}.lead_activities
      WHERE lead_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3`,
    [leadId, limit, offset],
  )
  return rows
}
