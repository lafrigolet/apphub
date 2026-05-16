#!/usr/bin/env node
/**
 * Development seed for console.
 *
 *   pnpm --filter @console/console-portal seed
 *
 * Safe to run multiple times — all inserts are idempotent.
 * Refuses to run when NODE_ENV=production.
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

const APP_ID           = 'console'
const PLATFORM_APP     = 'platform'
const PLATFORM_TENANT  = '00000000-0000-0000-0000-0000000000f0'
const PASSWORD_PLAIN   = 'password123'

// Fixed UUIDs so re-runs are idempotent.
const T = (n) => `10000000-0000-0000-0000-00000000${String(n).padStart(4, '0')}`
const U = (n) => `20000000-0000-0000-0000-00000000${String(n).padStart(4, '0')}`

const TENANTS = [
  { id: T(1),  displayName: 'Tienda Ana',         subdomain: 'tienda-ana',       legalName: 'Tienda Ana SL',          cif: 'B12345678', country: 'ES', plan: 'PRO',        status: 'active',    stripe: 'VERIFIED',     customDomain: 'tienda-ana.com',  contactEmail: 'hola@tiendaana.com',   volMonth: 147820000, txMonth: 3421,  balance: 0 },
  { id: T(2),  displayName: 'Pedro Market',       subdomain: 'pedro',             legalName: 'Pedro Digital SL',       cif: 'B87654321', country: 'ES', plan: 'STARTER',    status: 'active',    stripe: 'VERIFIED',     customDomain: null,              contactEmail: 'contacto@pedromarket.com', volMonth: 58210000,  txMonth: 1120,  balance: 0 },
  { id: T(3),  displayName: 'Marketplace Norte',  subdomain: 'marketplace-norte', legalName: 'MN Digital SL',          cif: 'B22334455', country: 'ES', plan: 'PRO',        status: 'suspended', stripe: 'RESTRICTED',   customDomain: null,              contactEmail: 'info@mnorte.com',          volMonth: 0,         txMonth: 0,     balance: 34000, suspendReason: 'NON_PAYMENT' },
  { id: T(4),  displayName: 'Artisan Co.',        subdomain: 'artisan',           legalName: 'Artisan Coop LTD',       cif: 'GB7722100', country: 'GB', plan: 'ENTERPRISE', status: 'active',    stripe: 'VERIFIED',     customDomain: 'shop.artisan.co', contactEmail: 'hello@artisan.co',         volMonth: 412400000, txMonth: 8900,  balance: 0 },
  { id: T(5),  displayName: 'FoodHub',            subdomain: 'foodhub',           legalName: 'FoodHub Tech SAS',       cif: 'FR9911222', country: 'FR', plan: 'PRO',        status: 'active',    stripe: 'PENDING',      customDomain: null,              contactEmail: 'cc@foodhub.fr',            volMonth: 98320000,  txMonth: 2340,  balance: 0 },
  { id: T(6),  displayName: 'Ciclo Bike',         subdomain: 'ciclo-bike',        legalName: 'Ciclo Iberia SL',        cif: 'B55667788', country: 'ES', plan: 'STARTER',    status: 'active',    stripe: 'VERIFIED',     customDomain: null,              contactEmail: 'taller@ciclobike.es',      volMonth: 23140000,  txMonth: 412,   balance: 0 },
  { id: T(7),  displayName: 'AulaLab',            subdomain: 'aulalab',           legalName: 'AulaLab Educación SL',   cif: 'B99887766', country: 'ES', plan: 'PRO',        status: 'archived',  stripe: 'DISCONNECTED', customDomain: null,              contactEmail: 'archivo@aulalab.com',      volMonth: 0,         txMonth: 0,     balance: 0, archivedAt: '2025-11-20T00:00:00Z' },
  { id: T(8),  displayName: 'Rentas Mar',         subdomain: 'rentas-mar',        legalName: 'Rentas del Mar SL',      cif: 'B44556677', country: 'ES', plan: 'PRO',        status: 'active',    stripe: 'VERIFIED',     customDomain: 'rentasmar.es',    contactEmail: 'reservas@rentasmar.es',    volMonth: 201500000, txMonth: 980,   balance: 0 },
  { id: T(9),  displayName: 'Gimnasio Horizonte', subdomain: 'horizonte',         legalName: 'Horizonte Fit SL',       cif: 'B11223344', country: 'ES', plan: 'STARTER',    status: 'active',    stripe: 'VERIFIED',     customDomain: null,              contactEmail: 'info@gimhorizonte.es',     volMonth: 14800000,  txMonth: 320,   balance: 0 },
  { id: T(10), displayName: 'CasaVerde',          subdomain: 'casaverde',         legalName: 'CasaVerde Eco SL',       cif: 'B66778899', country: 'ES', plan: 'PRO',        status: 'suspended', stripe: 'VERIFIED',     customDomain: null,              contactEmail: 'admin@casaverde.com',      volMonth: 0,         txMonth: 0,     balance: 0, suspendReason: 'SECURITY_INCIDENT' },
  { id: T(11), displayName: 'Libros del Sur',     subdomain: 'librosdelsur',      legalName: 'Libros del Sur SL',      cif: 'B00998877', country: 'ES', plan: 'STARTER',    status: 'active',    stripe: 'VERIFIED',     customDomain: null,              contactEmail: 'contacto@librosdelsur.es', volMonth: 8900000,   txMonth: 210,   balance: 0 },
  { id: T(12), displayName: 'StudioPro',          subdomain: 'studio-pro',        legalName: 'Studio Pro Digital SL',  cif: 'B33445566', country: 'ES', plan: 'ENTERPRISE', status: 'active',    stripe: 'VERIFIED',     customDomain: 'studiopro.io',    contactEmail: 'ops@studiopro.io',         volMonth: 680120000, txMonth: 15200, balance: 0 },
]

const STAFF_USERS = [
  { id: U(1), email: 'ana@voragine.local',    role: 'super_admin', displayName: 'Ana García' },
  { id: U(2), email: 'david@voragine.local',  role: 'staff',       displayName: 'David Pérez' },
  { id: U(3), email: 'elena@voragine.local',  role: 'staff',       displayName: 'Elena Soto' },
  { id: U(4), email: 'miguel@voragine.local', role: 'super_admin', displayName: 'Miguel Duque' },
]

const TENANT_ADMINS = [
  { tenantId: T(1), users: [
    { id: U(10), email: 'pedro@tiendaana.com',  role: 'owner', displayName: 'Pedro Martínez' },
    { id: U(11), email: 'laura@tiendaana.com',  role: 'admin', displayName: 'Laura Ruiz' },
    { id: U(12), email: 'marcos@tiendaana.com', role: 'admin', displayName: 'Marcos Vila' },
  ] },
  { tenantId: T(2), users: [
    { id: U(20), email: 'sara@pedromarket.com',  role: 'owner', displayName: 'Sara López' },
    { id: U(21), email: 'nacho@pedromarket.com', role: 'admin', displayName: 'Nacho Bravo' },
  ] },
  { tenantId: T(4), users: [
    { id: U(30), email: 'owner@artisan.co', role: 'owner', displayName: 'Helen Fox' },
  ] },
]

const AUDIT_ENTRIES = [
  { ts: '2026-04-21T09:12:00Z', actorUserId: U(1),  actorRole: 'staff', tenantId: T(3),  action: 'TENANT_SUSPENDED', detail: 'Motivo: NON_PAYMENT',                ip: '81.202.11.44' },
  { ts: '2026-04-21T08:40:00Z', actorUserId: U(10), actorRole: 'owner', tenantId: T(1),  action: 'INVITE_SENT',       detail: 'marcos@tiendaana.com (ADMIN)',        ip: '91.126.22.1'  },
  { ts: '2026-04-20T17:55:00Z', actorUserId: U(11), actorRole: 'admin', tenantId: T(1),  action: 'TENANT_UPDATED',    detail: 'teléfono actualizado',                ip: '91.126.22.1'  },
  { ts: '2026-04-20T14:22:00Z', actorUserId: U(1),  actorRole: 'staff', tenantId: T(5),  action: 'TENANT_CREATED',    detail: 'plan PRO, owner: cc@foodhub.fr',      ip: '81.202.11.44' },
  { ts: '2026-04-20T11:07:00Z', actorUserId: U(10), actorRole: 'owner', tenantId: T(1),  action: 'ROLE_CHANGED',      detail: 'Laura Ruiz: admin → admin',           ip: '91.126.22.1'  },
  { ts: '2026-04-19T16:30:00Z', actorUserId: U(2),  actorRole: 'staff', tenantId: T(10), action: 'TENANT_SUSPENDED',  detail: 'Motivo: SECURITY_INCIDENT',           ip: '81.202.11.55' },
  { ts: '2026-04-19T10:15:00Z', actorUserId: U(20), actorRole: 'owner', tenantId: T(2),  action: 'INVITE_SENT',       detail: 'nacho@pedromarket.com (ADMIN)',       ip: '77.230.5.10'  },
  { ts: '2026-04-18T13:00:00Z', actorUserId: U(1),  actorRole: 'staff', tenantId: T(7),  action: 'TENANT_ARCHIVED',   detail: 'Retención: 90 días',                  ip: '81.202.11.44' },
  { ts: '2026-04-17T09:45:00Z', actorUserId: U(11), actorRole: 'admin', tenantId: T(1),  action: 'ADMIN_REVOKED',     detail: 'sergio@tiendaana.com',                ip: '91.126.22.1'  },
]

// ── main ───────────────────────────────────────────────────────────────────

const pool = new pg.Pool({ connectionString: DB_URL })

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD_PLAIN, 10)
  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    // 1. App entry
    await client.query(
      `INSERT INTO platform_tenants.apps (app_id, display_name, subdomain, jwt_audience)
       VALUES ($1, 'Hulkstein Console', $1, $1)
       ON CONFLICT (app_id) DO NOTHING`,
      [APP_ID],
    )

    // 2. Tenants
    for (const t of TENANTS) {
      await client.query(
        `INSERT INTO platform_tenants.tenants (
           id, app_id, display_name, subdomain, status,
           legal_name, cif, country, plan, stripe_status, custom_domain, contact_email,
           volume_month_cents, tx_month, balance_cents,
           suspend_reason, archived_at
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         ON CONFLICT (id) DO UPDATE SET
           display_name        = EXCLUDED.display_name,
           subdomain           = EXCLUDED.subdomain,
           status              = EXCLUDED.status,
           legal_name          = EXCLUDED.legal_name,
           cif                 = EXCLUDED.cif,
           country             = EXCLUDED.country,
           plan                = EXCLUDED.plan,
           stripe_status       = EXCLUDED.stripe_status,
           custom_domain       = EXCLUDED.custom_domain,
           contact_email       = EXCLUDED.contact_email,
           volume_month_cents  = EXCLUDED.volume_month_cents,
           tx_month            = EXCLUDED.tx_month,
           balance_cents       = EXCLUDED.balance_cents,
           suspend_reason      = EXCLUDED.suspend_reason,
           archived_at         = EXCLUDED.archived_at`,
        [
          t.id, APP_ID, t.displayName, t.subdomain, t.status,
          t.legalName, t.cif, t.country, t.plan, t.stripe, t.customDomain, t.contactEmail,
          t.volMonth, t.txMonth, t.balance,
          t.suspendReason ?? null, t.archivedAt ?? null,
        ],
      )
    }

    // 3. Staff users (platform-level)
    for (const s of STAFF_USERS) {
      await client.query(
        `INSERT INTO platform_auth.users (id, app_id, tenant_id, email, password_hash, role, display_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET
           email         = EXCLUDED.email,
           password_hash = EXCLUDED.password_hash,
           role          = EXCLUDED.role,
           display_name  = EXCLUDED.display_name,
           revoked_at    = NULL`,
        [s.id, PLATFORM_APP, PLATFORM_TENANT, s.email, passwordHash, s.role, s.displayName],
      )
    }

    // 4. Tenant admins
    for (const group of TENANT_ADMINS) {
      for (const u of group.users) {
        await client.query(
          `INSERT INTO platform_auth.users (id, app_id, tenant_id, email, password_hash, role, display_name)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (id) DO UPDATE SET
             email         = EXCLUDED.email,
             password_hash = EXCLUDED.password_hash,
             role          = EXCLUDED.role,
             display_name  = EXCLUDED.display_name,
             revoked_at    = NULL`,
          [u.id, APP_ID, group.tenantId, u.email, passwordHash, u.role, u.displayName],
        )
      }
    }

    // 5. Audit log — wipe and reinsert (idempotent, deterministic order)
    await client.query(
      `DELETE FROM platform_tenants.audit_log WHERE app_id = $1`,
      [APP_ID],
    )
    for (const a of AUDIT_ENTRIES) {
      await client.query(
        `INSERT INTO platform_tenants.audit_log
           (ts, actor_user_id, actor_role, app_id, tenant_id, action, detail, ip)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [a.ts, a.actorUserId, a.actorRole, APP_ID, a.tenantId, a.action, a.detail, a.ip],
      )
    }

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }

  console.log(`\n✓ Seed complete.`)
  console.log(`  App:            ${APP_ID}`)
  console.log(`  Tenants:        ${TENANTS.length}`)
  console.log(`  Staff users:    ${STAFF_USERS.length}  (platform/${PLATFORM_TENANT})`)
  console.log(`  Tenant admins:  ${TENANT_ADMINS.reduce((sum, g) => sum + g.users.length, 0)}`)
  console.log(`  Audit entries:  ${AUDIT_ENTRIES.length}`)
  console.log(`\nLogin with any seeded email + password "${PASSWORD_PLAIN}".`)
  console.log(`  Staff (super_admin):  ana@voragine.local`)
  console.log(`  Tenant owner:         pedro@tiendaana.com  (tenant ${T(1)})\n`)
}

main()
  .then(() => { pool.end(); process.exit(0) })
  .catch((err) => { console.error(err); pool.end(); process.exit(1) })
