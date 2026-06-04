import { randomBytes } from 'node:crypto'
import { resolveTxt } from 'node:dns/promises'
import { withTransaction, pool } from '../lib/db.js'
import { publish as publishEvent } from '../lib/redis.js'
import * as tenantsRepo from '../repositories/tenants.repository.js'
import * as appsRepo from '../repositories/apps.repository.js'
import * as auditRepo from '../repositories/audit.repository.js'
import { AppError, ConflictError, NotFoundError, ForbiddenError } from '@apphub/platform-sdk/errors'
import { writeTenantNginxConfig, deleteTenantNginxConfig } from './nginx-config.service.js'
import { logger } from '../lib/logger.js'

// Best-effort domain-event emission to `platform.events`. Other modules
// (auth, notifications, scheduler) consume these to block access, clean up
// resources or react to lifecycle changes. Publishing is non-fatal: the DB
// row is already committed, so a Redis outage only delays downstream reaction.
async function emit(type, payload) {
  try {
    await publishEvent({ type, payload })
  } catch (err) {
    logger.warn({ err, type }, `${type} publish failed (non-fatal)`)
  }
}

export async function listTenants(appId) {
  return withTransaction(pool, (client) => tenantsRepo.findAll(client, appId))
}

export async function getTenant(id) {
  const tenant = await withTransaction(pool, (client) => tenantsRepo.findById(client, id))
  if (!tenant) throw new NotFoundError('Tenant')
  return tenant
}

export async function createTenant({ appId, displayName, subdomain }, actor) {
  let tenant
  try {
    tenant = await withTransaction(pool, async (client) => {
      const app = await appsRepo.findByAppId(client, appId)
      if (!app) throw new NotFoundError('App')
      const t = await tenantsRepo.create(client, { appId, displayName, subdomain })
      await auditRepo.insert(client, {
        actorUserId: actor?.userId ?? null,
        actorRole:   actor?.role   ?? null,
        appId,
        tenantId: t.id,
        action:   'TENANT_CREATED',
        detail:   `Tenant "${t.display_name}" created with subdomain ${t.subdomain}`,
        ip:       actor?.ip ?? null,
      })
      return t
    })
  } catch (err) {
    if (err.code === '23505') throw new ConflictError('subdomain already exists')
    if (err.code === '23503') throw new NotFoundError('App')
    throw err
  }

  // Best-effort NGINX provisioning. The tenant row is committed; if Redis is
  // down the operator can re-run the backfill (`backfillTenantNginxConfigs`
  // on next platform-core boot) without losing data.
  try {
    await writeTenantNginxConfig({ tenantId: tenant.id, subdomain: tenant.subdomain })
  } catch (err) {
    logger.warn({ err, tenantId: tenant.id }, 'Failed to publish tenant NGINX conf — tenant created but routing not provisioned')
  }

  // Explicit domain event for tenants created outside the bootstrap wizard.
  // leads (conversion tracking), notifications and others react to this.
  await emit('tenant.created', {
    tenantId:    tenant.id,
    appId,
    displayName: tenant.display_name,
    subdomain:   tenant.subdomain,
  })
  return tenant
}

/**
 * Backfill: re-publish NGINX server blocks for every active tenant. Run
 * on platform-core boot so a fresh Redis (or one cleared during ops) ends
 * up with the right map without manual intervention. Idempotent.
 */
export async function backfillTenantNginxConfigs() {
  const tenants = await withTransaction(pool, (client) => tenantsRepo.findAllActive(client))
  let count = 0
  for (const t of tenants) {
    if (!t.subdomain) continue
    try {
      await writeTenantNginxConfig({ tenantId: t.id, subdomain: t.subdomain })
      count++
    } catch (err) {
      logger.warn({ err, tenantId: t.id }, 'backfill: failed to write tenant NGINX conf')
    }
  }
  logger.info({ count }, 'NGINX tenant configs backfilled')
  return count
}

/**
 * Public lookup: subdomain → { tenantId, appId }. The tenant-console-portal
 * uses this to derive the app context from the Host header before login,
 * so the LoginView can warn the user if their JWT belongs to a different
 * tenant than the subdomain they're visiting.
 */
export async function getTenantBySubdomain(subdomain) {
  const tenant = await withTransaction(pool, (client) => tenantsRepo.findBySubdomain(client, subdomain))
  if (!tenant) throw new NotFoundError('Tenant')
  return { tenantId: tenant.id, appId: tenant.app_id, displayName: tenant.display_name, status: tenant.status }
}

export async function setTenantStatus(id, { status, reason }, actor) {
  const tenant = await withTransaction(pool, async (client) => {
    const t = await tenantsRepo.updateStatus(client, id, {
      status,
      suspendReason: status === 'suspended' ? reason ?? null : null,
      archivedAt:    status === 'archived'  ? new Date()     : null,
    })
    if (!t) throw new NotFoundError('Tenant')
    const actionByStatus = {
      suspended: 'TENANT_SUSPENDED',
      archived:  'TENANT_ARCHIVED',
      active:    'TENANT_REACTIVATED',
    }
    await auditRepo.insert(client, {
      actorUserId: actor?.userId ?? null,
      actorRole:   actor?.role   ?? null,
      appId:       t.app_id,
      tenantId:    t.id,
      action:      actionByStatus[status] ?? 'TENANT_STATUS_CHANGED',
      detail:      reason ?? null,
      ip:          actor?.ip ?? null,
    })
    return t
  })

  // Lifecycle events for cross-module reaction (auth → revoke sessions,
  // scheduler → pause jobs, notifications → notify owner). Emitted after the
  // status row + audit entry are committed.
  const eventByStatus = {
    suspended: 'tenant.suspended',
    archived:  'tenant.archived',
    active:    'tenant.reactivated',
  }
  const eventType = eventByStatus[status]
  if (eventType) {
    await emit(eventType, {
      tenantId: tenant.id,
      appId:    tenant.app_id,
      status,
      reason:   status === 'suspended' ? reason ?? null : null,
    })
  }
  return tenant
}

// Vista pública de la subscripción del tenant (la consume la tenant-console
// del owner). NO devuelve `subscription_stripe_price_id` directamente —
// solo un boolean `configured` para que la UI sepa si hay plan listo.
export async function getTenantSubscription(id) {
  const tenant = await getTenant(id)
  return {
    tenantId:                 tenant.id,
    appId:                    tenant.app_id,
    displayName:              tenant.display_name,
    period:                   tenant.subscription_period,
    status:                   tenant.subscription_status,
    amountCents:              tenant.subscription_amount_cents,
    currency:                 tenant.subscription_currency,
    billingEmail:             tenant.subscription_billing_email,
    startedAt:                tenant.subscription_started_at,
    renewsAt:                 tenant.subscription_renews_at,
    cancelAtPeriodEnd:        tenant.subscription_cancel_at_period_end,
    notes:                    tenant.subscription_notes,
    priceConfigured:          !!tenant.subscription_stripe_price_id,
    stripeSubscriptionLinked: !!tenant.subscription_stripe_subscription_id,
  }
}

// Inicia el flujo de Checkout Stripe vía splitpay (mode=subscription,
// no-split). El JWT del usuario se reenvía a splitpay para que cumpla
// appGuard. metadata.kind='platform_subscription' permite a splitpay
// emitir también en `platform.events` para que el subscriber de
// tenant-config actualice el estado.
export async function startSubscriptionCheckout(id, identity, bearerToken, { returnUrl }) {
  const tenant = await getTenant(id)

  // Sólo owner/admin del propio tenant pueden iniciarlo (staff puede
  // editar la configuración via PATCH pero no inicia el flujo en nombre
  // del tenant — eso lo abre el propio tenant).
  if (identity?.tenantId !== id) {
    throw new ForbiddenError('No puedes iniciar la subscripción de otro tenant')
  }
  if (!['owner', 'admin'].includes(identity.role)) {
    throw new ForbiddenError('Sólo owner o admin del tenant pueden suscribir')
  }

  if (!tenant.subscription_stripe_price_id) {
    throw new AppError(
      'SUBSCRIPTION_NOT_CONFIGURED',
      'El staff aún no ha configurado un Stripe price_id para esta subscripción',
      409,
    )
  }

  const splitpayUrl = (process.env.SPLITPAY_BASE_URL ?? 'http://platform-core:3000') + '/v1/splitpay/checkout-sessions'
  const payload = {
    mode: 'subscription',
    currency: (tenant.subscription_currency ?? 'eur').toLowerCase(),
    customerEmail: tenant.subscription_billing_email ?? identity.email,
    lineItems: [{ price: tenant.subscription_stripe_price_id, quantity: 1 }],
    successUrl: `${returnUrl}?subscription_status=success&session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl:  `${returnUrl}?subscription_status=cancel`,
    // splitRuleId omitido → no-split: todo va a la cuenta plataforma.
    metadata: {
      kind:      'platform_subscription',
      tenant_id: id,
    },
  }

  let res
  try {
    res = await fetch(splitpayUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bearerToken}`,
      },
      body: JSON.stringify(payload),
    })
  } catch (err) {
    throw new AppError('SPLITPAY_UNREACHABLE', 'No se pudo contactar el servicio de pagos', 502)
  }
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new AppError(
      json?.error?.code ?? 'SPLITPAY_ERROR',
      json?.error?.message ?? 'Error creando la sesión de subscripción',
      res.status,
    )
  }
  const { url, stripeSessionId } = json.data ?? {}
  if (!url || !stripeSessionId) {
    throw new AppError('SPLITPAY_INVALID_RESPONSE', 'Respuesta inesperada de splitpay', 502)
  }
  return { url, sessionId: stripeSessionId }
}

export async function updateTenant(id, fields, actor) {
  return withTransaction(pool, async (client) => {
    const tenant = await tenantsRepo.update(client, id, fields)
    if (!tenant) throw new NotFoundError('Tenant')
    const changedKeys = Object.keys(fields).filter((k) => fields[k] !== undefined)
    await auditRepo.insert(client, {
      actorUserId: actor?.userId ?? null,
      actorRole:   actor?.role   ?? null,
      appId:       tenant.app_id,
      tenantId:    tenant.id,
      action:      'TENANT_UPDATED',
      detail:      `Updated: ${changedKeys.join(', ')}`,
      ip:          actor?.ip ?? null,
    })
    return tenant
  })
}

// ── #7 Per-tenant feature flags ──────────────────────────────────────────────
// Resolve the effective module list for a tenant: its explicit override if set,
// else the parent app's enabled_modules. Lets staff differentiate plans without
// touching the app-wide array for every tenant.
export async function getTenantEnabledModules(id) {
  return withTransaction(pool, async (client) => {
    const tenant = await tenantsRepo.findById(client, id)
    if (!tenant) throw new NotFoundError('Tenant')
    const override = tenant.enabled_modules_override
    if (override) {
      return { tenantId: tenant.id, appId: tenant.app_id, source: 'tenant', modules: override }
    }
    const app = await appsRepo.findByAppId(client, tenant.app_id)
    return {
      tenantId: tenant.id,
      appId:    tenant.app_id,
      source:   'app',
      modules:  app?.enabled_modules ?? [],
    }
  })
}

// Set (or clear, with null) the per-tenant override. Emits tenant.config.updated
// so the shell can re-resolve which modules to mount.
export async function setTenantEnabledModulesOverride(id, modules, actor) {
  const tenant = await withTransaction(pool, async (client) => {
    const t = await tenantsRepo.setEnabledModulesOverride(client, id, modules)
    if (!t) throw new NotFoundError('Tenant')
    await auditRepo.insert(client, {
      actorUserId: actor?.userId ?? null,
      actorRole:   actor?.role   ?? null,
      appId:       t.app_id,
      tenantId:    t.id,
      action:      'TENANT_MODULES_OVERRIDE_SET',
      detail:      modules === null ? 'cleared (inherits app)' : `[${modules.join(', ')}]`,
      ip:          actor?.ip ?? null,
    })
    return t
  })
  await emit('tenant.config.updated', {
    tenantId: tenant.id,
    appId:    tenant.app_id,
    change:   'enabled_modules_override',
  })
  return tenant
}

// ── #5 Custom-domain DNS verification ────────────────────────────────────────
// The TXT record the tenant must publish at _apphub-challenge.<domain> to prove
// control. Kept in one place so issue + verify agree on the host/value format.
export const DNS_CHALLENGE_PREFIX = '_apphub-challenge'

function challengeHost(domain) {
  return `${DNS_CHALLENGE_PREFIX}.${domain}`
}

// Issue (or rotate) the DNS challenge token. Resets verified state so a stale
// "verified" flag can't survive a domain change. Returns the record the tenant
// must publish.
export async function issueCustomDomainChallenge(id, actor) {
  const tenant = await getTenant(id)
  if (!tenant.custom_domain) {
    throw new AppError('CUSTOM_DOMAIN_NOT_SET', 'El tenant no tiene custom_domain configurado', 409)
  }
  const token = `apphub-verify=${randomBytes(16).toString('hex')}`
  const updated = await withTransaction(pool, async (client) => {
    const t = await tenantsRepo.setCustomDomainVerifyToken(client, id, token)
    await auditRepo.insert(client, {
      actorUserId: actor?.userId ?? null,
      actorRole:   actor?.role   ?? null,
      appId:       t.app_id,
      tenantId:    t.id,
      action:      'CUSTOM_DOMAIN_CHALLENGE_ISSUED',
      detail:      tenant.custom_domain,
      ip:          actor?.ip ?? null,
    })
    return t
  })
  return {
    tenantId:    updated.id,
    customDomain: updated.custom_domain,
    recordType:  'TXT',
    recordHost:  challengeHost(updated.custom_domain),
    recordValue: token,
    verified:    false,
  }
}

// Resolve the TXT record and check it contains the issued token. On success
// marks the domain verified + emits an event. Pure DNS lookup — no external
// service. Network/lookup failures surface as 422 so the tenant can retry.
export async function verifyCustomDomain(id, actor, { resolver = resolveTxt } = {}) {
  const tenant = await getTenant(id)
  if (!tenant.custom_domain) {
    throw new AppError('CUSTOM_DOMAIN_NOT_SET', 'El tenant no tiene custom_domain configurado', 409)
  }
  if (!tenant.custom_domain_verify_token) {
    throw new AppError('CHALLENGE_NOT_ISSUED', 'Emite primero el challenge DNS', 409)
  }

  let records
  try {
    records = await resolver(challengeHost(tenant.custom_domain))
  } catch (err) {
    throw new AppError('DNS_LOOKUP_FAILED', `No se pudo resolver el TXT record: ${err.code ?? err.message}`, 422)
  }
  // resolveTxt returns string[][] (each record is an array of chunks).
  const flattened = (records ?? []).map((chunks) => Array.isArray(chunks) ? chunks.join('') : String(chunks))
  const match = flattened.includes(tenant.custom_domain_verify_token)
  if (!match) {
    throw new AppError('DNS_RECORD_MISMATCH', 'El TXT record no coincide con el token emitido', 422)
  }

  const updated = await withTransaction(pool, async (client) => {
    const t = await tenantsRepo.markCustomDomainVerified(client, id)
    await auditRepo.insert(client, {
      actorUserId: actor?.userId ?? null,
      actorRole:   actor?.role   ?? null,
      appId:       t.app_id,
      tenantId:    t.id,
      action:      'CUSTOM_DOMAIN_VERIFIED',
      detail:      t.custom_domain,
      ip:          actor?.ip ?? null,
    })
    return t
  })
  // NGINX server-block render with the custom domain is cross-cutting (nginx
  // sidecar); we only flip the verified state + announce it here.
  await emit('tenant.config.updated', {
    tenantId: updated.id,
    appId:    updated.app_id,
    change:   'custom_domain_verified',
  })
  return {
    tenantId:     updated.id,
    customDomain: updated.custom_domain,
    verified:     true,
    verifiedAt:   updated.custom_domain_verified_at,
  }
}
