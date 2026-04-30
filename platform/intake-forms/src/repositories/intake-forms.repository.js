const SCHEMA = 'platform_intake_forms'

export async function insertTemplate(client, appId, tenantId, t) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.templates
       (app_id, tenant_id, code, name, description, schema, version, is_published, requires_signature)
     VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,1),COALESCE($8,FALSE),COALESCE($9,FALSE))
     RETURNING *`,
    [appId, tenantId, t.code, t.name, t.description ?? null, t.schema,
     t.version ?? 1, t.isPublished ?? false, t.requiresSignature ?? false],
  )
  return rows[0]
}

export async function findTemplateById(client, appId, tenantId, id) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.templates WHERE app_id=$1 AND tenant_id=$2 AND id=$3`,
    [appId, tenantId, id],
  )
  return rows[0] ?? null
}

export async function listTemplates(client, appId, tenantId, { onlyPublished = false } = {}) {
  const filters = ['app_id = $1', 'tenant_id = $2']
  const params  = [appId, tenantId]
  if (onlyPublished) filters.push('is_published = TRUE')
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.templates WHERE ${filters.join(' AND ')} ORDER BY name, version DESC`,
    params,
  )
  return rows
}

export async function publishTemplate(client, appId, tenantId, id) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.templates SET is_published = TRUE, updated_at = now()
     WHERE app_id=$1 AND tenant_id=$2 AND id=$3 RETURNING *`,
    [appId, tenantId, id],
  )
  return rows[0] ?? null
}

export async function insertSubmission(client, appId, tenantId, s) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.submissions
       (app_id, tenant_id, template_id, booking_id, client_user_id, answers,
        signature_url, signature_object_id, signed_at, status, submitted_at)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6,'{}'::jsonb),$7,$8,$9,COALESCE($10,'pending'),$11)
     RETURNING *`,
    [appId, tenantId, s.templateId, s.bookingId ?? null, s.clientUserId,
     s.answers ?? {}, s.signatureUrl ?? null, s.signatureObjectId ?? null,
     s.signedAt ?? null, s.status ?? 'pending', s.submittedAt ?? null],
  )
  return rows[0]
}

export async function findSubmissionById(client, appId, tenantId, id) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.submissions WHERE app_id=$1 AND tenant_id=$2 AND id=$3`,
    [appId, tenantId, id],
  )
  return rows[0] ?? null
}

export async function findSubmissionByBookingId(client, appId, tenantId, bookingId) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.submissions
     WHERE app_id=$1 AND tenant_id=$2 AND booking_id=$3
     ORDER BY created_at DESC LIMIT 1`,
    [appId, tenantId, bookingId],
  )
  return rows[0] ?? null
}

export async function submitAnswers(client, appId, tenantId, id, { answers, signatureUrl, signatureObjectId }) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.submissions
     SET answers=$4,
         signature_url       = COALESCE($5, signature_url),
         signature_object_id = COALESCE($6, signature_object_id),
         signed_at = CASE
           WHEN ($5 IS NOT NULL OR $6 IS NOT NULL) AND signed_at IS NULL THEN now()
           ELSE signed_at
         END,
         status='submitted', submitted_at=now(), updated_at=now()
     WHERE app_id=$1 AND tenant_id=$2 AND id=$3 RETURNING *`,
    [appId, tenantId, id, answers, signatureUrl ?? null, signatureObjectId ?? null],
  )
  return rows[0] ?? null
}

export async function reviewSubmission(client, appId, tenantId, id, reviewerUserId) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.submissions
     SET status='reviewed', reviewed_by_user_id=$4, reviewed_at=now(), updated_at=now()
     WHERE app_id=$1 AND tenant_id=$2 AND id=$3 RETURNING *`,
    [appId, tenantId, id, reviewerUserId],
  )
  return rows[0] ?? null
}
