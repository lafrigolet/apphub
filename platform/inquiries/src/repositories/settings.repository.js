const SCHEMA = 'platform_inquiries'

export async function findByAppTenant(client, appId, tenantId) {
  const { rows } = await client.query(
    `SELECT app_id, tenant_id, contact_inbox_email, reply_to_email,
            user_thanks_subject, user_thanks_body, created_at, updated_at
       FROM ${SCHEMA}.settings
      WHERE app_id = $1 AND tenant_id = $2`,
    [appId, tenantId],
  )
  return rows[0] ?? null
}

export async function upsert(client, { appId, tenantId, contactInboxEmail, replyToEmail, userThanksSubject, userThanksBody }) {
  // INSERT … ON CONFLICT mantiene el contrato de PUT idempotente: el caller
  // pasa el estado deseado y la fila queda igual independientemente de si
  // existía antes o no.
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.settings
       (app_id, tenant_id, contact_inbox_email, reply_to_email, user_thanks_subject, user_thanks_body)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (app_id, tenant_id) DO UPDATE SET
       contact_inbox_email = EXCLUDED.contact_inbox_email,
       reply_to_email      = EXCLUDED.reply_to_email,
       user_thanks_subject = EXCLUDED.user_thanks_subject,
       user_thanks_body    = EXCLUDED.user_thanks_body,
       updated_at          = now()
     RETURNING *`,
    [
      appId, tenantId, contactInboxEmail,
      replyToEmail ?? null, userThanksSubject ?? null, userThanksBody ?? null,
    ],
  )
  return rows[0]
}
