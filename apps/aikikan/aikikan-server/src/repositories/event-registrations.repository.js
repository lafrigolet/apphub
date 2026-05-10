// Repository de app_aikikan.event_registrations. Las queries se ejecutan
// dentro de withTenantTransaction; RLS por (app_id, tenant_id) las
// scopea automáticamente.

const TABLE = 'app_aikikan.event_registrations'
const COLS  = `id, app_id, tenant_id, sub_tenant_id, event_id, user_id,
               status, registered_at, attended_at, cancelled_at, notes,
               created_at, updated_at`

// Lista las inscripciones del socio actual ordenadas por fecha del
// evento (futuras primero, luego pasadas). Devuelve también campos del
// evento para que el frontend pinte la card sin un segundo round-trip.
export async function findByUser(client, userId) {
  const { rows } = await client.query(
    `SELECT r.id, r.event_id, r.user_id, r.status,
            r.registered_at, r.attended_at, r.cancelled_at, r.notes,
            e.date AS event_date, e.name AS event_name, e.location AS event_location
     FROM ${TABLE} r
     JOIN app_aikikan.events e ON e.id = r.event_id
     WHERE r.user_id = $1
     ORDER BY (e.date >= CURRENT_DATE) DESC, e.date ASC`,
    [userId],
  )
  return rows
}

// Lista todas las inscripciones de un evento. Lo consume el admin para
// ver la lista de inscritos. Sin JOIN al usuario — sólo el id; el
// admin puede cruzar luego con auth si lo necesita.
export async function findByEvent(client, eventId) {
  const { rows } = await client.query(
    `SELECT ${COLS} FROM ${TABLE}
     WHERE event_id = $1
     ORDER BY registered_at ASC`,
    [eventId],
  )
  return rows
}

export async function findOne(client, eventId, userId) {
  const { rows } = await client.query(
    `SELECT ${COLS} FROM ${TABLE}
     WHERE event_id = $1 AND user_id = $2 LIMIT 1`,
    [eventId, userId],
  )
  return rows[0] ?? null
}

// Inscripción idempotente. Si el socio ya tenía una fila cancelled, la
// reactivamos con status='registered'. Si no había fila se inserta nueva.
// El UNIQUE (app_id, tenant_id, event_id, user_id) garantiza que no
// haya duplicados aunque dos clicks lleguen en paralelo.
export async function register(client, { appId, tenantId, subTenantId, eventId, userId }) {
  const { rows } = await client.query(
    `INSERT INTO ${TABLE}
       (app_id, tenant_id, sub_tenant_id, event_id, user_id, status, registered_at, cancelled_at)
     VALUES ($1, $2, $3, $4, $5, 'registered', now(), NULL)
     ON CONFLICT (app_id, tenant_id, event_id, user_id) DO UPDATE
       SET status        = 'registered',
           registered_at = now(),
           cancelled_at  = NULL,
           updated_at    = now()
     RETURNING ${COLS}`,
    [appId, tenantId, subTenantId ?? null, eventId, userId],
  )
  return rows[0]
}

// Cancela la inscripción (soft — la fila se queda con status='cancelled').
// Devuelve la fila actualizada, o null si no había inscripción.
export async function cancel(client, eventId, userId) {
  const { rows } = await client.query(
    `UPDATE ${TABLE}
     SET status = 'cancelled', cancelled_at = now(), updated_at = now()
     WHERE event_id = $1 AND user_id = $2 AND status <> 'cancelled'
     RETURNING ${COLS}`,
    [eventId, userId],
  )
  return rows[0] ?? null
}

// Marca asistencia (sólo admin). Idempotente.
export async function markAttended(client, registrationId) {
  const { rows } = await client.query(
    `UPDATE ${TABLE}
     SET status = 'attended', attended_at = now(), updated_at = now()
     WHERE id = $1
     RETURNING ${COLS}`,
    [registrationId],
  )
  return rows[0] ?? null
}
