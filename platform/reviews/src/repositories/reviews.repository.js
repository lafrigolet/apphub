const SCHEMA = 'platform_reviews'

export async function insert(client, appId, tenantId, r) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.reviews
       (app_id, tenant_id, target_type, target_id, order_id, buyer_user_id, rating, title, body, status, verified_purchase)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, COALESCE($10, 'published'), COALESCE($11, FALSE))
     RETURNING *`,
    [
      appId, tenantId, r.targetType, r.targetId, r.orderId ?? null,
      r.buyerUserId, r.rating, r.title ?? null, r.body ?? null, r.status ?? null,
      r.verifiedPurchase ?? false,
    ],
  )
  return rows[0]
}

export async function findById(client, appId, tenantId, id) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.reviews WHERE app_id=$1 AND tenant_id=$2 AND id=$3`,
    [appId, tenantId, id],
  )
  return rows[0] ?? null
}

// Whitelisted ORDER BY clauses. Never interpolate caller input directly into
// SQL — map a known `sort` token to a fixed, safe clause.
const SORT_CLAUSES = {
  recent:        'created_at DESC',
  oldest:        'created_at ASC',
  helpful:       'helpful_count DESC, created_at DESC',
  rating_high:   'rating DESC, created_at DESC',
  rating_low:    'rating ASC, created_at DESC',
}

export async function listByTarget(client, appId, tenantId, { targetType, targetId, status = 'published', verifiedOnly = false, sort = 'recent', limit = 50, offset = 0 }) {
  const filters = [
    'app_id=$1', 'tenant_id=$2', 'target_type=$3', 'target_id=$4', 'status=$5',
  ]
  const params = [appId, tenantId, targetType, targetId, status]
  if (verifiedOnly) filters.push('verified_purchase = TRUE')
  const orderBy = SORT_CLAUSES[sort] ?? SORT_CLAUSES.recent
  params.push(limit, offset)
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.reviews
     WHERE ${filters.join(' AND ')}
     ORDER BY ${orderBy}
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  )
  return rows
}

// Moderation queue: reviews in a given status (default 'pending') for the
// whole tenant, newest first — backs the staff triage screen.
export async function listForModeration(client, appId, tenantId, { status = 'pending', limit = 50, offset = 0 }) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.reviews
     WHERE app_id=$1 AND tenant_id=$2 AND status=$3
     ORDER BY created_at DESC
     LIMIT $4 OFFSET $5`,
    [appId, tenantId, status, limit, offset],
  )
  return rows
}

export async function aggregate(client, appId, tenantId, { targetType, targetId }) {
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS total,
            AVG(rating)::float AS average,
            COUNT(*) FILTER (WHERE rating = 1)::int AS r1,
            COUNT(*) FILTER (WHERE rating = 2)::int AS r2,
            COUNT(*) FILTER (WHERE rating = 3)::int AS r3,
            COUNT(*) FILTER (WHERE rating = 4)::int AS r4,
            COUNT(*) FILTER (WHERE rating = 5)::int AS r5,
            COUNT(*) FILTER (WHERE verified_purchase = TRUE)::int AS verified_count
     FROM ${SCHEMA}.reviews
     WHERE app_id=$1 AND tenant_id=$2 AND target_type=$3 AND target_id=$4 AND status='published'`,
    [appId, tenantId, targetType, targetId],
  )
  return rows[0]
}

export async function setStatus(client, appId, tenantId, id, status, moderationReason = null) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.reviews
     SET status=$4, moderation_reason=$5, updated_at=now()
     WHERE app_id=$1 AND tenant_id=$2 AND id=$3
     RETURNING *`,
    [appId, tenantId, id, status, moderationReason],
  )
  return rows[0] ?? null
}

export async function deleteById(client, appId, tenantId, id) {
  const { rowCount } = await client.query(
    `DELETE FROM ${SCHEMA}.reviews WHERE app_id=$1 AND tenant_id=$2 AND id=$3`,
    [appId, tenantId, id],
  )
  return rowCount > 0
}

// ── Voting (helpful/unhelpful) ──────────────────────────────────────────

export async function upsertVote(client, appId, tenantId, reviewId, voterUserId, voteValue) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.review_votes (app_id, tenant_id, review_id, voter_user_id, vote_value)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (review_id, voter_user_id) DO UPDATE
       SET vote_value = EXCLUDED.vote_value, created_at = now()
     RETURNING *`,
    [appId, tenantId, reviewId, voterUserId, voteValue],
  )
  return rows[0]
}

export async function deleteVote(client, appId, tenantId, reviewId, voterUserId) {
  const { rowCount } = await client.query(
    `DELETE FROM ${SCHEMA}.review_votes
       WHERE app_id=$1 AND tenant_id=$2 AND review_id=$3 AND voter_user_id=$4`,
    [appId, tenantId, reviewId, voterUserId],
  )
  return rowCount > 0
}

export async function recomputeVoteCounts(client, appId, tenantId, reviewId) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.reviews
        SET helpful_count = (
              SELECT COUNT(*) FROM ${SCHEMA}.review_votes
               WHERE review_id = $3 AND vote_value =  1),
            unhelpful_count = (
              SELECT COUNT(*) FROM ${SCHEMA}.review_votes
               WHERE review_id = $3 AND vote_value = -1)
      WHERE app_id=$1 AND tenant_id=$2 AND id=$3
      RETURNING helpful_count, unhelpful_count`,
    [appId, tenantId, reviewId],
  )
  return rows[0] ?? null
}

// ── Media (photo/video attachments via platform_storage) ────────────────

export async function insertMedia(client, appId, tenantId, reviewId, m) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.review_media (app_id, tenant_id, review_id, object_id, kind, display_order)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, 0))
     RETURNING *`,
    [appId, tenantId, reviewId, m.objectId, m.kind, m.displayOrder ?? 0],
  )
  return rows[0]
}

export async function listMedia(client, appId, tenantId, reviewId) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.review_media
       WHERE app_id=$1 AND tenant_id=$2 AND review_id=$3
       ORDER BY display_order, created_at`,
    [appId, tenantId, reviewId],
  )
  return rows
}

export async function deleteMedia(client, appId, tenantId, mediaId) {
  const { rowCount } = await client.query(
    `DELETE FROM ${SCHEMA}.review_media WHERE app_id=$1 AND tenant_id=$2 AND id=$3`,
    [appId, tenantId, mediaId],
  )
  return rowCount > 0
}

export async function insertReply(client, appId, tenantId, reviewId, vendorUserId, body) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.review_replies (app_id, tenant_id, review_id, vendor_user_id, body)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [appId, tenantId, reviewId, vendorUserId, body],
  )
  return rows[0]
}

export async function listReplies(client, appId, tenantId, reviewId) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.review_replies
     WHERE app_id=$1 AND tenant_id=$2 AND review_id=$3 ORDER BY created_at ASC`,
    [appId, tenantId, reviewId],
  )
  return rows
}

// ── Reports / abuse flags ───────────────────────────────────────────────

export async function upsertReport(client, appId, tenantId, reviewId, reporterUserId, reason, detail) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.review_reports
       (app_id, tenant_id, review_id, reporter_user_id, reason, detail)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (review_id, reporter_user_id) DO UPDATE
       SET reason = EXCLUDED.reason, detail = EXCLUDED.detail,
           status = 'open', created_at = now()
     RETURNING *`,
    [appId, tenantId, reviewId, reporterUserId, reason, detail ?? null],
  )
  return rows[0]
}

export async function countOpenReports(client, appId, tenantId, reviewId) {
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS count FROM ${SCHEMA}.review_reports
       WHERE app_id=$1 AND tenant_id=$2 AND review_id=$3 AND status='open'`,
    [appId, tenantId, reviewId],
  )
  return rows[0].count
}

// Staff triage: list reports for the tenant filtered by status, newest first.
export async function listReports(client, appId, tenantId, { status = 'open', limit = 50, offset = 0 }) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.review_reports
       WHERE app_id=$1 AND tenant_id=$2 AND status=$3
       ORDER BY created_at DESC
       LIMIT $4 OFFSET $5`,
    [appId, tenantId, status, limit, offset],
  )
  return rows
}

export async function setReportStatus(client, appId, tenantId, reportId, status) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.review_reports
       SET status=$4
       WHERE app_id=$1 AND tenant_id=$2 AND id=$3
       RETURNING *`,
    [appId, tenantId, reportId, status],
  )
  return rows[0] ?? null
}
