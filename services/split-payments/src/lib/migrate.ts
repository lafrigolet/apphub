import { readdir, readFile } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { pool } from './db.js'
import { logger } from './logger.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = join(__dirname, '../../migrations')

export async function runMigrations(): Promise<void> {
  const client = await pool.connect()

  try {
    // Create migrations tracking table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS payments.migrations (
        id          SERIAL PRIMARY KEY,
        filename    TEXT NOT NULL UNIQUE,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `)

    // Get already-applied migrations
    const { rows } = await client.query<{ filename: string }>(
      'SELECT filename FROM payments.migrations ORDER BY filename',
    )
    const applied = new Set(rows.map((r) => r.filename))

    // Read migration files
    const files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith('.sql'))
      .sort()

    let count = 0
    for (const file of files) {
      if (applied.has(file)) continue

      const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8')
      logger.info(`Applying migration: ${file}`)

      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('INSERT INTO payments.migrations (filename) VALUES ($1)', [file])
        await client.query('COMMIT')
        count++
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      }
    }

    if (count === 0) {
      logger.info('No pending migrations')
    } else {
      logger.info(`Applied ${count} migration(s)`)
    }
  } finally {
    client.release()
  }
}

// Run directly: tsx src/lib/migrate.ts
const isMain = process.argv[1]?.endsWith('migrate.ts') || process.argv[1]?.endsWith('migrate.js')
if (isMain) {
  runMigrations()
    .then(() => {
      logger.info('Migrations complete')
      process.exit(0)
    })
    .catch((err) => {
      logger.error({ err }, 'Migration failed')
      process.exit(1)
    })
}
