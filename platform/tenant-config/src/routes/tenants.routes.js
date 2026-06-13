import { z } from 'zod'
import { requireRole } from '@apphub/platform-sdk/app-guard'
import * as tenantsService from '../services/tenants.service.js'

// All write endpoints require staff. Reads stay open to any authenticated
// user — the portal needs them for the user's own tenant detail.
const writeGuard = requireRole('super_admin', 'staff')

// Validate an IANA timezone against the runtime's tz database. Returns false
// for unknown zones so a bad PATCH payload is rejected at the edge instead of
// silently degrading to UTC downstream.
export function isValidTimezone(tz) {
  if (typeof tz !== 'string' || tz.length === 0) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

const createTenantBody = z.object({
  appId:       z.string().min(1),
  displayName: z.string().min(1).max(128),
  subdomain:   z.string().min(1).max(64),
})

const statusBody = z.object({
  status: z.enum(['active', 'suspended', 'archived']),
  reason: z.string().max(500).optional(),
})

const updateTenantBody = z.object({
  displayName:      z.string().min(1).max(128).optional(),
  legalName:        z.string().max(256).optional(),
  cif:              z.string().max(64).optional(),
  country:          z.string().max(64).optional(),
  contactEmail:     z.string().email().max(256).optional(),
  contactPhone:     z.string().max(64).optional(),
  address:          z.string().max(512).optional(),
  plan:             z.enum(['STARTER', 'PRO', 'ENTERPRISE']).optional(),
  customDomain:     z.string().max(256).optional(),
  stripeStatus:     z.enum(['VERIFIED', 'RESTRICTED', 'PENDING', 'DISCONNECTED']).optional(),
  volumeMonthCents: z.number().int().min(0).optional(),
  txMonth:          z.number().int().min(0).optional(),
  balanceCents:     z.number().int().optional(),
  // Default locale used by platform-scheduler reminder jobs to localize
  // notifications when neither the booking/reservation nor the user carries
  // an explicit locale.
  defaultLocale:    z.string().min(2).max(8).optional(),
  // IANA timezone (e.g. 'Europe/Madrid'). Used by platform-scheduler reminders
  // and availability slot computation to render times in the tenant's local
  // time. Validated against the runtime's tz database via Intl below.
  timezone:         z.string().min(1).max(64).refine(isValidTimezone, {
    message: 'timezone must be a valid IANA zone (e.g. Europe/Madrid)',
  }).optional(),
  // Toggle the new-user approval gate (read by platform/auth). Previously only
  // settable via SQL migration; now manageable by staff via this endpoint.
  requiresUserApproval: z.boolean().optional(),
  // Configuración comercial de la subscripción tenant↔plataforma.
  subscriptionPeriod:            z.enum(['monthly', 'annual']).nullable().optional(),
  subscriptionStatus:            z.enum(['inactive', 'trial', 'active', 'past_due', 'cancelled']).optional(),
  subscriptionAmountCents:       z.number().int().min(0).nullable().optional(),
  subscriptionCurrency:          z.string().length(3).optional(),
  subscriptionStripePriceId:     z.string().max(256).nullable().optional(),
  subscriptionBillingEmail:      z.string().email().max(256).nullable().optional(),
  subscriptionStartedAt:         z.string().datetime().nullable().optional(),
  subscriptionRenewsAt:          z.string().datetime().nullable().optional(),
  subscriptionCancelAtPeriodEnd: z.boolean().optional(),
  subscriptionNotes:             z.string().max(2000).nullable().optional(),
  subscriptionPaymentMethod:     z.enum(['card', 'sepa', 'transfer', 'cash']).nullable().optional(),
})

const subscribeBody = z.object({
  returnUrl: z.string().url(),
})

// #7 Per-tenant override of the app's enabled_modules. `null` clears it.
const modulesOverrideBody = z.object({
  modules: z.array(z.string().min(1).max(64)).max(64).nullable(),
})

function actorFromRequest(req) {
  return {
    userId: req.identity?.userId ?? null,
    role:   req.identity?.role   ?? null,
    ip:     req.ip               ?? null,
  }
}

export async function tenantsRoutes(fastify) {
  // Public tenant directory: used by login pages to let users pick which
  // tenant to authenticate against. Returns only minimal fields.
  fastify.get('/v1/tenants/public', { config: { public: true } }, async (req) => {
    const appId = req.query.appId
    if (!appId) return []
    const tenants = await tenantsService.listTenants(appId)
    return tenants
      .filter((t) => t.status === 'active')
      .map((t) => ({ id: t.id, display_name: t.display_name, subdomain: t.subdomain }))
  })

  fastify.get('/v1/tenants', async (req) => {
    const appId = req.query.appId ?? null
    return tenantsService.listTenants(appId)
  })

  // Public subdomain → tenant lookup. Used by tenant-console-portal to pre-
  // populate the login form with the right app context (so the user knows
  // they are signing into Acme, not the staff console). Returns minimal
  // fields — no PII.
  fastify.get('/v1/tenants/by-subdomain/:subdomain', { config: { public: true } }, async (req) => {
    return tenantsService.getTenantBySubdomain(req.params.subdomain)
  })

  fastify.get('/v1/tenants/:id', async (req) => {
    return tenantsService.getTenant(req.params.id)
  })

  fastify.post('/v1/tenants', { preHandler: writeGuard }, async (req, reply) => {
    const body = createTenantBody.parse(req.body)
    const tenant = await tenantsService.createTenant(body, actorFromRequest(req))
    return reply.status(201).send(tenant)
  })

  fastify.patch('/v1/tenants/:id', { preHandler: writeGuard }, async (req) => {
    const body = updateTenantBody.parse(req.body)
    return tenantsService.updateTenant(req.params.id, body, actorFromRequest(req))
  })

  fastify.patch('/v1/tenants/:id/status', { preHandler: writeGuard }, async (req) => {
    const body = statusBody.parse(req.body)
    return tenantsService.setTenantStatus(req.params.id, body, actorFromRequest(req))
  })

  // Vista comercial de la subscripción del tenant. La consume la
  // tenant-console del owner/admin para mostrar estado actual y decidir
  // si exponer el botón "Suscribirme".
  fastify.get('/v1/tenants/:id/subscription', async (req) => {
    return tenantsService.getTenantSubscription(req.params.id)
  })

  // Inicia el flujo de Stripe Checkout (mode=subscription, no-split) vía
  // platform/splitpay. Sólo el owner/admin del propio tenant. Devuelve
  // la URL para redirigir el navegador.
  fastify.post('/v1/tenants/:id/subscribe', async (req) => {
    const body = subscribeBody.parse(req.body ?? {})
    const auth = req.headers.authorization ?? ''
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : null
    return tenantsService.startSubscriptionCheckout(
      req.params.id, req.identity, bearer, body,
    )
  })

  // Cancela la subscripción a petición del propio tenant (owner/admin) o de
  // staff. Marca cancel_at_period_end si hay sub Stripe activa, o la deja
  // inactive si nunca llegó a activarse. El toggle del backoffice la usa.
  fastify.post('/v1/tenants/:id/unsubscribe', async (req) => {
    return tenantsService.requestUnsubscribe(req.params.id, req.identity)
  })

  // #7 Effective module list for a tenant: its override if set, else the app's.
  // Readable by any authenticated user (the shell needs it to mount modules).
  fastify.get('/v1/tenants/:id/enabled-modules', {
    schema: {
      tags: ['tenants'],
      summary: 'Resolve the effective enabled_modules for a tenant',
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
  }, async (req) => {
    return tenantsService.getTenantEnabledModules(req.params.id)
  })

  // Set or clear (modules: null) the per-tenant override. Staff-only.
  fastify.put('/v1/tenants/:id/enabled-modules', {
    preHandler: writeGuard,
    schema: {
      tags: ['tenants'],
      summary: 'Override (or clear with null) the enabled_modules for one tenant',
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      body: {
        type: 'object',
        properties: { modules: { type: ['array', 'null'], items: { type: 'string' } } },
        required: ['modules'],
      },
    },
  }, async (req) => {
    const { modules } = modulesOverrideBody.parse(req.body)
    return tenantsService.setTenantEnabledModulesOverride(req.params.id, modules, actorFromRequest(req))
  })

  // #5 Issue the DNS TXT challenge the tenant must publish to prove control of
  // its custom domain. Staff-only. Returns the record to publish.
  fastify.post('/v1/tenants/:id/custom-domain/challenge', {
    preHandler: writeGuard,
    schema: {
      tags: ['tenants'],
      summary: 'Issue/rotate the DNS TXT challenge for the tenant custom domain',
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
  }, async (req) => {
    return tenantsService.issueCustomDomainChallenge(req.params.id, actorFromRequest(req))
  })

  // Verify the published TXT record matches the issued token. Staff-only.
  fastify.post('/v1/tenants/:id/custom-domain/verify', {
    preHandler: writeGuard,
    schema: {
      tags: ['tenants'],
      summary: 'Verify the tenant custom domain via its published DNS TXT record',
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
  }, async (req) => {
    return tenantsService.verifyCustomDomain(req.params.id, actorFromRequest(req))
  })
}
