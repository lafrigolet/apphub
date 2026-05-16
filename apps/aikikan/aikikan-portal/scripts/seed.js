#!/usr/bin/env node
/**
 * Development seed for aikikan-portal.
 *
 *   pnpm --filter @aikikan/aikikan-portal seed
 *
 * Idempotente — re-ejecutable. Refusa correr en producción.
 * Crea:
 *   - 1 app  : aikikan          (subdominio aikikan.apphub.{local,com})
 *   - 1 tenant : Aikikan España   (subdominio aikikan-es)
 *   - 1 admin  : admin@aikikan.es  (rol owner — entra al tenant-console)
 *   - 1 socio  : socio@aikikan.es  (rol user  — entra a MemberHome)
 *
 * Required env:
 *   MIGRATION_DATABASE_URL — superuser connection string (defaults to local dev)
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

const APP_ID         = 'aikikan'
const APP_SUBDOMAIN  = 'aikikan'
const TENANT_ID      = '30000000-0000-0000-0000-000000000001'
const TENANT_NAME    = 'Aikikan España'
const TENANT_SUB     = 'aikikan-es'
const PASSWORD_PLAIN = 'password123'

const USERS = [
  {
    id:          '40000000-0000-0000-0000-000000000001',
    email:       'admin@aikikan.es',
    role:        'owner',                  // entra al tenant-console
    displayName: 'Admin Aikikan',
  },
  {
    id:          '40000000-0000-0000-0000-000000000002',
    email:       'socio@aikikan.es',
    role:        'user',                   // entra a MemberHome
    displayName: 'Socio Aikikan',
  },
]

// Default modules para el tenant-console del admin (los mismos que la
// migración 0006 deja sembrados para apps appointments-flavored).
const ENABLED_MODULES = [
  'tenants', 'auth', 'audit', 'notifications',
  'services', 'resources', 'bookings', 'availability',
  'packages', 'practitioner-payouts',
]

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
       VALUES ($1, 'Aikikan', $2, $1, $3)
       ON CONFLICT (app_id) DO UPDATE SET
         display_name    = EXCLUDED.display_name,
         subdomain       = EXCLUDED.subdomain,
         enabled_modules = EXCLUDED.enabled_modules`,
      [APP_ID, APP_SUBDOMAIN, ENABLED_MODULES],
    )

    // 2. Tenant — idempotente.
    await client.query(
      `INSERT INTO platform_tenants.tenants
         (id, app_id, display_name, subdomain, status, country, plan,
          contact_email, default_locale)
       VALUES ($1, $2, $3, $4, 'active', 'ES', 'STARTER',
               'secretaria@aikikan.es', 'es')
       ON CONFLICT (id) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         subdomain    = EXCLUDED.subdomain,
         status       = EXCLUDED.status`,
      [TENANT_ID, APP_ID, TENANT_NAME, TENANT_SUB],
    )

    // 3. Users — admin + socio. Idempotente.
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

    // 4. Member profile (app_aikikan) — only for the socio. Admin doesn't
    // see MemberHome so we skip the row; if the schema isn't there yet
    // (aikikan-server hasn't migrated), the INSERT is wrapped in a
    // try/catch that ignores undefined-table errors. The seed completes
    // and the user can re-run after `docker compose up aikikan-server`.
    try {
      await client.query(
        `INSERT INTO app_aikikan.members
           (user_id, app_id, tenant_id,
            member_number, member_since, aikido_grade, dojo_name, notes)
         VALUES ($1, $2, $3, '0001', '2018-09-15', 'KYU_2',
                 'Dojo Central Madrid', 'Datos de prueba seedados localmente')
         ON CONFLICT (user_id) DO UPDATE SET
           member_number = EXCLUDED.member_number,
           member_since  = EXCLUDED.member_since,
           aikido_grade  = EXCLUDED.aikido_grade,
           dojo_name     = EXCLUDED.dojo_name,
           notes         = EXCLUDED.notes,
           updated_at    = now()`,
        [USERS[1].id, APP_ID, TENANT_ID],     // socio = USERS[1]
      )
    } catch (err) {
      if (err.code === '42P01' /* undefined_table */ || err.code === '3F000' /* invalid_schema_name */) {
        console.warn('  [skip] app_aikikan.members not migrated yet — start aikikan-server and re-run seed')
      } else {
        throw err
      }
    }

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }

  console.log('\n✓ Aikikan seed complete.\n')
  console.log(`  App:        ${APP_ID}        (subdomain: ${APP_SUBDOMAIN}.hulkstein.local)`)
  console.log(`  Tenant:     ${TENANT_NAME}   (subdomain: ${TENANT_SUB}.hulkstein.local)`)
  console.log(`  Modules:    ${ENABLED_MODULES.length} habilitados`)
  console.log('')
  console.log('  Login (password "password123" para los dos):')
  console.log(`    admin@aikikan.es   → owner   → redirige a tenant-console`)
  console.log(`    socio@aikikan.es   → user    → muestra MemberHome\n`)
}

main()
  .then(() => { pool.end(); process.exit(0) })
  .catch((err) => { console.error(err); pool.end(); process.exit(1) })
