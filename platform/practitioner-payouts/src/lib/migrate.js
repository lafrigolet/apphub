import { readdir, readFile } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'
import { env } from './env.js'
import { logger } from './logger.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = join(__dirname, '../../migrations')
const SCHEMA = 'platform_practitioner_payouts'

export async function runMigrations(superuserUrl) {
  const url = superuserUrl ?? env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL
  const migrationPool = new pg.Pool({ connectionString: url })
  const client = await migrationPool.connect()
  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`)
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.migrations (
        id          SERIAL PRIMARY KEY,
        filename    TEXT NOT NULL UNIQUE,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `)
    const { rows } = await client.query(`SELECT filename FROM ${SCHEMA}.migrations ORDER BY filename`)
    const applied = new Set(rows.map((r) => r.filename))
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort()
    let count = 0
    for (const file of files) {
      if (applied.has(file)) continue
      const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8')
      logger.info(`Applying migration: ${file}`)
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query(`INSERT INTO ${SCHEMA}.migrations (filename) VALUES ($1)`, [file])
        await client.query('COMMIT')
        count++
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      }
    }
    if (count === 0) logger.info('No pending migrations')
    else logger.info(`Applied ${count} migration(s)`)
  } finally {
    client.release()
    await migrationPool.end()
  }
}

const isMain = process.argv[1]?.endsWith('migrate.js')
if (isMain) {
  runMigrations()
    .then(() => { logger.info('Migrations complete'); process.exit(0) })
    .catch((err) => { logger.error({ err }, 'Migration failed'); process.exit(1) })
}
