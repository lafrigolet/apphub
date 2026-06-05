// send_log — registro de cada intento de envío (email/sms/push).
// app_id/tenant_id son nullable: muchos envíos son de ámbito plataforma o
// salen de helpers que aún no reciben tenant context (ver TODO-resend).

export async function insert(client, entry) {
  const { rows } = await client.query(
    `INSERT INTO platform_notifications.send_log
       (app_id, tenant_id, user_id, channel, template, recipient, status, error, provider_message_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, sent_at`,
    [
      entry.appId ?? null,
      entry.tenantId ?? null,
      entry.userId ?? null,
      entry.channel,
      entry.template,
      entry.recipient,
      entry.status,
      entry.error ?? null,
      entry.providerMessageId ?? null,
    ],
  )
  return rows[0]
}

// Correlate an async provider webhook (Resend / Twilio) back to the original
// attempt and stamp its delivery outcome. Matches on the provider's message id.
// Returns the number of rows touched (0 when we have no record of that id —
// e.g. the attempt predates this column, or was sent by another instance).
export async function updateDeliveryStatus(client, { providerMessageId, deliveryStatus, error }) {
  const { rowCount } = await client.query(
    `UPDATE platform_notifications.send_log
        SET delivery_status = $2,
            error = COALESCE($3, error)
      WHERE provider_message_id = $1`,
    [providerMessageId, deliveryStatus, error ? String(error).slice(0, 2000) : null],
  )
  return rowCount
}

// Retention purge (recommendation #16). Deletes attempts older than the cutoff
// and returns how many rows were removed. Driven by an admin endpoint and,
// once wired, a scheduler job.
export async function purgeOlderThan(client, { olderThanDays }) {
  const { rowCount } = await client.query(
    `DELETE FROM platform_notifications.send_log
      WHERE sent_at < now() - ($1 || ' days')::interval`,
    [String(olderThanDays)],
  )
  return rowCount
}

// Inbound correlation (§27): an incoming reply's In-Reply-To / References may
// embed the provider message id of one of our sends. Candidates are the
// cleaned message-id tokens; first hit wins.
export async function findByProviderMessageIds(client, ids) {
  if (!ids?.length) return null
  const { rows } = await client.query(
    `SELECT id, app_id, tenant_id, user_id, channel, template, recipient, provider_message_id, sent_at
     FROM platform_notifications.send_log
     WHERE provider_message_id = ANY ($1::text[])
     ORDER BY sent_at DESC
     LIMIT 1`,
    [ids],
  )
  return rows[0] ?? null
}

export async function list(client, { channel, template, status, limit = 100, offset = 0 } = {}) {
  const where = []
  const params = []
  if (channel)  { params.push(channel);  where.push(`channel = $${params.length}`) }
  if (template) { params.push(template); where.push(`template = $${params.length}`) }
  if (status)   { params.push(status);   where.push(`status = $${params.length}`) }
  params.push(limit, offset)
  const { rows } = await client.query(
    `SELECT id, app_id, tenant_id, user_id, channel, template, recipient, status, error,
            provider_message_id, delivery_status, sent_at
     FROM platform_notifications.send_log
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY sent_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  )
  return rows
}
