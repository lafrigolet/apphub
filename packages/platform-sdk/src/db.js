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

/**
 * Idempotently provisions the dedicated service role for a platform module:
 * creates the role with the password baked into its DATABASE_URL_<MODULE>,
 * grants USAGE on its schema, DML on existing + future tables, and SEQUENCE
 * access. Re-runs safely on every boot.
 *
 * Replaces the role-provisioning blocks of
 * infra/postgres/init/01_platform_schemas.sql, which only execute on a
 * virgin postgres volume. Long-lived deployments adding a new module to the
 * codebase used to require manual `CREATE ROLE` in prod (see the inquiries
 * incident, May 2026); calling this from platform-core's boot reconciles
 * that drift automatically.
 *
 * MUST be called by the platform-core orchestrator AFTER the module's
 * `runMigrations()` so the schema and current tables exist when grants run.
 * Uses the superuser URL because CREATE ROLE and GRANT require it.
 *
 * Both `schema` and the role parsed out of `databaseUrl` are validated
 * against an identifier whitelist before being interpolated as SQL (DDL
 * cannot use parameterized queries). The password is escaped with the
 * standard double-single-quote rule.
 */
export async function ensureModuleRole(superuserUrl, { schema, databaseUrl }) {
  if (!superuserUrl) throw new Error('ensureModuleRole: superuserUrl is required')
  if (!schema)       throw new Error('ensureModuleRole: schema is required')
  if (!databaseUrl)  throw new Error('ensureModuleRole: databaseUrl is required')

  const parsed = new URL(databaseUrl)
  const role     = decodeURIComponent(parsed.username || '')
  const password = decodeURIComponent(parsed.password || '')
  if (!role)     throw new Error(`ensureModuleRole: no role in ${databaseUrl}`)
  if (!password) throw new Error(`ensureModuleRole: no password in ${databaseUrl}`)

  const IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/
  if (!IDENT.test(role))   throw new Error(`ensureModuleRole: invalid role identifier '${role}'`)
  if (!IDENT.test(schema)) throw new Error(`ensureModuleRole: invalid schema identifier '${schema}'`)

  const passwordLiteral = `'${password.replace(/'/g, "''")}'`

  const pool = new Pool({ connectionString: superuserUrl })
  const client = await pool.connect()
  try {
    const { rows } = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role])
    if (rows.length === 0) {
      await client.query(`CREATE ROLE ${role} LOGIN PASSWORD ${passwordLiteral}`)
    }
    await client.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`)
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${schema} TO ${role}`)
    await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${schema} TO ${role}`)
    await client.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role}`,
    )
    await client.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} GRANT USAGE, SELECT ON SEQUENCES TO ${role}`,
    )
  } finally {
    client.release()
    await pool.end()
  }
}
