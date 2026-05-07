import { withTransaction, pool } from '../lib/db.js'
import * as tenantsRepo from '../repositories/tenants.repository.js'
import * as appsRepo from '../repositories/apps.repository.js'
import * as auditRepo from '../repositories/audit.repository.js'
import { AppError, ConflictError, NotFoundError, ForbiddenError } from '@apphub/platform-sdk/errors'

export async function listTenants(appId) {
  return withTransaction(pool, (client) => tenantsRepo.findAll(client, appId))
}

export async function getTenant(id) {
  const tenant = await withTransaction(pool, (client) => tenantsRepo.findById(client, id))
  if (!tenant) throw new NotFoundError('Tenant')
  return tenant
}

export async function createTenant({ appId, displayName, subdomain }, actor) {
  try {
    return await withTransaction(pool, async (client) => {
      const app = await appsRepo.findByAppId(client, appId)
      if (!app) throw new NotFoundError('App')
      const tenant = await tenantsRepo.create(client, { appId, displayName, subdomain })
      await auditRepo.insert(client, {
        actorUserId: actor?.userId ?? null,
        actorRole:   actor?.role   ?? null,
        appId,
        tenantId: tenant.id,
        action:   'TENANT_CREATED',
        detail:   `Tenant "${tenant.display_name}" created with subdomain ${tenant.subdomain}`,
        ip:       actor?.ip ?? null,
      })
      return tenant
    })
  } catch (err) {
    if (err.code === '23505') throw new ConflictError('subdomain already exists')
    if (err.code === '23503') throw new NotFoundError('App')
    throw err
  }
}

export async function setTenantStatus(id, { status, reason }, actor) {
  return withTransaction(pool, async (client) => {
    const tenant = await tenantsRepo.updateStatus(client, id, {
      status,
      suspendReason: status === 'suspended' ? reason ?? null : null,
      archivedAt:    status === 'archived'  ? new Date()     : null,
    })
    if (!tenant) throw new NotFoundError('Tenant')
    const actionByStatus = {
      suspended: 'TENANT_SUSPENDED',
      archived:  'TENANT_ARCHIVED',
      active:    'TENANT_REACTIVATED',
    }
    await auditRepo.insert(client, {
      actorUserId: actor?.userId ?? null,
      actorRole:   actor?.role   ?? null,
      appId:       tenant.app_id,
      tenantId:    tenant.id,
      action:      actionByStatus[status] ?? 'TENANT_STATUS_CHANGED',
      detail:      reason ?? null,
      ip:          actor?.ip ?? null,
    })
    return tenant
  })
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
