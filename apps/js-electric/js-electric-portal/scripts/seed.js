#!/usr/bin/env node
/**
 * Development seed for js-electric-portal.
 *
 *   pnpm --filter @js-electric/js-electric-portal seed
 *
 * Idempotente — re-ejecutable. Refusa correr en producción.
 * Crea:
 *   - 1 app    : js-electric              (subdominio js-electric.hulkstein.{local,com})
 *   - 1 tenant : JS Electric Madrid       (subdomain js-electric)
 *   - 1 admin  : admin@jselectric.es      (rol owner — accede a /admin/inquiries)
 *
 * No hay app schema (app_js_electric) — la app es marketing puro + inbox
 * de inquiries (REUSE de platform/inquiries). Si en el futuro se añade
 * CMS para projects/blog/testimonials, ese día se crea el schema y se
 * extiende este seed.
 *
 * Required env:
 *   MIGRATION_DATABASE_URL — superuser connection string (defaults a local dev)
 */
import pg from 'pg'
import bcrypt from 'bcrypt'

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to run seed in production.')
  process.exit(1)
}

const DB_URL =
  process.env.MIGRATION_DATABASE_URL ??
  'postgresql://splitpay:splitpay@localhost:5432/splitpay'

const APP_ID         = 'js-electric'
const APP_DISPLAY    = 'JS Electric'
const APP_SUBDOMAIN  = 'js-electric'
const TENANT_ID      = '50000000-0000-0000-0000-000000000001'
const TENANT_NAME    = 'JS Electric Madrid'
const TENANT_SUB     = 'js-electric'
const PASSWORD_PLAIN = 'password123'

const USERS = [
  {
    id:          '60000000-0000-0000-0000-000000000001',
    email:       'admin@jselectric.es',
    role:        'owner',                  // accede a /admin/inquiries
    displayName: 'Admin JS Electric',
  },
]

// Módulos habilitados para este tenant. Mínimo viable para que el admin
// pueda autenticarse y leer la bandeja de inquiries.
const ENABLED_MODULES = ['tenants', 'auth', 'audit', 'notifications', 'inquiries']

const pool = new pg.Pool({ connectionString: DB_URL })

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD_PLAIN, 10)
  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    // 1. App entry — idempotente.
    await client.query(
      `INSERT INTO platform_tenants.apps
         (app_id, display_name, subdomain, jwt_audience, enabled_modules)
       VALUES ($1, $2, $3, $1, $4)
       ON CONFLICT (app_id) DO UPDATE SET
         display_name    = EXCLUDED.display_name,
         subdomain       = EXCLUDED.subdomain,
         enabled_modules = EXCLUDED.enabled_modules`,
      [APP_ID, APP_DISPLAY, APP_SUBDOMAIN, ENABLED_MODULES],
    )

    // 2. Tenant — idempotente.
    await client.query(
      `INSERT INTO platform_tenants.tenants
         (id, app_id, display_name, subdomain, status, country, plan,
          contact_email, default_locale)
       VALUES ($1, $2, $3, $4, 'active', 'ES', 'STARTER',
               'hola@jselectric.es', 'es')
       ON CONFLICT (id) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         subdomain    = EXCLUDED.subdomain,
         status       = EXCLUDED.status`,
      [TENANT_ID, APP_ID, TENANT_NAME, TENANT_SUB],
    )

    // 3. Users.
    for (const u of USERS) {
      await client.query(
        `INSERT INTO platform_auth.users
           (id, app_id, tenant_id, email, password_hash, role, display_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET
           email         = EXCLUDED.email,
           password_hash = EXCLUDED.password_hash,
           role          = EXCLUDED.role,
           display_name  = EXCLUDED.display_name,
           revoked_at    = NULL`,
        [u.id, APP_ID, TENANT_ID, u.email, passwordHash, u.role, u.displayName],
      )
    }

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }

  console.log('\n✓ JS Electric seed complete.\n')
  console.log(`  App:        ${APP_ID}      (subdomain: ${APP_SUBDOMAIN}.hulkstein.local)`)
  console.log(`  Tenant:     ${TENANT_NAME} (subdomain: ${TENANT_SUB}.hulkstein.local)`)
  console.log(`  Modules:    ${ENABLED_MODULES.length} habilitados`)
  console.log('')
  console.log('  Login (password "password123"):')
  console.log(`    admin@jselectric.es → owner → /admin/inquiries\n`)
}

main()
  .then(() => { pool.end(); process.exit(0) })
  .catch((err) => { console.error(err); pool.end(); process.exit(1) })
