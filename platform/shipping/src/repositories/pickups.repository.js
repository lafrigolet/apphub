const SCHEMA = 'platform_shipping'

export async function insertPickup(client, appId, tenantId, p) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.pickups
       (app_id, tenant_id, address_id, easypost_pickup_id, status, carrier, service,
        confirmation, min_datetime, max_datetime, instructions, shipment_ids, rate, metadata)
     VALUES ($1,$2,$3,$4,COALESCE($5,'scheduled'),$6,$7,$8,$9,$10,$11,COALESCE($12,'{}'),$13,COALESCE($14,'{}'::jsonb))
     RETURNING *`,
    [
      appId, tenantId, p.addressId ?? null, p.easypostPickupId ?? null, p.status ?? null,
      p.carrier ?? null, p.service ?? null, p.confirmation ?? null,
      p.minDatetime ?? null, p.maxDatetime ?? null, p.instructions ?? null,
      p.shipmentIds ?? null, p.rate ?? null, p.metadata ?? null,
    ],
  )
  return rows[0]
}

export async function listPickups(client, appId, tenantId, { status, limit } = {}) {
  const params = [appId, tenantId]
  let where = 'app_id=$1 AND tenant_id=$2'
  if (status) { where += ` AND status = $${params.length + 1}`; params.push(status) }
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200)
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.pickups WHERE ${where} ORDER BY created_at DESC LIMIT ${lim}`,
    params,
  )
  return rows
}

export async function findPickupById(client, appId, tenantId, id) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.pickups WHERE app_id=$1 AND tenant_id=$2 AND id=$3`,
    [appId, tenantId, id],
  )
  return rows[0] ?? null
}

export async function updatePickup(client, appId, tenantId, id, patch) {
  const cols = {
    status: patch.status, carrier: patch.carrier, service: patch.service,
    confirmation: patch.confirmation, rate: patch.rate, easypost_pickup_id: patch.easypostPickupId,
  }
  const sets = []
  const params = [appId, tenantId, id]
  for (const [col, val] of Object.entries(cols)) {
    if (val !== undefined) { sets.push(`${col} = $${params.length + 1}`); params.push(val) }
  }
  if (sets.length === 0) return findPickupById(client, appId, tenantId, id)
  sets.push('updated_at = now()')
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.pickups SET ${sets.join(', ')}
      WHERE app_id=$1 AND tenant_id=$2 AND id=$3 RETURNING *`,
    params,
  )
  return rows[0] ?? null
}
