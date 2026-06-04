// suppressions — recipients (email / phone) that must not be contacted again.
//
// Populated by provider webhooks (Resend bounce/complaint, Twilio opt-out) and
// by staff (manual). Not RLS-scoped: a suppressed address is a deliverability
// fact about the address, and the webhooks that write it carry no tenant
// context. Lookups are by (channel, recipient); recipients are normalised
// (lower-cased email / trimmed phone) by the caller before reaching here.

const T = 'platform_notifications.suppressions'

// Idempotent upsert — a repeated bounce for the same address is a no-op on the
// row (keeps the first reason/created_at, refreshes detail).
export async function upsert(client, { channel, recipient, reason, detail }) {
  const { rows } = await client.query(
    `INSERT INTO ${T} (channel, recipient, reason, detail)
       VALUES ($1, $2, $3, $4)
     ON CONFLICT (channel, recipient)
       DO UPDATE SET detail = EXCLUDED.detail
     RETURNING id, channel, recipient, reason, detail, created_at`,
    [channel, recipient, reason, detail ? String(detail).slice(0, 2000) : null],
  )
  return rows[0]
}

// True when the recipient is suppressed on this channel.
export async function isSuppressed(client, { channel, recipient }) {
  const { rows } = await client.query(
    `SELECT 1 FROM ${T} WHERE channel = $1 AND recipient = $2 LIMIT 1`,
    [channel, recipient],
  )
  return rows.length > 0
}

export async function list(client, { channel, limit = 100, offset = 0 } = {}) {
  const params = []
  let where = ''
  if (channel) { params.push(channel); where = `WHERE channel = $${params.length}` }
  params.push(limit, offset)
  const { rows } = await client.query(
    `SELECT id, channel, recipient, reason, detail, created_at
       FROM ${T}
       ${where}
      ORDER BY created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  )
  return rows
}

// Staff un-suppress (e.g. a recipient confirmed the address is fine again).
export async function remove(client, { channel, recipient }) {
  const { rowCount } = await client.query(
    `DELETE FROM ${T} WHERE channel = $1 AND recipient = $2`,
    [channel, recipient],
  )
  return rowCount > 0
}
