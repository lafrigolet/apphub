import pg from 'pg'

const { Pool } = pg

/**
 * Creates a pg Pool. Consuming services call this with their own DATABASE_URL.
 */
export function createPool(connectionString) {
  const pool = new Pool({
    connectionString,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  })
  pool.on('error', (err) => {
    console.error({ err }, 'Unexpected PostgreSQL pool error')
  })
  return pool
}

/**
 * Sets the three RLS session config vars on a client connection.
 * Must be called inside every transaction before any query.
 */
export async function setTenantContext(client, appId, tenantId, subTenantId) {
  await client.query('SELECT set_config($1, $2, true)', ['app.app_id',        appId])
  await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id',     tenantId])
  await client.query('SELECT set_config($1, $2, true)', ['app.sub_tenant_id', subTenantId ?? ''])
}

/**
 * Wraps fn(client) in a transaction with full tenant context set.
 */
export async function withTenantTransaction(pool, appId, tenantId, subTenantId, fn) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await setTenantContext(client, appId, tenantId, subTenantId)
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

/**
 * Plain transaction without tenant context — for migrations and platform-level ops.
 */
export async function withTransaction(pool, fn) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
