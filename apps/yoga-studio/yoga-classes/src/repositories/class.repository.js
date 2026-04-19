export async function listClasses(client, tenantId, { type, level } = {}) {
  const conditions = ['c.is_active = true', 'c.tenant_id = $1']
  const values = [tenantId]
  let i = 2

  if (type) { conditions.push(`c.type = $${i++}`); values.push(type) }
  if (level) { conditions.push(`c.level = $${i++}`); values.push(level) }

  const { rows } = await client.query(
    `SELECT c.*,
      json_agg(DISTINCT jsonb_build_object('id', s.id, 'date', s.date, 'spots_taken', s.spots_taken, 'is_cancelled', s.is_cancelled)
        ORDER BY s.date) FILTER (WHERE s.id IS NOT NULL AND s.date >= CURRENT_DATE) AS upcoming_sessions
     FROM yoga_classes.classes c
     LEFT JOIN yoga_classes.sessions s ON s.class_id = c.id AND s.date >= CURRENT_DATE AND s.is_cancelled = false
     WHERE ${conditions.join(' AND ')}
     GROUP BY c.id
     ORDER BY c.name`,
    values,
  )
  return rows
}

export async function findById(client, id, tenantId) {
  const { rows } = await client.query(
    'SELECT * FROM yoga_classes.classes WHERE id = $1 AND tenant_id = $2',
    [id, tenantId],
  )
  return rows[0] ?? null
}

export async function createClass(client, data) {
  const { rows } = await client.query(
    `INSERT INTO yoga_classes.classes
       (id, name, type, instructor_id, room, start_time, duration_min, max_capacity, level, recurrence, equipment, is_active, tenant_id, sub_tenant_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true, $12, $13)
     RETURNING *`,
    [data.id, data.name, data.type, data.instructorId, data.room, data.startTime,
     data.durationMin, data.maxCapacity, data.level, data.recurrence ?? 'none',
     data.equipment ?? [], data.tenantId, data.subTenantId ?? null],
  )
  return rows[0]
}

export async function updateClass(client, id, tenantId, fields) {
  const sets = []
  const values = []
  let i = 1

  const map = {
    name: 'name', type: 'type', instructorId: 'instructor_id', room: 'room',
    startTime: 'start_time', durationMin: 'duration_min', maxCapacity: 'max_capacity',
    level: 'level', equipment: 'equipment',
  }

  for (const [key, col] of Object.entries(map)) {
    if (fields[key] !== undefined) { sets.push(`${col} = $${i++}`); values.push(fields[key]) }
  }

  if (sets.length === 0) return findById(client, id, tenantId)

  sets.push('updated_at = now()')
  values.push(id)
  values.push(tenantId)

  const { rows } = await client.query(
    `UPDATE yoga_classes.classes SET ${sets.join(', ')} WHERE id = $${i} AND tenant_id = $${i + 1} RETURNING *`,
    values,
  )
  return rows[0] ?? null
}

export async function deactivateClass(client, id, tenantId) {
  await client.query(
    `UPDATE yoga_classes.classes SET is_active = false, updated_at = now() WHERE id = $1 AND tenant_id = $2`,
    [id, tenantId],
  )
}

export async function findSession(client, sessionId, tenantId) {
  const { rows } = await client.query(
    'SELECT s.*, c.max_capacity FROM yoga_classes.sessions s JOIN yoga_classes.classes c ON c.id = s.class_id WHERE s.id = $1 AND s.tenant_id = $2',
    [sessionId, tenantId],
  )
  return rows[0] ?? null
}

export async function incrementSpots(client, sessionId, tenantId, delta = 1) {
  const { rows } = await client.query(
    `UPDATE yoga_classes.sessions SET spots_taken = spots_taken + $2
     WHERE id = $1 AND tenant_id = $3
     RETURNING spots_taken, (SELECT max_capacity FROM yoga_classes.classes WHERE id = class_id) AS max_capacity`,
    [sessionId, delta, tenantId],
  )
  return rows[0] ?? null
}

export async function getInstructorSessions(client, instructorId, tenantId) {
  const { rows } = await client.query(
    `SELECT s.id, s.date, s.spots_taken, s.is_cancelled, c.name, c.room, c.max_capacity, c.equipment
     FROM yoga_classes.sessions s
     JOIN yoga_classes.classes c ON c.id = s.class_id
     WHERE c.instructor_id = $1 AND c.tenant_id = $2 AND s.date >= CURRENT_DATE
     ORDER BY s.date, c.start_time`,
    [instructorId, tenantId],
  )
  return rows
}
