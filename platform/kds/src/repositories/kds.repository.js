const SCHEMA = 'platform_kds'

export async function insertStation(client, s) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.stations (app_id, tenant_id, name, display_order, routes_courses, is_active)
     VALUES ($1,$2,$3,COALESCE($4,0),COALESCE($5,'{}'::text[]),COALESCE($6,TRUE)) RETURNING *`,
    [s.appId, s.tenantId, s.name, s.displayOrder ?? 0, s.routesCourses ?? [], s.isActive ?? true],
  )
  return rows[0]
}

export async function listStations(client, appId, tenantId) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.stations WHERE app_id=$1 AND tenant_id=$2 ORDER BY display_order, name`,
    [appId, tenantId],
  )
  return rows
}

export async function findStationByCourse(client, appId, tenantId, course) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.stations
     WHERE app_id=$1 AND tenant_id=$2 AND is_active = TRUE
       AND $3 = ANY(routes_courses)
     ORDER BY display_order LIMIT 1`,
    [appId, tenantId, course],
  )
  return rows[0] ?? null
}

export async function insertTicket(client, t) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.tickets (app_id, tenant_id, order_id, station_id, course, status, table_code, notes)
     VALUES ($1,$2,$3,$4,COALESCE($5,'main'),COALESCE($6,'fired'),$7,$8) RETURNING *`,
    [t.appId, t.tenantId, t.orderId, t.stationId ?? null, t.course ?? 'main', t.status ?? 'fired',
     t.tableCode ?? null, t.notes ?? null],
  )
  return rows[0]
}

export async function insertTicketItem(client, ti) {
  await client.query(
    `INSERT INTO ${SCHEMA}.ticket_items (app_id, tenant_id, ticket_id, sku, name, qty, modifiers, notes)
     VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,'[]'::jsonb),$8)`,
    [ti.appId, ti.tenantId, ti.ticketId, ti.sku, ti.name, ti.qty, JSON.stringify(ti.modifiers ?? []), ti.notes ?? null],
  )
}

export async function listTickets(client, appId, tenantId, { stationId, status, limit = 100 } = {}) {
  const filters = ['app_id = $1', 'tenant_id = $2']
  const params  = [appId, tenantId]
  let i = 3
  if (stationId) { filters.push(`station_id = $${i++}`); params.push(stationId) }
  if (status)    { filters.push(`status = $${i++}`);     params.push(status) }
  params.push(limit)
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.tickets WHERE ${filters.join(' AND ')}
     ORDER BY fired_at ASC LIMIT $${i++}`,
    params,
  )
  return rows
}

export async function findTicketById(client, appId, tenantId, id) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.tickets WHERE app_id=$1 AND tenant_id=$2 AND id=$3`,
    [appId, tenantId, id],
  )
  return rows[0] ?? null
}

export async function findItemsByTicket(client, appId, tenantId, ticketId) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.ticket_items WHERE app_id=$1 AND tenant_id=$2 AND ticket_id=$3`,
    [appId, tenantId, ticketId],
  )
  return rows
}

export async function setTicketStatus(client, appId, tenantId, id, status, tsCol) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.tickets SET status=$4, ${tsCol}=now()
     WHERE app_id=$1 AND tenant_id=$2 AND id=$3 RETURNING *`,
    [appId, tenantId, id, status],
  )
  return rows[0] ?? null
}
