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

export async function updateStation(client, appId, tenantId, id, patch) {
  const sets = []
  const params = [appId, tenantId, id]
  let i = 4
  if (patch.name !== undefined)          { sets.push(`name = $${i++}`);           params.push(patch.name) }
  if (patch.displayOrder !== undefined)  { sets.push(`display_order = $${i++}`);  params.push(patch.displayOrder) }
  if (patch.routesCourses !== undefined) { sets.push(`routes_courses = $${i++}`); params.push(patch.routesCourses) }
  if (patch.isActive !== undefined)      { sets.push(`is_active = $${i++}`);      params.push(patch.isActive) }
  if (!sets.length) {
    const { rows } = await client.query(
      `SELECT * FROM ${SCHEMA}.stations WHERE app_id=$1 AND tenant_id=$2 AND id=$3`, [appId, tenantId, id],
    )
    return rows[0] ?? null
  }
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.stations SET ${sets.join(', ')}
     WHERE app_id=$1 AND tenant_id=$2 AND id=$3 RETURNING *`,
    params,
  )
  return rows[0] ?? null
}

export async function deleteStation(client, appId, tenantId, id) {
  const { rowCount } = await client.query(
    `DELETE FROM ${SCHEMA}.stations WHERE app_id=$1 AND tenant_id=$2 AND id=$3`,
    [appId, tenantId, id],
  )
  return rowCount > 0
}

// Reassigns tickets that point at a station (used before deleting / deactivating it).
export async function reassignTicketsStation(client, appId, tenantId, fromStationId, toStationId) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.tickets SET station_id=$4
     WHERE app_id=$1 AND tenant_id=$2 AND station_id=$3 RETURNING id`,
    [appId, tenantId, fromStationId, toStationId],
  )
  return rows.map((r) => r.id)
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

export async function listTicketsByOrder(client, appId, tenantId, orderId) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.tickets
     WHERE app_id=$1 AND tenant_id=$2 AND order_id=$3
     ORDER BY fired_at ASC`,
    [appId, tenantId, orderId],
  )
  return rows
}

export async function setTicketStatus(client, appId, tenantId, id, status, tsCol, reason = null) {
  // For cancellations also persist the reason; tsCol is always a known column name
  // chosen by the service (never user input), so interpolation is safe.
  if (status === 'cancelled') {
    const { rows } = await client.query(
      `UPDATE ${SCHEMA}.tickets SET status=$4, cancelled_at=now(), cancel_reason=$5
       WHERE app_id=$1 AND tenant_id=$2 AND id=$3 RETURNING *`,
      [appId, tenantId, id, status, reason],
    )
    return rows[0] ?? null
  }
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.tickets SET status=$4, ${tsCol}=now()
     WHERE app_id=$1 AND tenant_id=$2 AND id=$3 RETURNING *`,
    [appId, tenantId, id, status],
  )
  return rows[0] ?? null
}

// Bulk-cancel every still-open ticket of an order (auto-cancellation path).
export async function cancelTicketsByOrder(client, appId, tenantId, orderId, reason) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.tickets SET status='cancelled', cancelled_at=now(), cancel_reason=$4
     WHERE app_id=$1 AND tenant_id=$2 AND order_id=$3
       AND status IN ('fired','in_progress','ready')
     RETURNING *`,
    [appId, tenantId, orderId, reason ?? null],
  )
  return rows
}

export async function findItemById(client, appId, tenantId, id) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.ticket_items WHERE app_id=$1 AND tenant_id=$2 AND id=$3`,
    [appId, tenantId, id],
  )
  return rows[0] ?? null
}

export async function setItemStatus(client, appId, tenantId, id, status) {
  const tsClause = status === 'ready' ? ', ready_at=now()' : ''
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.ticket_items SET status=$4${tsClause}
     WHERE app_id=$1 AND tenant_id=$2 AND id=$3 RETURNING *`,
    [appId, tenantId, id, status],
  )
  return rows[0] ?? null
}

// All-day view: SUM(qty) per (sku, name) of still-active tickets, optionally
// scoped to one station, broken down by ticket status.
export async function allDayTotals(client, appId, tenantId, { stationId } = {}) {
  const filters = ["app_id = $1", "tenant_id = $2", "status IN ('fired','in_progress')"]
  const params = [appId, tenantId]
  let i = 3
  if (stationId) { filters.push(`station_id = $${i++}`); params.push(stationId) }
  const { rows } = await client.query(
    `SELECT i.sku, i.name,
            SUM(i.qty)::int AS total,
            SUM(i.qty) FILTER (WHERE t.status = 'fired')::int       AS fired,
            SUM(i.qty) FILTER (WHERE t.status = 'in_progress')::int AS in_progress
     FROM ${SCHEMA}.ticket_items i
     JOIN ${SCHEMA}.tickets t ON t.id = i.ticket_id
     WHERE ${filters.map((f) => f.replace(/^(app_id|tenant_id|status|station_id)/, 't.$1')).join(' AND ')}
     GROUP BY i.sku, i.name
     ORDER BY total DESC, i.name ASC`,
    params,
  )
  return rows
}

// Prep-time / reaction / cancellation metrics over a window, grouped by station+course.
export async function metrics(client, appId, tenantId, { from, to } = {}) {
  const filters = ['app_id = $1', 'tenant_id = $2']
  const params = [appId, tenantId]
  let i = 3
  if (from) { filters.push(`fired_at >= $${i++}`); params.push(from) }
  if (to)   { filters.push(`fired_at <  $${i++}`); params.push(to) }
  const { rows } = await client.query(
    `SELECT station_id, course,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
            AVG(EXTRACT(EPOCH FROM (acked_at    - fired_at))) FILTER (WHERE acked_at    IS NOT NULL) AS avg_ack_secs,
            AVG(EXTRACT(EPOCH FROM (ready_at     - fired_at))) FILTER (WHERE ready_at     IS NOT NULL) AS avg_prep_secs,
            AVG(EXTRACT(EPOCH FROM (picked_up_at - ready_at))) FILTER (WHERE picked_up_at IS NOT NULL AND ready_at IS NOT NULL) AS avg_pickup_secs
     FROM ${SCHEMA}.tickets
     WHERE ${filters.join(' AND ')}
     GROUP BY station_id, course
     ORDER BY station_id NULLS LAST, course`,
    params,
  )
  return rows
}
