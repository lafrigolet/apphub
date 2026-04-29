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

export async function recordTableEvent(client, e) {
  await client.query(
    `INSERT INTO ${SCHEMA}.table_events (app_id, tenant_id, table_id, from_status, to_status,
                                         reservation_id, party_size, actor_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [e.appId, e.tenantId, e.tableId, e.fromStatus ?? null, e.toStatus,
     e.reservationId ?? null, e.partySize ?? null, e.actorUserId ?? null],
  )
}
