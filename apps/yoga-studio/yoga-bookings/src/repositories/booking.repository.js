export async function createBooking(client, { id, userId, sessionId, tenantId, subTenantId }) {
  const { rows } = await client.query(
    `INSERT INTO yoga_bookings.bookings (id, user_id, session_id, status, tenant_id, sub_tenant_id)
     VALUES ($1, $2, $3, 'confirmed', $4, $5)
     RETURNING *`,
    [id, userId, sessionId, tenantId, subTenantId ?? null],
  )
  return rows[0]
}

export async function findById(client, id, tenantId) {
  const { rows } = await client.query(
    'SELECT * FROM yoga_bookings.bookings WHERE id = $1 AND tenant_id = $2',
    [id, tenantId],
  )
  return rows[0] ?? null
}

export async function listByUser(client, userId, tenantId) {
  const { rows } = await client.query(
    `SELECT * FROM yoga_bookings.bookings WHERE user_id = $1 AND tenant_id = $2 ORDER BY booked_at DESC`,
    [userId, tenantId],
  )
  return rows
}

export async function cancelBooking(client, id, tenantId, reason) {
  const { rows } = await client.query(
    `UPDATE yoga_bookings.bookings
     SET status = 'cancelled', cancelled_at = now(), cancellation_reason = $3
     WHERE id = $1 AND tenant_id = $2 AND status = 'confirmed'
     RETURNING *`,
    [id, tenantId, reason ?? null],
  )
  return rows[0] ?? null
}

export async function markAttended(client, id, tenantId) {
  const { rows } = await client.query(
    `UPDATE yoga_bookings.bookings SET status = 'attended' WHERE id = $1 AND tenant_id = $2 AND status = 'confirmed' RETURNING *`,
    [id, tenantId],
  )
  return rows[0] ?? null
}

export async function markNoShow(client, id) {
  await client.query(
    `UPDATE yoga_bookings.bookings SET status = 'no_show' WHERE id = $1 AND status = 'confirmed'`,
    [id],
  )
}

export async function findFinishedUnreported(client) {
  const { rows } = await client.query(
    `SELECT b.id, b.user_id, b.session_id, b.tenant_id, b.sub_tenant_id
     FROM yoga_bookings.bookings b
     WHERE b.status = 'confirmed'
       AND b.session_id IN (
         SELECT s.id FROM yoga_classes.sessions s
         JOIN yoga_classes.classes c ON c.id = s.class_id
         WHERE (s.date + c.start_time + (c.duration_min || ' minutes')::interval) < now()
       )`,
  )
  return rows
}

// Waitlist
export async function addToWaitlist(client, { id, userId, sessionId, position, tenantId, subTenantId }) {
  const { rows } = await client.query(
    `INSERT INTO yoga_bookings.waiting_list (id, user_id, session_id, position, tenant_id, sub_tenant_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, session_id) DO NOTHING
     RETURNING *`,
    [id, userId, sessionId, position, tenantId, subTenantId ?? null],
  )
  return rows[0] ?? null
}

export async function getWaitlistPosition(client, userId, sessionId, tenantId) {
  const { rows } = await client.query(
    `SELECT * FROM yoga_bookings.waiting_list WHERE user_id = $1 AND session_id = $2 AND tenant_id = $3`,
    [userId, sessionId, tenantId],
  )
  return rows[0] ?? null
}

export async function nextInWaitlist(client, sessionId, tenantId) {
  const { rows } = await client.query(
    `SELECT * FROM yoga_bookings.waiting_list
     WHERE session_id = $1 AND tenant_id = $2 AND notified_at IS NULL
     ORDER BY position LIMIT 1`,
    [sessionId, tenantId],
  )
  return rows[0] ?? null
}

export async function notifyWaitlist(client, id) {
  await client.query(
    `UPDATE yoga_bookings.waiting_list
     SET notified_at = now(), expires_at = now() + INTERVAL '30 minutes'
     WHERE id = $1`,
    [id],
  )
}
