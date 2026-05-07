import { z } from 'zod'
import { requireRole } from '@apphub/platform-sdk/app-guard'
import * as tenantsService from '../services/tenants.service.js'

// All write endpoints require staff. Reads stay open to any authenticated
// user — the portal needs them for the user's own tenant detail.
const writeGuard = requireRole('super_admin', 'staff')

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
})

const subscribeBody = z.object({
  returnUrl: z.string().url(),
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
}
