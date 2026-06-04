// send_log — registro de cada intento de envío (email/sms/push).
// app_id/tenant_id son nullable: muchos envíos son de ámbito plataforma o
// salen de helpers que aún no reciben tenant context (ver TODO-resend).

export async function insert(client, entry) {
  const { rows } = await client.query(
    `INSERT INTO platform_notifications.send_log
       (app_id, tenant_id, user_id, channel, template, recipient, status, error)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
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
    ],
  )
  return rows[0]
}

export async function list(client, { channel, template, status, limit = 100, offset = 0 } = {}) {
  const where = []
  const params = []
  if (channel)  { params.push(channel);  where.push(`channel = $${params.length}`) }
  if (template) { params.push(template); where.push(`template = $${params.length}`) }
  if (status)   { params.push(status);   where.push(`status = $${params.length}`) }
  params.push(limit, offset)
  const { rows } = await client.query(
    `SELECT id, app_id, tenant_id, user_id, channel, template, recipient, status, error, sent_at
     FROM platform_notifications.send_log
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY sent_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  )
  return rows
}
