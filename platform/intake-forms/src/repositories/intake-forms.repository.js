import { encodeAnswers } from '../lib/answers-codec.js'

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
  // Encrypt answers at rest (art. 9 GDPR). When answers carry data we store the
  // ciphertext in answers_encrypted and blank the plaintext column to '{}'.
  const hasAnswers = s.answers != null && Object.keys(s.answers).length > 0
  const answersEncrypted = hasAnswers ? encodeAnswers(s.answers) : null
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.submissions
       (app_id, tenant_id, template_id, booking_id, client_user_id, answers, answers_encrypted,
        signature_url, signature_object_id, signed_at, status, submitted_at,
        consent_text, consent_version, consent_accepted_at, legal_basis)
     VALUES ($1,$2,$3,$4,$5,'{}'::jsonb,$6,$7,$8,$9,COALESCE($10,'pending'),$11,$12,$13,$14,$15)
     RETURNING *`,
    [appId, tenantId, s.templateId, s.bookingId ?? null, s.clientUserId,
     answersEncrypted, s.signatureUrl ?? null, s.signatureObjectId ?? null,
     s.signedAt ?? null, s.status ?? 'pending', s.submittedAt ?? null,
     s.consentText ?? null, s.consentVersion ?? null, s.consentAcceptedAt ?? null,
     s.legalBasis ?? null],
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
  // Answers are encrypted at rest; the plaintext column is blanked to '{}'.
  const answersEncrypted = encodeAnswers(answers)
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.submissions
     SET answers='{}'::jsonb,
         answers_encrypted   = $4,
         signature_url       = COALESCE($5, signature_url),
         signature_object_id = COALESCE($6, signature_object_id),
         signed_at = CASE
           WHEN ($5 IS NOT NULL OR $6 IS NOT NULL) AND signed_at IS NULL THEN now()
           ELSE signed_at
         END,
         status='submitted', submitted_at=now(), updated_at=now()
     WHERE app_id=$1 AND tenant_id=$2 AND id=$3 RETURNING *`,
    [appId, tenantId, id, answersEncrypted, signatureUrl ?? null, signatureObjectId ?? null],
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

// Staff listing with filters + keyset-free offset pagination (use-case #2).
// All filters are tenant-scoped; returns { items, total, limit, offset }.
export async function listSubmissions(client, appId, tenantId, opts = {}) {
  const filters = ['app_id = $1', 'tenant_id = $2']
  const params  = [appId, tenantId]
  const add = (col, val, cast = '') => {
    params.push(val)
    filters.push(`${col} = $${params.length}${cast}`)
  }
  if (opts.status)       add('status', opts.status)
  if (opts.templateId)   add('template_id', opts.templateId, '::uuid')
  if (opts.clientUserId) add('client_user_id', opts.clientUserId, '::uuid')
  if (opts.bookingId)    add('booking_id', opts.bookingId, '::uuid')
  if (opts.from) { params.push(opts.from); filters.push(`created_at >= $${params.length}`) }
  if (opts.to)   { params.push(opts.to);   filters.push(`created_at <= $${params.length}`) }

  const where = filters.join(' AND ')
  const { rows: countRows } = await client.query(
    `SELECT COUNT(*)::int AS total FROM ${SCHEMA}.submissions WHERE ${where}`,
    params,
  )
  const total = countRows[0]?.total ?? 0

  const limit  = Math.min(Math.max(opts.limit ?? 50, 1), 200)
  const offset = Math.max(opts.offset ?? 0, 0)
  params.push(limit, offset)
  // Note: answers_encrypted is intentionally NOT selected — the listing is a
  // staff index that must not bulk-decrypt special-category data; fetch the
  // individual submission to read answers.
  const { rows: items } = await client.query(
    `SELECT id, app_id, tenant_id, template_id, booking_id, client_user_id,
            status, signature_object_id, signed_at, submitted_at,
            reviewed_by_user_id, reviewed_at, erased_at, created_at, updated_at
       FROM ${SCHEMA}.submissions
      WHERE ${where}
      ORDER BY created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  )
  return { items, total, limit, offset }
}

// Right to erasure (use-case #5): anonymise answers + signature but keep the
// submission skeleton for audit. Idempotent — re-erasing is a no-op update.
export async function eraseSubmission(client, appId, tenantId, id, erasedByUserId) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.submissions
     SET answers='{}'::jsonb,
         answers_encrypted = NULL,
         signature_url     = NULL,
         signature_object_id = NULL,
         erased_at = COALESCE(erased_at, now()),
         erased_by_user_id = COALESCE(erased_by_user_id, $4),
         updated_at = now()
     WHERE app_id=$1 AND tenant_id=$2 AND id=$3 RETURNING *`,
    [appId, tenantId, id, erasedByUserId],
  )
  return rows[0] ?? null
}
