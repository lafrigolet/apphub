const SCHEMA = 'platform_disputes'

export async function insert(client, appId, tenantId, d) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.disputes
       (app_id, tenant_id, order_id, buyer_user_id, reason, reason_code, description, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7, COALESCE($8,'open'))
     RETURNING *`,
    [appId, tenantId, d.orderId, d.buyerUserId, d.reason, d.reasonCode ?? null, d.description ?? null, d.status ?? null],
  )
  return rows[0]
}

export async function findById(client, appId, tenantId, id) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.disputes WHERE app_id=$1 AND tenant_id=$2 AND id=$3`,
    [appId, tenantId, id],
  )
  return rows[0] ?? null
}

export async function findByOrderId(client, appId, tenantId, orderId) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.disputes WHERE app_id=$1 AND tenant_id=$2 AND order_id=$3`,
    [appId, tenantId, orderId],
  )
  return rows[0] ?? null
}

export async function listByTenant(client, appId, tenantId, { status, buyerUserId, reasonCode, limit = 50, offset = 0 } = {}) {
  const filters = ['app_id = $1', 'tenant_id = $2']
  const params  = [appId, tenantId]
  if (status) { filters.push(`status = $${params.length + 1}`); params.push(status) }
  if (buyerUserId) { filters.push(`buyer_user_id = $${params.length + 1}`); params.push(buyerUserId) }
  if (reasonCode) { filters.push(`reason_code = $${params.length + 1}`); params.push(reasonCode) }
  params.push(limit, offset)
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.disputes
     WHERE ${filters.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  )
  return rows
}

export async function updateStatus(client, appId, tenantId, id, fields) {
  const sets = ['status = $4', 'updated_at = now()']
  const params = [appId, tenantId, id, fields.status]
  if (fields.resolutionAmountCents !== undefined) {
    sets.push(`resolution_amount_cents = $${params.length + 1}`); params.push(fields.resolutionAmountCents)
  }
  if (fields.resolutionNotes !== undefined) {
    sets.push(`resolution_notes = $${params.length + 1}`); params.push(fields.resolutionNotes)
  }
  if (['resolved_buyer', 'resolved_vendor', 'escalated_chargeback'].includes(fields.status)) {
    sets.push(`resolved_at = now()`)
    sets.push(`resolved_by_user_id = $${params.length + 1}`); params.push(fields.resolvedByUserId ?? null)
  }
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.disputes SET ${sets.join(', ')}
     WHERE app_id=$1 AND tenant_id=$2 AND id=$3
     RETURNING *`,
    params,
  )
  return rows[0] ?? null
}

export async function insertMessage(client, appId, tenantId, disputeId, senderUserId, senderRole, body, attachments = [], isInternal = false) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.dispute_messages
       (app_id, tenant_id, dispute_id, sender_user_id, sender_role, body, attachments, is_internal)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [appId, tenantId, disputeId, senderUserId, senderRole, body, JSON.stringify(attachments), isInternal],
  )
  return rows[0]
}

// includeInternal=false hides staff-only internal notes from buyer/vendor.
export async function listMessages(client, appId, tenantId, disputeId, { includeInternal = true } = {}) {
  const filters = ['app_id=$1', 'tenant_id=$2', 'dispute_id=$3']
  if (!includeInternal) filters.push('is_internal = false')
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.dispute_messages
     WHERE ${filters.join(' AND ')} ORDER BY created_at ASC`,
    [appId, tenantId, disputeId],
  )
  return rows
}

// ── status history (append-only audit trail) ────────────────────────────

export async function insertStatusHistory(client, appId, tenantId, disputeId, h) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.dispute_status_history
       (app_id, tenant_id, dispute_id, from_status, to_status, actor_user_id, actor_role, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [appId, tenantId, disputeId, h.fromStatus ?? null, h.toStatus, h.actorUserId ?? null, h.actorRole ?? null, h.note ?? null],
  )
  return rows[0]
}

export async function listStatusHistory(client, appId, tenantId, disputeId) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.dispute_status_history
     WHERE app_id=$1 AND tenant_id=$2 AND dispute_id=$3 ORDER BY created_at ASC`,
    [appId, tenantId, disputeId],
  )
  return rows
}

export async function insertEvidence(client, appId, tenantId, disputeId, kind, data, uploadedBy) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.dispute_evidence (app_id, tenant_id, dispute_id, kind, data, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [appId, tenantId, disputeId, kind, data, uploadedBy ?? null],
  )
  return rows[0]
}

export async function listEvidence(client, appId, tenantId, disputeId) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.dispute_evidence
     WHERE app_id=$1 AND tenant_id=$2 AND dispute_id=$3 ORDER BY created_at ASC`,
    [appId, tenantId, disputeId],
  )
  return rows
}

// ── Stripe sync + refund tracking ───────────────────────────────────────

export async function setStripeDisputeId(client, appId, tenantId, id, stripeDisputeId) {
  const { rows } = await client.query(
    `UPDATE platform_disputes.disputes
        SET stripe_dispute_id = $4
      WHERE app_id=$1 AND tenant_id=$2 AND id=$3
      RETURNING *`,
    [appId, tenantId, id, stripeDisputeId],
  )
  return rows[0] ?? null
}

export async function markRefundRequested(client, appId, tenantId, id) {
  const { rows } = await client.query(
    `UPDATE platform_disputes.disputes
        SET refund_requested_at = COALESCE(refund_requested_at, now())
      WHERE app_id=$1 AND tenant_id=$2 AND id=$3
      RETURNING refund_requested_at, resolution_amount_cents, order_id, stripe_dispute_id`,
    [appId, tenantId, id],
  )
  return rows[0] ?? null
}

export async function markEvidenceSubmitted(client, appId, tenantId, id) {
  const { rows } = await client.query(
    `UPDATE platform_disputes.disputes
        SET evidence_submitted_at = now()
      WHERE app_id=$1 AND tenant_id=$2 AND id=$3
      RETURNING evidence_submitted_at`,
    [appId, tenantId, id],
  )
  return rows[0] ?? null
}
