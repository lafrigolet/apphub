import pg from 'pg'
import { env } from './env.js'
import { logger } from './logger.js'

const { Pool } = pg

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
})

pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected PostgreSQL pool error')
})

export const cronPool = new Pool({
  connectionString: env.YOGA_CRON_DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
})

cronPool.on('error', (err) => {
  logger.error({ err }, 'Unexpected cron PostgreSQL pool error')
})

export async function setTenantContext(client, tenantId, subTenantId) {
  await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId])
  await client.query('SELECT set_config($1, $2, true)', ['app.sub_tenant_id', subTenantId ?? ''])
}

export async function withTransaction(fn) {
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

export async function withTenantTransaction(tenantId, subTenantId, fn) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await setTenantContext(client, tenantId, subTenantId)
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
