import { withTransaction, pool } from '../lib/db.js'
import { redis } from '../lib/redis.js'
import { publish as sdkPublish } from '@apphub/platform-sdk/redis'
import { env } from '../lib/env.js'
import * as appsRepo from '../repositories/apps.repository.js'
import * as tenantsRepo from '../repositories/tenants.repository.js'
import * as auditRepo from '../repositories/audit.repository.js'
import { AppError, ConflictError, NotFoundError } from '@apphub/platform-sdk/errors'
import { writeAppNginxConfig, writeTenantNginxConfig, deleteTenantNginxConfig, deleteAppNginxConfig } from './nginx-config.service.js'
import { logger } from '../lib/logger.js'

const INTERNAL_BASE = env.PLATFORM_CORE_URL

// Construye el magic-link público a partir del subdomain del tenant. En dev
// se servirá vía nginx local; en prod via el dominio público. El portal de
// app (aikikan/split-pay/…) acepta /activate?token=... y POSTea a /v1/auth/activate.
function magicLinkUrl(subdomain, token) {
  // Heurística: si PLATFORM_CORE_URL contiene ".hulkstein.local" estamos en
  // dev/CI; sino asumimos prod (https://). Override explícito si es preciso.
  const isLocal = INTERNAL_BASE.includes('hulkstein.local') || INTERNAL_BASE.includes('localhost')
  if (isLocal) return `http://${subdomain}.hulkstein.local:8080/activate?token=${encodeURIComponent(token)}`
  return `https://${subdomain}.hulkstein.com/activate?token=${encodeURIComponent(token)}`
}

async function callInternal(path, body, method = 'POST') {
  // Sólo enviamos Content-Type cuando hay body — Fastify rechaza
  // peticiones con application/json y body vacío (FST_ERR_CTP_EMPTY_JSON_BODY).
  const init = { method }
  if (body != null) {
    init.headers = { 'Content-Type': 'application/json' }
    init.body    = JSON.stringify(body)
  }
  const res = await fetch(`${INTERNAL_BASE}${path}`, init)
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const code    = json?.error?.code    ?? 'INTERNAL_CALL_FAILED'
    const message = json?.error?.message ?? `Internal call ${path} failed`
    throw new AppError(code, message, res.status)
  }
  return json.data
}

async function publishEvent(event) {
  await sdkPublish(redis, 'platform', event)
}

// Atomicidad: la creación tenant + audit pasa en una transacción local;
// el alta del owner + token se hace después contra auth via /internal.
// Si auth falla compensamos borrando la fila del tenant para que staff
// pueda re-intentar con el mismo subdomain (no tenemos transacciones
// distribuidas — ver doc §A.3).
export async function bootstrapTenant(payload, actor) {
  const {
    app, tenant: tenantInput, owner, subscription = {}, flags = {},
  } = payload

  // Paso 1 — app upsert + tenant insert + audit en tenant-config.
  let appRow, tenantRow, isNewApp = false
  try {
    const result = await withTransaction(pool, async (client) => {
      let appExisting = await appsRepo.findByAppId(client, app.appId)
      if (!appExisting) {
        appExisting = await appsRepo.create(client, {
          appId:           app.appId,
          displayName:     app.displayName,
          subdomain:       app.subdomain,
          jwtAudience:     app.appId,
          splitpayEnabled: !!flags.splitpayEnabled,
        })
        isNewApp = true
        // Persist enabled_modules si vinieron en el payload.
        if (Array.isArray(app.enabledModules) && app.enabledModules.length) {
          appExisting = await appsRepo.updateEnabledModules(client, app.appId, app.enabledModules)
        }
      } else {
        // Colapso a un tenant por defecto (1 app = 1 tenant): un app existente
        // no puede recibir un segundo tenant. La multi-tenancy se reintroduce
        // por app llegado el momento, no aquí.
        const { rows } = await client.query(
          'SELECT COUNT(*)::int AS count FROM platform_tenants.tenants WHERE app_id = $1',
          [app.appId],
        )
        if ((rows[0]?.count ?? 0) > 0) {
          throw new ConflictError('App already provisioned (single-tenant per app)')
        }
      }

      const t = await client.query(
        `INSERT INTO platform_tenants.tenants
           (app_id, display_name, subdomain, status,
            legal_name, cif, country, contact_email, contact_phone, address,
            default_locale, custom_domain,
            subscription_period, subscription_amount_cents, subscription_currency,
            subscription_stripe_price_id, subscription_billing_email,
            bootstrap_started_at)
         VALUES ($1,$2,$3,'active',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, now())
         RETURNING *`,
        [
          app.appId,
          tenantInput.displayName,
          tenantInput.subdomain,
          tenantInput.legalName    ?? null,
          tenantInput.cif          ?? null,
          tenantInput.country      ?? null,
          tenantInput.contactEmail ?? null,
          tenantInput.contactPhone ?? null,
          tenantInput.address      ?? null,
          tenantInput.defaultLocale ?? 'es',
          flags.customDomain        ?? null,
          subscription.period       ?? null,
          subscription.amountCents  ?? null,
          subscription.currency     ?? 'eur',
          subscription.stripePriceId ?? null,
          subscription.billingEmail  ?? null,
        ],
      )
      const tenant = t.rows[0]

      await auditRepo.insert(client, {
        actorUserId: actor?.userId ?? null,
        actorRole:   actor?.role   ?? null,
        appId:       app.appId,
        tenantId:    tenant.id,
        action:      'TENANT_BOOTSTRAPPED',
        detail:      `Bootstrap "${tenant.display_name}" (owner: ${owner.email})`,
        ip:          actor?.ip ?? null,
      })

      return { app: appExisting, tenant }
    })
    appRow    = result.app
    tenantRow = result.tenant
  } catch (err) {
    if (err.code === '23505') throw new ConflictError('subdomain or app_id already exists')
    if (err.code === '23503') throw new NotFoundError('App')
    throw err
  }

  // Paso 2 — crear owner + activation token via /internal/auth/owners.
  // Compensación: si falla, borramos la fila del tenant para que staff
  // pueda re-intentar con el mismo subdomain (mantenemos la fila de app
  // si era pre-existente; si era nueva tampoco la borramos — ya está
  // operativa). Doc §A.3.
  let ownerResult
  try {
    ownerResult = await callInternal('/internal/auth/owners', {
      appId:       app.appId,
      tenantId:    tenantRow.id,
      email:       owner.email,
      displayName: owner.displayName,
    })
  } catch (err) {
    logger.error({ err, tenantId: tenantRow.id }, 'Owner creation failed — rolling back tenant')
    try {
      await withTransaction(pool, async (client) => {
        await client.query('DELETE FROM platform_tenants.tenants WHERE id = $1', [tenantRow.id])
      })
    } catch (compErr) {
      logger.warn({ err: compErr, tenantId: tenantRow.id }, 'Compensation delete failed — manual cleanup may be required')
    }
    throw err
  }

  const link = magicLinkUrl(tenantRow.subdomain, ownerResult.plainToken)

  // Paso 3 — side-effects post-commit: NGINX + evento que dispara email.
  // Errores aquí son no-fatales: el tenant existe, staff puede reenviar.
  if (isNewApp) {
    try { await writeAppNginxConfig({ appId: appRow.app_id, subdomain: appRow.subdomain }) }
    catch (e) { logger.warn({ err: e, appId: appRow.app_id }, 'writeAppNginxConfig failed (non-fatal)') }
  }
  try { await writeTenantNginxConfig({ tenantId: tenantRow.id, subdomain: tenantRow.subdomain }) }
  catch (e) { logger.warn({ err: e, tenantId: tenantRow.id }, 'writeTenantNginxConfig failed (non-fatal)') }

  try {
    await publishEvent({
      type: 'tenant.bootstrap_started',
      payload: {
        tenantId:        tenantRow.id,
        appId:           app.appId,
        appDisplayName:  appRow.display_name,
        tenantDisplayName: tenantRow.display_name,
        ownerEmail:      owner.email,
        ownerDisplayName: owner.displayName,
        magicLinkUrl:    link,
        expiresAt:       ownerResult.expiresAt,
        locale:          tenantInput.defaultLocale ?? 'es',
      },
    })
  } catch (e) {
    logger.warn({ err: e, tenantId: tenantRow.id }, 'tenant.bootstrap_started publish failed — staff can re-trigger')
  }

  // Paso 4 — superadmin inicial de plataforma (colapso a un tenant por
  // defecto): cada app NUEVA arranca con un super_admin que se activa por
  // email (mismo flujo magic-link que el owner). No-fatal y idempotente: si el
  // email ya existe (p.ej. coincide con el owner) auth devuelve 409 y seguimos.
  const superadminEmail = env.PLATFORM_DEFAULT_SUPERADMIN_EMAIL
  if (isNewApp && superadminEmail && superadminEmail !== owner.email) {
    try {
      const sa = await callInternal('/internal/auth/users', {
        appId:       app.appId,
        tenantId:    tenantRow.id,
        email:       superadminEmail,
        displayName: 'Super Admin',
        role:        'super_admin',
      })
      const saLink = magicLinkUrl(tenantRow.subdomain, sa.plainToken)
      await publishEvent({
        type: 'tenant.bootstrap_started',
        payload: {
          tenantId:          tenantRow.id,
          appId:             app.appId,
          appDisplayName:    appRow.display_name,
          tenantDisplayName: tenantRow.display_name,
          ownerEmail:        superadminEmail,
          ownerDisplayName:  'Super Admin',
          magicLinkUrl:      saLink,
          expiresAt:         sa.expiresAt,
          locale:            tenantInput.defaultLocale ?? 'es',
        },
      })
    } catch (e) {
      logger.warn({ err: e, appId: app.appId }, 'initial superadmin provisioning failed (non-fatal)')
    }
  }

  return {
    app:    appRow,
    tenant: tenantRow,
    owner: {
      userId:    ownerResult.userId,
      email:     owner.email,
      // Nunca devolvemos plainToken al cliente — sólo viaja por email.
      // El link va para que staff pueda copiarlo si el email no llega.
      magicLinkUrl: link,
      expiresAt:    ownerResult.expiresAt,
    },
  }
}

// Reenvío del magic-link tras un fallo de email o si caducó. Sólo permitido
// mientras el owner siga `pending_activation = true`.
export async function resendActivation(tenantId, actor) {
  const tenant = await withTransaction(pool, (client) => tenantsRepo.findById(client, tenantId))
  if (!tenant) throw new NotFoundError('Tenant')

  // Localizamos al owner via auth /internal — necesitamos su userId.
  const owner = await callInternal(`/internal/auth/owners/state?tenantId=${tenantId}`, null, 'GET')
  if (!owner) throw new NotFoundError('Owner')
  if (!owner.pending_activation) {
    throw new AppError('ALREADY_ACTIVATED', 'El owner ya activó su cuenta', 409)
  }

  const reissue = await callInternal('/internal/auth/owners/reissue', { userId: owner.id })
  const link = magicLinkUrl(tenant.subdomain, reissue.plainToken)

  await withTransaction(pool, (client) => auditRepo.insert(client, {
    actorUserId: actor?.userId ?? null,
    actorRole:   actor?.role   ?? null,
    appId:       tenant.app_id,
    tenantId:    tenant.id,
    action:      'TENANT_BOOTSTRAP_RESENT',
    detail:      `Magic-link resent to ${owner.email}`,
    ip:          actor?.ip ?? null,
  }))

  await publishEvent({
    type: 'tenant.bootstrap_started',
    payload: {
      tenantId:           tenant.id,
      appId:              tenant.app_id,
      appDisplayName:     null,
      tenantDisplayName:  tenant.display_name,
      ownerEmail:         owner.email,
      ownerDisplayName:   owner.display_name,
      magicLinkUrl:       link,
      expiresAt:          reissue.expiresAt,
      locale:             tenant.default_locale ?? 'es',
      resent:             true,
    },
  }).catch((e) => logger.warn({ err: e }, 'resend publish failed'))

  return { magicLinkUrl: link, expiresAt: reissue.expiresAt }
}

// Lista de tenants en onboarding (pending bootstrap completion). Lo consume
// la vista console > Tenants en onboarding.
export async function listPendingTenants() {
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `SELECT id, app_id, display_name, subdomain, contact_email, default_locale,
              bootstrap_started_at, bootstrap_completed_at, created_at
       FROM platform_tenants.tenants
       WHERE bootstrap_completed_at IS NULL AND bootstrap_started_at IS NOT NULL
       ORDER BY bootstrap_started_at DESC`,
    )
    return rows
  })
}

// Revoca un tenant que aún no ha activado: borra el owner + sus activation_tokens
// (en auth) y la fila en platform_tenants.tenants. La fila de `apps` no se toca
// — pueden quedar otros tenants colgando de ella. Doc §A.6.
export async function revokeBootstrap(tenantId, actor) {
  const tenant = await withTransaction(pool, (client) => tenantsRepo.findById(client, tenantId))
  if (!tenant) throw new NotFoundError('Tenant')
  if (tenant.bootstrap_completed_at) {
    throw new AppError('ALREADY_BOOTSTRAPPED', 'No se puede revocar un tenant ya activado', 409)
  }

  // Comprobamos que el owner siga pending — si activó, paramos aquí.
  const owner = await callInternal(`/internal/auth/owners/state?tenantId=${tenantId}`, null, 'GET')
  if (owner && !owner.pending_activation) {
    throw new AppError('ALREADY_ACTIVATED', 'El owner ya activó — usa archivar en su lugar', 409)
  }

  // Step 1 — borra el owner+tokens via auth /internal.
  await callInternal(`/internal/auth/owners?tenantId=${tenantId}`, null, 'DELETE')

  // Step 2 — audit + delete del tenant. audit_log.tenant_id no tiene FK,
  // así que las filas previas siguen referenciando el id revocado para
  // trazabilidad histórica.
  await withTransaction(pool, async (client) => {
    await auditRepo.insert(client, {
      actorUserId: actor?.userId ?? null,
      actorRole:   actor?.role   ?? null,
      appId:       tenant.app_id,
      tenantId:    tenant.id,
      action:      'TENANT_BOOTSTRAP_REVOKED',
      detail:      `Bootstrap revoked for "${tenant.display_name}"`,
      ip:          actor?.ip ?? null,
    })
    await client.query('DELETE FROM platform_tenants.tenants WHERE id = $1', [tenant.id])
  })

  // Limpiamos el server block en Redis para que el sidecar de nginx lo
  // borre del disco. Sino la siguiente vez que nginx arranque puede fallar
  // si el upstream también ha desaparecido. Best-effort.
  try { await deleteTenantNginxConfig({ subdomain: tenant.subdomain }) }
  catch (e) { logger.warn({ err: e, tenantId: tenant.id }, 'deleteTenantNginxConfig failed (non-fatal)') }

  return { tenantId: tenant.id }
}

// ── Fase B — derived bootstrap status ─────────────────────────────────────
//
// El estado de cada paso se calcula al vuelo desde las tablas que ya
// reflejan la realidad. Sin tabla auxiliar — si el owner edita sus datos
// fuera del flujo, el progreso se actualiza solo. Doc §B.3.

function statusOf({ done, applicable = true }) {
  if (!applicable) return 'not_applicable'
  return done ? 'done' : 'pending'
}

export async function getBootstrapStatus(tenantId) {
  const tenant = await withTransaction(pool, (client) => tenantsRepo.findById(client, tenantId))
  if (!tenant) throw new NotFoundError('Tenant')
  const app = await withTransaction(pool, (client) => appsRepo.findByAppId(client, tenant.app_id))

  // Owner state via auth /internal — passwordSet también señaliza activación.
  let owner = null
  try {
    owner = await callInternal(`/internal/auth/owners/state?tenantId=${tenantId}`, null, 'GET')
  } catch (err) {
    logger.warn({ err, tenantId }, 'Could not load owner state from auth — defaulting to pending')
  }
  let adminCount = 0
  try {
    adminCount = await callInternal(`/internal/auth/admins/count?tenantId=${tenantId}`, null, 'GET') ?? 0
  } catch { /* default 0 */ }

  // Identidad: el doc define done = legal_name + cif + country + address.
  // contact_email lo pide staff en Fase A, así que no lo incluimos aquí —
  // de eso ya está cubierto en el alta del tenant.
  const identityDone =
    !!tenant.legal_name && !!tenant.cif && !!tenant.country && !!tenant.address

  const passwordDone =
    !!owner && !owner.pending_activation && !!owner.password_set

  const subscriptionDone =
    ['active', 'trial'].includes(tenant.subscription_status)

  const splitpayApplicable  = !!app?.splitpay_enabled
  // V1 — derivamos splitpay-connect a partir de stripe_status. Cuando el
  // owner conecte Stripe Connect, splitpay actualizará tenants.stripe_status
  // a 'VERIFIED' vía evento (TODO: wire-up; por ahora done = VERIFIED).
  const splitpayDone = tenant.stripe_status === 'VERIFIED'

  const adminsDone = adminCount >= 1

  // Custom-domain: para V1 sólo comprobamos que esté seteado. La verificación
  // de DNS se persistirá en una columna futura.
  const customDomainDone = !!tenant.custom_domain

  // Modules: app.enabled_modules sirve de proxy — si staff/owner ya seleccionó
  // algún módulo más allá del default, lo damos por hecho.
  const modulesDone = Array.isArray(app?.enabled_modules) && app.enabled_modules.length > 0

  // First-data y email-domains los dejamos pendientes en V1 — se completan
  // automáticamente cuando los módulos correspondientes empiecen a publicar
  // eventos (orders.created, email_domain.verified, …).
  const firstDataDone = false
  const emailDomainsDone = false

  const steps = [
    { key: 'identity',         required: true,                   status: statusOf({ done: identityDone }),                                     doneAt: identityDone ? tenant.bootstrap_started_at : null, cta: identityDone ? null : 'PATCH /v1/tenants/:id' },
    { key: 'password',         required: true,                   status: statusOf({ done: passwordDone }),                                     doneAt: owner?.owner_activated_at ?? null,                  cta: passwordDone ? null : 'POST /v1/auth/activate' },
    { key: 'subscription',     required: true,                   status: statusOf({ done: subscriptionDone }),                                 doneAt: tenant.subscription_started_at ?? null,             cta: subscriptionDone ? null : 'POST /v1/tenants/:id/subscribe' },
    { key: 'splitpay-connect', required: splitpayApplicable,     status: statusOf({ done: splitpayDone, applicable: splitpayApplicable }),     doneAt: null,                                                cta: splitpayDone ? null : (splitpayApplicable ? 'POST /v1/splitpay/connect-accounts' : null) },
    { key: 'admins',           required: false,                  status: statusOf({ done: adminsDone }),                                       doneAt: null,                                                cta: 'POST /v1/auth/register (role=admin)' },
    { key: 'email-domains',    required: false,                  status: statusOf({ done: emailDomainsDone }),                                 doneAt: null,                                                cta: 'POST /v1/notifications/email-domains' },
    { key: 'custom-domain',    required: false,                  status: statusOf({ done: customDomainDone }),                                 doneAt: null,                                                cta: customDomainDone ? null : 'PATCH /v1/tenants/:id (customDomain)' },
    { key: 'modules',          required: false,                  status: statusOf({ done: modulesDone }),                                      doneAt: null,                                                cta: modulesDone ? null : 'PUT /v1/apps/:appId/enabled-modules' },
    { key: 'first-data',       required: false,                  status: statusOf({ done: firstDataDone }),                                    doneAt: null,                                                cta: null },
  ]

  // Auto-marca completed si todos los REQUIRED están en 'done'. Write-once;
  // si después la subscripción se cae, no resetea.
  const allRequiredDone = steps
    .filter((s) => s.required)
    .every((s) => s.status === 'done')

  let completedAt = tenant.bootstrap_completed_at
  if (allRequiredDone && !completedAt) {
    const updated = await withTransaction(pool, (client) => tenantsRepo.markBootstrapCompleted(client, tenantId))
    completedAt = updated?.bootstrap_completed_at ?? new Date().toISOString()
    publishEvent({
      type: 'tenant.bootstrap_completed',
      payload: { tenantId, appId: tenant.app_id, ownerEmail: owner?.email ?? null },
    }).catch((e) => logger.warn({ err: e }, 'tenant.bootstrap_completed publish failed'))
  }

  return {
    tenantId,
    appId:     tenant.app_id,
    startedAt: tenant.bootstrap_started_at,
    completedAt,
    pendingActivation: !!owner?.pending_activation,
    steps,
  }
}

