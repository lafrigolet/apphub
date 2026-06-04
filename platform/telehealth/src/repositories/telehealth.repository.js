const SCHEMA = 'platform_telehealth'

export async function insertRoom(client, appId, tenantId, r) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.rooms
       (app_id, tenant_id, booking_id, provider, external_room_id, join_url,
        status, starts_at, ends_at, expires_at, recording_enabled, metadata, data_region)
     VALUES ($1,$2,$3,COALESCE($4,'stub'),$5,$6,COALESCE($7,'created'),$8,$9,$10,COALESCE($11,FALSE),COALESCE($12,'{}'::jsonb),COALESCE($13,'eu-west'))
     RETURNING *`,
    [appId, tenantId, r.bookingId ?? null, r.provider ?? 'stub',
     r.externalRoomId ?? null, r.joinUrl ?? null, r.status ?? 'created',
     r.startsAt, r.endsAt, r.expiresAt, r.recordingEnabled ?? false, r.metadata ?? {}, r.dataRegion ?? null],
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

// Reschedule: shift the schedule window (and re-derive expires_at upstream).
export async function updateRoomSchedule(client, appId, tenantId, id, { startsAt, endsAt, expiresAt }) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.rooms
        SET starts_at=$4, ends_at=$5, expires_at=$6, updated_at=now()
      WHERE app_id=$1 AND tenant_id=$2 AND id=$3
        AND status NOT IN ('ended','cancelled','expired')
      RETURNING *`,
    [appId, tenantId, id, startsAt, endsAt, expiresAt],
  )
  return rows[0] ?? null
}

// Atomically flip all non-terminal rooms whose access window already closed to 'expired'.
// Returns the affected rows so the caller can publish per-room events.
export async function expireStaleRooms(client, appId, tenantId, limit = 500) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.rooms SET status='expired', updated_at=now()
      WHERE app_id=$1 AND tenant_id=$2
        AND status IN ('created','active')
        AND expires_at < now()
        AND id IN (
          SELECT id FROM ${SCHEMA}.rooms
           WHERE app_id=$1 AND tenant_id=$2
             AND status IN ('created','active')
             AND expires_at < now()
           ORDER BY expires_at
           LIMIT $3
        )
      RETURNING *`,
    [appId, tenantId, limit],
  )
  return rows
}

// Recording-consent capture (GDPR Art. 9 — health data).
export async function setRecordingConsent(client, appId, tenantId, id, { status, by, text }) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.rooms
        SET recording_consent_status=$4,
            recording_consent_by=$5,
            recording_consent_at=now(),
            recording_consent_text=COALESCE($6, recording_consent_text),
            updated_at=now()
      WHERE app_id=$1 AND tenant_id=$2 AND id=$3
      RETURNING *`,
    [appId, tenantId, id, status, by ?? null, text ?? null],
  )
  return rows[0] ?? null
}

// Append-only FSM transition history.
export async function insertRoomEvent(client, appId, tenantId, e) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.room_events
       (app_id, tenant_id, room_id, from_status, to_status, reason, actor, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,'{}'::jsonb))
     RETURNING *`,
    [appId, tenantId, e.roomId, e.fromStatus ?? null, e.toStatus,
     e.reason ?? null, e.actor ?? null, e.metadata ?? {}],
  )
  return rows[0]
}

export async function listRoomEvents(client, appId, tenantId, roomId) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.room_events
      WHERE app_id=$1 AND tenant_id=$2 AND room_id=$3 ORDER BY created_at`,
    [appId, tenantId, roomId],
  )
  return rows
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

// ---- Post-session clinical notes -----------------------------------------

export async function insertNote(client, appId, tenantId, n) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.session_notes
       (app_id, tenant_id, room_id, booking_id, author_id,
        subjective, objective, assessment, plan, body, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11,'{}'::jsonb))
     RETURNING *`,
    [appId, tenantId, n.roomId, n.bookingId ?? null, n.authorId,
     n.subjective ?? null, n.objective ?? null, n.assessment ?? null,
     n.plan ?? null, n.body ?? null, n.metadata ?? {}],
  )
  return rows[0]
}

export async function findNoteById(client, appId, tenantId, id) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.session_notes WHERE app_id=$1 AND tenant_id=$2 AND id=$3`,
    [appId, tenantId, id],
  )
  return rows[0] ?? null
}

export async function listNotesByRoom(client, appId, tenantId, roomId) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.session_notes
      WHERE app_id=$1 AND tenant_id=$2 AND room_id=$3 ORDER BY created_at`,
    [appId, tenantId, roomId],
  )
  return rows
}

// Only mutable while unsigned; signed notes are immutable (digital sign-off).
export async function updateNote(client, appId, tenantId, id, fields) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.session_notes
        SET subjective=COALESCE($4, subjective),
            objective =COALESCE($5, objective),
            assessment=COALESCE($6, assessment),
            plan      =COALESCE($7, plan),
            body      =COALESCE($8, body),
            updated_at=now()
      WHERE app_id=$1 AND tenant_id=$2 AND id=$3 AND signed_at IS NULL
      RETURNING *`,
    [appId, tenantId, id,
     fields.subjective ?? null, fields.objective ?? null, fields.assessment ?? null,
     fields.plan ?? null, fields.body ?? null],
  )
  return rows[0] ?? null
}

export async function signNote(client, appId, tenantId, id) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.session_notes
        SET signed_at=now(), updated_at=now()
      WHERE app_id=$1 AND tenant_id=$2 AND id=$3 AND signed_at IS NULL
      RETURNING *`,
    [appId, tenantId, id],
  )
  return rows[0] ?? null
}
