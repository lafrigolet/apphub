const SCHEMA = 'platform_floor_plan'

export async function insertSection(client, s) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.sections (app_id, tenant_id, name, description, is_outdoor, display_order)
     VALUES ($1,$2,$3,$4,COALESCE($5,FALSE),COALESCE($6,0)) RETURNING *`,
    [s.appId, s.tenantId, s.name, s.description ?? null, s.isOutdoor ?? false, s.displayOrder ?? 0],
  )
  return rows[0]
}

export async function listSections(client, appId, tenantId) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.sections WHERE app_id=$1 AND tenant_id=$2 ORDER BY display_order, name`,
    [appId, tenantId],
  )
  return rows
}

export async function insertTable(client, t) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.tables (app_id, tenant_id, section_id, code, capacity, shape, pos_x, pos_y)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6,'square'),$7,$8) RETURNING *`,
    [t.appId, t.tenantId, t.sectionId, t.code, t.capacity, t.shape ?? 'square', t.posX ?? null, t.posY ?? null],
  )
  return rows[0]
}

export async function listTables(client, appId, tenantId, { sectionId, status } = {}) {
  const filters = ['app_id = $1', 'tenant_id = $2']
  const params  = [appId, tenantId]
  let i = 3
  if (sectionId) { filters.push(`section_id = $${i++}`); params.push(sectionId) }
  if (status)    { filters.push(`status = $${i++}`);     params.push(status) }
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.tables WHERE ${filters.join(' AND ')} ORDER BY code`,
    params,
  )
  return rows
}

export async function findTableById(client, appId, tenantId, id) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.tables WHERE app_id=$1 AND tenant_id=$2 AND id=$3`,
    [appId, tenantId, id],
  )
  return rows[0] ?? null
}

export async function setTableStatus(client, appId, tenantId, id, status) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.tables SET status=$4, updated_at=now()
     WHERE app_id=$1 AND tenant_id=$2 AND id=$3 RETURNING *`,
    [appId, tenantId, id, status],
  )
  return rows[0] ?? null
}

export async function combineTables(client, appId, tenantId, primaryId, otherIds) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.tables SET combined_with=$4, updated_at=now()
     WHERE app_id=$1 AND tenant_id=$2 AND id=$3 RETURNING *`,
    [appId, tenantId, primaryId, otherIds],
  )
  return rows[0] ?? null
}

export async function updateSection(client, appId, tenantId, id, patch) {
  const sets = []
  const params = [appId, tenantId, id]
  let i = 4
  if (patch.name !== undefined)         { sets.push(`name=$${i++}`);          params.push(patch.name) }
  if (patch.description !== undefined)  { sets.push(`description=$${i++}`);   params.push(patch.description) }
  if (patch.isOutdoor !== undefined)    { sets.push(`is_outdoor=$${i++}`);    params.push(patch.isOutdoor) }
  if (patch.displayOrder !== undefined) { sets.push(`display_order=$${i++}`); params.push(patch.displayOrder) }
  if (sets.length === 0) {
    const { rows } = await client.query(
      `SELECT * FROM ${SCHEMA}.sections WHERE app_id=$1 AND tenant_id=$2 AND id=$3`, params,
    )
    return rows[0] ?? null
  }
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.sections SET ${sets.join(', ')}
     WHERE app_id=$1 AND tenant_id=$2 AND id=$3 RETURNING *`,
    params,
  )
  return rows[0] ?? null
}

export async function countTablesInSection(client, appId, tenantId, sectionId) {
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS n FROM ${SCHEMA}.tables
     WHERE app_id=$1 AND tenant_id=$2 AND section_id=$3`,
    [appId, tenantId, sectionId],
  )
  return rows[0].n
}

export async function deleteSection(client, appId, tenantId, id) {
  const { rows } = await client.query(
    `DELETE FROM ${SCHEMA}.sections WHERE app_id=$1 AND tenant_id=$2 AND id=$3 RETURNING id`,
    [appId, tenantId, id],
  )
  return rows[0] ?? null
}

export async function updateTable(client, appId, tenantId, id, patch) {
  const sets = []
  const params = [appId, tenantId, id]
  let i = 4
  if (patch.sectionId !== undefined) { sets.push(`section_id=$${i++}`); params.push(patch.sectionId) }
  if (patch.code !== undefined)      { sets.push(`code=$${i++}`);       params.push(patch.code) }
  if (patch.capacity !== undefined)  { sets.push(`capacity=$${i++}`);   params.push(patch.capacity) }
  if (patch.shape !== undefined)     { sets.push(`shape=$${i++}`);      params.push(patch.shape) }
  if (patch.posX !== undefined)      { sets.push(`pos_x=$${i++}`);      params.push(patch.posX) }
  if (patch.posY !== undefined)      { sets.push(`pos_y=$${i++}`);      params.push(patch.posY) }
  if (sets.length === 0) {
    return findTableById(client, appId, tenantId, id)
  }
  sets.push('updated_at=now()')
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.tables SET ${sets.join(', ')}
     WHERE app_id=$1 AND tenant_id=$2 AND id=$3 RETURNING *`,
    params,
  )
  return rows[0] ?? null
}

export async function deleteTable(client, appId, tenantId, id) {
  const { rows } = await client.query(
    `DELETE FROM ${SCHEMA}.tables WHERE app_id=$1 AND tenant_id=$2 AND id=$3 RETURNING id`,
    [appId, tenantId, id],
  )
  return rows[0] ?? null
}

// Fetch several tables by id within the tenant scope (for combine validation).
export async function findTablesByIds(client, appId, tenantId, ids) {
  if (!ids?.length) return []
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.tables WHERE app_id=$1 AND tenant_id=$2 AND id = ANY($3::uuid[])`,
    [appId, tenantId, ids],
  )
  return rows
}

// Find a single table by its tenant-unique code (events carry codes, not ids).
export async function findTableByCode(client, appId, tenantId, code) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.tables WHERE app_id=$1 AND tenant_id=$2 AND code=$3`,
    [appId, tenantId, code],
  )
  return rows[0] ?? null
}

// Reset combined_with on a primary table (table.split).
export async function clearCombined(client, appId, tenantId, id) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.tables SET combined_with='{}', updated_at=now()
     WHERE app_id=$1 AND tenant_id=$2 AND id=$3 RETURNING *`,
    [appId, tenantId, id],
  )
  return rows[0] ?? null
}

export async function listTableEvents(client, appId, tenantId, tableId, { from, to, toStatus, limit, offset } = {}) {
  const filters = ['app_id = $1', 'tenant_id = $2', 'table_id = $3']
  const params  = [appId, tenantId, tableId]
  let i = 4
  if (from)     { filters.push(`ts >= $${i++}`);        params.push(from) }
  if (to)       { filters.push(`ts <= $${i++}`);        params.push(to) }
  if (toStatus) { filters.push(`to_status = $${i++}`);  params.push(toStatus) }
  const lim = limit ?? 100
  const off = offset ?? 0
  params.push(lim, off)
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.table_events WHERE ${filters.join(' AND ')}
     ORDER BY ts DESC LIMIT $${i++} OFFSET $${i++}`,
    params,
  )
  return rows
}

// Live occupancy: number of seated parties + summed party_size across occupied
// tables, plus declared capacity. Party size is read from the most-recent
// event that drove the table into its current occupied state.
export async function occupancySnapshot(client, appId, tenantId, { sectionId } = {}) {
  const filters = ['t.app_id = $1', 't.tenant_id = $2']
  const params  = [appId, tenantId]
  let i = 3
  if (sectionId) { filters.push(`t.section_id = $${i++}`); params.push(sectionId) }
  const { rows } = await client.query(
    `WITH last_party AS (
       SELECT DISTINCT ON (table_id) table_id, party_size
       FROM ${SCHEMA}.table_events
       WHERE app_id=$1 AND tenant_id=$2 AND to_status='occupied'
       ORDER BY table_id, ts DESC
     )
     SELECT
       COUNT(*)::int                                              AS total_tables,
       COALESCE(SUM(t.capacity),0)::int                           AS total_capacity,
       COUNT(*) FILTER (WHERE t.status='occupied')::int           AS occupied_tables,
       COALESCE(SUM(t.capacity) FILTER (WHERE t.status='occupied'),0)::int AS occupied_capacity,
       COALESCE(SUM(lp.party_size) FILTER (WHERE t.status='occupied'),0)::int AS seated_guests
     FROM ${SCHEMA}.tables t
     LEFT JOIN last_party lp ON lp.table_id = t.id
     WHERE ${filters.join(' AND ')}`,
    params,
  )
  return rows[0]
}

export async function recordTableEvent(client, e) {
  await client.query(
    `INSERT INTO ${SCHEMA}.table_events (app_id, tenant_id, table_id, from_status, to_status,
                                         reservation_id, party_size, actor_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [e.appId, e.tenantId, e.tableId, e.fromStatus ?? null, e.toStatus,
     e.reservationId ?? null, e.partySize ?? null, e.actorUserId ?? null],
  )
}
