// inbound_emails + inbound_attachments — persistence for the inbound pipeline.
// No RLS (see migration 0026): ingestion is provider-signed, not JWT-bearing;
// admin access is staff-only.

// Webhook ingestion: idempotent on provider_email_id (Resend redelivers).
// Returns the row plus `inserted` so the caller can drop duplicates.
export async function upsertReceived(client, e) {
  const { rows } = await client.query(
    `INSERT INTO platform_notifications.inbound_emails
       (provider, provider_email_id, from_address, from_name, to_addresses, cc_addresses, subject, received_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, now()))
     ON CONFLICT (provider_email_id) DO UPDATE SET updated_at = now()
     RETURNING *, (xmax = 0) AS inserted`,
    [
      e.provider ?? 'resend', e.providerEmailId, e.fromAddress, e.fromName ?? null,
      e.toAddresses ?? [], e.ccAddresses ?? [], e.subject ?? null, e.receivedAt ?? null,
    ],
  )
  return rows[0]
}

export async function markFetched(client, id, c) {
  const { rows } = await client.query(
    `UPDATE platform_notifications.inbound_emails
     SET status = 'fetched', body_text = $2, body_html = $3, headers = $4,
         message_id = $5, in_reply_to = $6, reply_to = $7, auth_results = $8,
         is_auto_reply = $9, fetched_at = now(), updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [
      id, c.bodyText ?? null, c.bodyHtml ?? null, JSON.stringify(c.headers ?? {}),
      c.messageId ?? null, c.inReplyTo ?? null, c.replyTo ?? null, c.authResults ?? null,
      c.isAutoReply ?? false,
    ],
  )
  return rows[0] ?? null
}

// Terminal states. routed carries the matched rule / minted event; unrouted &
// archived are the no-match outcomes; quarantined records why the message was
// withheld from routing; failed increments the dead-letter counter.
export async function markRouted(client, id, { routeId, routedEvent, appId, tenantId }) {
  await client.query(
    `UPDATE platform_notifications.inbound_emails
     SET status = 'routed', route_id = $2, routed_event = $3,
         app_id = COALESCE($4, app_id), tenant_id = COALESCE($5, tenant_id),
         processed_at = now(), error = NULL, updated_at = now()
     WHERE id = $1`,
    [id, routeId ?? null, routedEvent ?? null, appId ?? null, tenantId ?? null],
  )
}

export async function markArchived(client, id, status = 'unrouted') {
  await client.query(
    `UPDATE platform_notifications.inbound_emails
     SET status = $2, processed_at = now(), updated_at = now()
     WHERE id = $1`,
    [id, status === 'archived' ? 'archived' : 'unrouted'],
  )
}

export async function markQuarantined(client, id, reason) {
  await client.query(
    `UPDATE platform_notifications.inbound_emails
     SET status = 'quarantined', quarantine_reason = $2, processed_at = now(), updated_at = now()
     WHERE id = $1`,
    [id, String(reason).slice(0, 500)],
  )
}

export async function markFailed(client, id, error) {
  await client.query(
    `UPDATE platform_notifications.inbound_emails
     SET status = 'failed', attempts = attempts + 1, error = $2, updated_at = now()
     WHERE id = $1`,
    [id, String(error).slice(0, 2000)],
  )
}

// Reset for staff reprocess: back to 'received' so the pipeline re-runs fully.
export async function resetForReprocess(client, id) {
  const { rows } = await client.query(
    `UPDATE platform_notifications.inbound_emails
     SET status = 'received', error = NULL, quarantine_reason = NULL, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id],
  )
  return rows[0] ?? null
}

export async function findById(client, id) {
  const { rows } = await client.query(
    `SELECT * FROM platform_notifications.inbound_emails WHERE id = $1`, [id],
  )
  return rows[0] ?? null
}

export async function list(client, { status, fromAddress, toAddress, limit = 50, offset = 0 } = {}) {
  const where = []
  const params = []
  if (status)      { params.push(status);                  where.push(`status = $${params.length}`) }
  if (fromAddress) { params.push(fromAddress.toLowerCase()); where.push(`lower(from_address) = $${params.length}`) }
  if (toAddress)   { params.push(toAddress.toLowerCase());   where.push(`$${params.length} = ANY (SELECT lower(unnest(to_addresses)))`) }
  params.push(Math.min(Number(limit) || 50, 200), Number(offset) || 0)
  const { rows } = await client.query(
    `SELECT * FROM platform_notifications.inbound_emails
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY received_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  )
  return rows
}

// GDPR erasure: all mail from one sender. Returns the attachment object keys so
// the caller can delete the S3 objects too (rows cascade).
export async function deleteBySender(client, fromAddress) {
  const { rows } = await client.query(
    `SELECT a.bucket, a.object_key
     FROM platform_notifications.inbound_attachments a
     JOIN platform_notifications.inbound_emails e ON e.id = a.email_id
     WHERE lower(e.from_address) = $1 AND a.object_key IS NOT NULL`,
    [fromAddress.toLowerCase()],
  )
  const { rowCount } = await client.query(
    `DELETE FROM platform_notifications.inbound_emails WHERE lower(from_address) = $1`,
    [fromAddress.toLowerCase()],
  )
  return { deleted: rowCount, objectKeys: rows }
}

// Retention purge (scheduler job): same shape — keys out, rows cascaded.
export async function purgeOlderThan(client, days) {
  const { rows } = await client.query(
    `SELECT a.bucket, a.object_key
     FROM platform_notifications.inbound_attachments a
     JOIN platform_notifications.inbound_emails e ON e.id = a.email_id
     WHERE e.received_at < now() - ($1 || ' days')::interval AND a.object_key IS NOT NULL`,
    [days],
  )
  const { rowCount } = await client.query(
    `DELETE FROM platform_notifications.inbound_emails
     WHERE received_at < now() - ($1 || ' days')::interval`,
    [days],
  )
  return { deleted: rowCount, objectKeys: rows }
}

// ── attachments ────────────────────────────────────────────────────────────

export async function insertAttachment(client, a) {
  const { rows } = await client.query(
    `INSERT INTO platform_notifications.inbound_attachments
       (email_id, provider_attachment_id, filename, content_type, content_id,
        size_bytes, sha256, bucket, object_key, status, skip_reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      a.emailId, a.providerAttachmentId ?? null, a.filename ?? null, a.contentType ?? null,
      a.contentId ?? null, a.sizeBytes ?? null, a.sha256 ?? null, a.bucket ?? null,
      a.objectKey ?? null, a.status ?? 'stored', a.skipReason ?? null,
    ],
  )
  return rows[0]
}

export async function listAttachments(client, emailId) {
  const { rows } = await client.query(
    `SELECT * FROM platform_notifications.inbound_attachments
     WHERE email_id = $1 ORDER BY created_at`,
    [emailId],
  )
  return rows
}

export async function deleteAttachmentsByEmail(client, emailId) {
  await client.query(
    `DELETE FROM platform_notifications.inbound_attachments WHERE email_id = $1`,
    [emailId],
  )
}

// Dedup: an identical payload (same sha256) already stored anywhere reuses its
// object_key instead of writing the bytes again (signatures/logos repeat in
// long threads).
export async function findStoredBySha(client, sha256) {
  const { rows } = await client.query(
    `SELECT bucket, object_key FROM platform_notifications.inbound_attachments
     WHERE sha256 = $1 AND status = 'stored' AND object_key IS NOT NULL
     LIMIT 1`,
    [sha256],
  )
  return rows[0] ?? null
}
