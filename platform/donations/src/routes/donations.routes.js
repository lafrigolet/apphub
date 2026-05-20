import { z } from 'zod'
import { requireRole } from '@apphub/platform-sdk/app-guard'
import * as service        from '../services/donations.service.js'
import * as subsService    from '../services/donation-subscriptions.service.js'

const checkoutBody = z.object({
  appId:           z.string().min(1),
  tenantId:        z.string().uuid(),
  subTenantId:     z.string().uuid().optional().nullable(),
  causeId:         z.string().uuid().optional().nullable(),
  amountCents:     z.number().int().min(100),
  currency:        z.string().length(3).default('EUR'),
  donorUserId:     z.string().uuid().optional().nullable(),
  donorEmail:      z.string().email(),
  donorName:       z.string().max(256).optional().nullable(),
  donorNif:        z.string().max(32).optional().nullable(),
  donorAddress:    z.string().max(512).optional().nullable(),
  donorPostalCode: z.string().max(16).optional().nullable(),
  donorCountry:    z.string().length(2).optional().nullable(),
  kind:            z.enum(['one_shot', 'recurring_monthly']),
  anonymous:       z.boolean().optional(),
  message:         z.string().max(500).optional().nullable(),
  successUrl:      z.string().url(),
  cancelUrl:       z.string().url(),
})

const refundBody = z.object({
  reason:         z.enum(['duplicate', 'fraudulent', 'requested_by_customer']).optional(),
  idempotencyKey: z.string().min(1).max(128),
})

const adminListQuery = z.object({
  causeId:  z.string().uuid().optional(),
  status:   z.enum(['pending', 'paid', 'failed', 'refunded']).optional(),
  fromDate: z.string().datetime().optional(),
  toDate:   z.string().datetime().optional(),
  limit:    z.coerce.number().int().min(1).max(500).default(200),
  offset:   z.coerce.number().int().min(0).default(0),
})

// ── Públicas — el formulario de donación dispara aquí. No requiere JWT.
export async function publicRoutes(fastify) {
  fastify.post(
    '/checkout',
    {
      config: { public: true },
      schema: {
        tags:    ['donations'],
        summary: 'Create a donation checkout session (one-shot or recurring)',
        body:    checkoutBody,
      },
    },
    async (req, reply) => {
      const body = checkoutBody.parse(req.body ?? {})
      const auth = req.headers.authorization ?? ''
      const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : null
      const result = await service.createCheckout(body, { bearerToken: bearer })
      reply.code(201)
      return { data: result }
    },
  )
}

// ── Autenticadas — el donante consulta su historial.
export async function authenticatedRoutes(fastify) {
  fastify.get(
    '/me',
    { schema: { tags: ['donations'], summary: 'List my donations' } },
    async (req) => ({ data: await service.listMyDonations(req.identity) }),
  )

  fastify.get(
    '/subscriptions/me',
    { schema: { tags: ['donations'], summary: 'List my recurring donation subscriptions' } },
    async (req) => ({ data: await service.listMySubscriptions(req.identity) }),
  )

  fastify.post(
    '/subscriptions/:id/cancel',
    { schema: { tags: ['donations'], summary: 'Cancel a recurring donation subscription' } },
    async (req) => ({ data: await subsService.cancel(req.identity, req.params.id) }),
  )

  fastify.get(
    '/:id',
    { schema: { tags: ['donations'], summary: 'Get a donation (owner or admin)' } },
    async (req) => ({ data: await service.getDonation(req.identity, req.params.id) }),
  )
}

// ── Admin — gestión global de donaciones del tenant.
export async function adminRoutes(fastify) {
  fastify.addHook('preHandler', requireRole('owner', 'admin', 'staff', 'super_admin'))

  fastify.get(
    '/',
    {
      schema: {
        tags:        ['donations admin'],
        summary:     'List all donations of the tenant (filters)',
        querystring: adminListQuery,
      },
    },
    async (req) => {
      const q = adminListQuery.parse(req.query ?? {})
      return { data: await service.listAdminDonations(req.identity, q) }
    },
  )

  fastify.get(
    '/subscriptions',
    { schema: { tags: ['donations admin'], summary: 'List all recurring subscriptions' } },
    async (req) => ({ data: await subsService.listAdmin(req.identity) }),
  )

  fastify.post(
    '/:id/refund',
    { schema: { tags: ['donations admin'], summary: 'Refund a donation (full)', body: refundBody } },
    async (req) => {
      const body = refundBody.parse(req.body ?? {})
      return { data: await service.refund(req.identity, req.params.id, body) }
    },
  )
}
