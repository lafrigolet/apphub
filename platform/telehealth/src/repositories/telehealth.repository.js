const SCHEMA = 'platform_telehealth'

export async function insertRoom(client, appId, tenantId, r) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.rooms
       (app_id, tenant_id, booking_id, provider, external_room_id, join_url,
        status, starts_at, ends_at, expires_at, recording_enabled, metadata)
     VALUES ($1,$2,$3,COALESCE($4,'stub'),$5,$6,COALESCE($7,'created'),$8,$9,$10,COALESCE($11,FALSE),COALESCE($12,'{}'::jsonb))
     RETURNING *`,
    [appId, tenantId, r.bookingId ?? null, r.provider ?? 'stub',
     r.externalRoomId ?? null, r.joinUrl ?? null, r.status ?? 'created',
     r.startsAt, r.endsAt, r.expiresAt, r.recordingEnabled ?? false, r.metadata ?? {}],
  )
  return rows[0]
}

export async function findRoomById(client, appId, tenantId, id) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.rooms WHERE app_id=$1 AND tenant_id=$2 AND id=$3`,
    [appId, tenantId, id],
  )
  return rows[0] ?? null
}

export async function findRoomByBookingId(client, appId, tenantId, bookingId) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.rooms
     WHERE app_id=$1 AND tenant_id=$2 AND booking_id=$3
     ORDER BY created_at DESC LIMIT 1`,
    [appId, tenantId, bookingId],
  )
  return rows[0] ?? null
}

export async function setRoomStatus(client, appId, tenantId, id, status) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.rooms SET status=$4, updated_at=now()
     WHERE app_id=$1 AND tenant_id=$2 AND id=$3 RETURNING *`,
    [appId, tenantId, id, status],
  )
  return rows[0] ?? null
}

export async function insertToken(client, appId, tenantId, t) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.tokens
       (app_id, tenant_id, room_id, user_id, participant_role, token, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [appId, tenantId, t.roomId, t.userId, t.participantRole, t.token, t.expiresAt],
  )
  return rows[0]
}

export async function listTokens(client, appId, tenantId, roomId) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.tokens WHERE app_id=$1 AND tenant_id=$2 AND room_id=$3 ORDER BY created_at`,
    [appId, tenantId, roomId],
  )
  return rows
}

export async function markTokenUsed(client, appId, tenantId, tokenId) {
  const { rowCount } = await client.query(
    `UPDATE ${SCHEMA}.tokens SET used_at = COALESCE(used_at, now())
     WHERE app_id=$1 AND tenant_id=$2 AND id=$3`,
    [appId, tenantId, tokenId],
  )
  return rowCount > 0
}
