const SCHEMA = 'platform_reviews'

export async function insert(client, appId, tenantId, r) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.reviews
       (app_id, tenant_id, target_type, target_id, order_id, buyer_user_id, rating, title, body, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, COALESCE($10, 'published'))
     RETURNING *`,
    [
      appId, tenantId, r.targetType, r.targetId, r.orderId ?? null,
      r.buyerUserId, r.rating, r.title ?? null, r.body ?? null, r.status ?? null,
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

export async function listByTarget(client, appId, tenantId, { targetType, targetId, status = 'published', limit = 50, offset = 0 }) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.reviews
     WHERE app_id=$1 AND tenant_id=$2 AND target_type=$3 AND target_id=$4 AND status=$5
     ORDER BY created_at DESC
     LIMIT $6 OFFSET $7`,
    [appId, tenantId, targetType, targetId, status, limit, offset],
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
            COUNT(*) FILTER (WHERE rating = 5)::int AS r5
     FROM ${SCHEMA}.reviews
     WHERE app_id=$1 AND tenant_id=$2 AND target_type=$3 AND target_id=$4 AND status='published'`,
    [appId, tenantId, targetType, targetId],
  )
  return rows[0]
}

export async function setStatus(client, appId, tenantId, id, status) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.reviews
     SET status=$4, updated_at=now()
     WHERE app_id=$1 AND tenant_id=$2 AND id=$3
     RETURNING *`,
    [appId, tenantId, id, status],
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
