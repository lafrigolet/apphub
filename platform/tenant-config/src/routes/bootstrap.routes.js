import { z } from 'zod'
import { requireRole } from '@apphub/platform-sdk/app-guard'
import * as bootstrapService from '../services/bootstrap.service.js'

const staffOnly = requireRole('super_admin', 'staff')

// Doc §A.2 — formulario único de Fase A. Todas las secciones validadas en
// un solo schema; los campos opcionales se pueden completar después por
// staff vía PATCH /v1/tenants/:id.
const bootstrapBody = z.object({
  app: z.object({
    appId:          z.string().min(1).max(64),
    displayName:    z.string().min(1).max(128),
    subdomain:      z.string().min(1).max(64),
    enabledModules: z.array(z.string().min(1).max(64)).max(32).optional(),
  }),
  tenant: z.object({
    displayName:   z.string().min(1).max(128),
    subdomain:     z.string().min(1).max(64),
    legalName:     z.string().max(256).optional(),
    cif:           z.string().max(64).optional(),
    country:       z.string().max(64).optional(),
    contactEmail:  z.string().email().max(256),
    contactPhone:  z.string().max(64).optional(),
    address:       z.string().max(512).optional(),
    defaultLocale: z.string().min(2).max(8).optional(),
  }),
  owner: z.object({
    email:       z.string().email().max(256),
    displayName: z.string().min(1).max(128),
  }),
  subscription: z.object({
    period:        z.enum(['monthly', 'annual']).optional(),
    amountCents:   z.number().int().min(0).optional(),
    currency:      z.string().length(3).optional(),
    stripePriceId: z.string().max(256).optional(),
    billingEmail:  z.string().email().max(256).optional(),
  }).optional(),
  flags: z.object({
    splitpayEnabled: z.boolean().optional(),
    customDomain:    z.string().max(256).optional(),
  }).optional(),
})

function actorFromRequest(req) {
  return {
    userId: req.identity?.userId ?? null,
    role:   req.identity?.role   ?? null,
    ip:     req.ip               ?? null,
  }
}

export async function bootstrapRoutes(fastify) {
  // Fase A — provisioning atómico (staff-only).
  fastify.post('/v1/tenants/bootstrap', { preHandler: staffOnly, schema: { body: bootstrapBody } }, async (req, reply) => {
    const result = await bootstrapService.bootstrapTenant(req.body, actorFromRequest(req))
    return reply.status(201).send({ data: result })
  })

  // Fase B — derived status, lo consume el panel "Configura tu cuenta"
  // del owner. Cualquier usuario autenticado de ese tenant puede leerlo;
  // staff puede leer el de cualquier tenant.
  fastify.get('/v1/tenants/:id/bootstrap', async (req) => {
    const tenantId = req.params.id
    return { data: await bootstrapService.getBootstrapStatus(tenantId) }
  })

  // Reenvío del magic-link. Sólo staff (super_admin/staff) — el owner aún
  // no puede autenticarse, así que no tendría sentido exponerle esto.
  fastify.post('/v1/tenants/:id/resend-activation', { preHandler: staffOnly }, async (req) => {
    const result = await bootstrapService.resendActivation(req.params.id, actorFromRequest(req))
    return { data: result }
  })
}
