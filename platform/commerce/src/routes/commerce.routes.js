import { z } from 'zod'
import * as service from '../services/commerce.service.js'

const T = ['commerce']

// Scope desde el JWT (appGuard decora req.identity). Endpoints de cliente
// autenticado (la alumna que compra un bono / paga una reserva).
function scopeFrom(req) {
  const id = req.identity
  if (!id) { const e = new Error('No autenticado'); e.statusCode = 401; e.code = 'UNAUTHORIZED'; throw e }
  return { appId: id.appId, tenantId: id.tenantId, subTenantId: id.subTenantId ?? null, userId: id.userId }
}

const crearBody = z.object({
  kind: z.enum(['package', 'booking']),
  refId: z.string().min(1).max(128),
  amountCents: z.number().int().positive(),
  currency: z.string().length(3).optional(),
  clientUserId: z.string().uuid().optional(),
  metadata: z.record(z.any()).optional(),
})
const idParams = z.object({ id: z.string().uuid() })
const linkBody = z.object({ providerTxId: z.string().min(1).max(128) })

export async function commerceRoutes(fastify) {
  // Crea la intención de compra. clientUserId por defecto = usuario del token.
  fastify.post('/v1/commerce/checkouts', { schema: { tags: T, summary: 'Crear checkout (intención de compra)', body: crearBody } },
    async (req, reply) => {
      const scope = scopeFrom(req)
      const b = crearBody.parse(req.body ?? {})
      reply.code(201)
      return service.crearCheckout(scope, { ...b, clientUserId: b.clientUserId ?? scope.userId })
    })

  // Enlaza el transactionId de platform/payments al checkout (lo llama el portal
  // tras crear la sesión de pago).
  fastify.patch('/v1/commerce/checkouts/:id', { schema: { tags: T, summary: 'Enlazar la transacción de pago al checkout', params: idParams, body: linkBody } },
    async (req) => {
      const scope = scopeFrom(req)
      const { id } = idParams.parse(req.params)
      const { providerTxId } = linkBody.parse(req.body ?? {})
      return service.enlazarTx(scope, id, providerTxId)
    })

  // Poll del estado (pending → paid → fulfilled).
  fastify.get('/v1/commerce/checkouts/:id', { schema: { tags: T, summary: 'Estado de un checkout', params: idParams } },
    async (req) => service.getCheckout(scopeFrom(req), idParams.parse(req.params).id))
}
