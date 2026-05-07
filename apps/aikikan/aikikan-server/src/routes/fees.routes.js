import { z } from 'zod'
import * as service from '../services/fees.service.js'

const checkoutBody = z.object({
  codes:      z.array(z.string().min(1)).min(1).max(5),
  returnPath: z.string().optional(),
})

const setPriceBody = z.object({
  stripePriceId: z.string().min(1),
})

export async function feesRoutes(fastify) {
  // Public — el catálogo lo ve cualquiera (visitor).
  fastify.get('/v1/aikikan/fees/products', { config: { public: true } }, async () => {
    return service.listProducts()
  })

  // Estado y historial del usuario autenticado.
  fastify.get('/v1/aikikan/fees/me', async (req) => {
    return service.getMyFees(req.identity)
  })

  // Crea Stripe Checkout Session vía splitpay y devuelve la URL.
  // El JWT del usuario se reenvía a splitpay para que cumpla appGuard.
  fastify.post('/v1/aikikan/fees/checkout', async (req) => {
    const body = checkoutBody.parse(req.body ?? {})
    const auth = req.headers.authorization ?? ''
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : null
    return service.createCheckout(req.identity, bearer, body)
  })

  // Admin: configurar el stripe_price_id de un producto (necesario tras
  // crear los Prices en el dashboard de Stripe).
  fastify.patch('/v1/aikikan/fees/products/:code/stripe-price', async (req) => {
    const { stripePriceId } = setPriceBody.parse(req.body ?? {})
    return service.setProductStripePriceId(req.identity, req.params.code, stripePriceId)
  })
}
