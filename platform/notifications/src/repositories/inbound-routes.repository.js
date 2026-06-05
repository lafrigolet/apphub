// inbound_routes — staff-managed address → event rules. Matching precedence:
// exact address first, then whole-domain catch-all. Plus-addressed replies
// (reply+<token>@…) never reach these rules — they resolve via reply tokens.

export async function insert(client, r) {
  const { rows } = await client.query(
    `INSERT INTO platform_notifications.inbound_routes
       (match_type, pattern, target_event, app_id, tenant_id, enabled, description)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, true), $7)
     RETURNING *`,
    [
      r.matchType ?? 'exact', r.pattern.toLowerCase(), r.targetEvent,
      r.appId ?? null, r.tenantId ?? null, r.enabled ?? null, r.description ?? null,
    ],
  )
  return rows[0]
}

export async function listAll(client) {
  const { rows } = await client.query(
    `SELECT * FROM platform_notifications.inbound_routes ORDER BY created_at`,
  )
  return rows
}

export async function findById(client, id) {
  const { rows } = await client.query(
    `SELECT * FROM platform_notifications.inbound_routes WHERE id = $1`, [id],
  )
  return rows[0] ?? null
}

export async function update(client, id, patch) {
  const sets = []
  const params = [id]
  const map = {
    matchType: 'match_type', pattern: 'pattern', targetEvent: 'target_event',
    appId: 'app_id', tenantId: 'tenant_id', enabled: 'enabled', description: 'description',
  }
  for (const [k, col] of Object.entries(map)) {
    if (patch[k] !== undefined) {
      params.push(k === 'pattern' ? String(patch[k]).toLowerCase() : patch[k])
      sets.push(`${col} = $${params.length}`)
    }
  }
  if (!sets.length) return findById(client, id)
  const { rows } = await client.query(
    `UPDATE platform_notifications.inbound_routes
     SET ${sets.join(', ')}, updated_at = now()
     WHERE id = $1 RETURNING *`,
    params,
  )
  return rows[0] ?? null
}

export async function remove(client, id) {
  const { rowCount } = await client.query(
    `DELETE FROM platform_notifications.inbound_routes WHERE id = $1`, [id],
  )
  return rowCount > 0
}

// First enabled rule matching the address: exact wins over domain catch-all.
export async function findMatch(client, address) {
  const addr = String(address).toLowerCase()
  const domain = addr.split('@')[1] ?? ''
  const { rows } = await client.query(
    `SELECT * FROM platform_notifications.inbound_routes
     WHERE enabled
       AND ((match_type = 'exact' AND pattern = $1) OR (match_type = 'domain' AND pattern = $2))
     ORDER BY (match_type = 'exact') DESC, created_at
     LIMIT 1`,
    [addr, domain],
  )
  return rows[0] ?? null
}
