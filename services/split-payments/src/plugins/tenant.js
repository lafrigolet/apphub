import fp from 'fastify-plugin'
import { UnauthorizedError } from '../utils/errors.js'

export const tenantPlugin = fp(async (fastify) => {
  fastify.decorateRequest('tenant', null)

  fastify.addHook('preHandler', async (req) => {
    // Skip auth for health and webhooks (handled separately)
    if (req.url === '/health' || req.url.startsWith('/v1/webhooks')) {
      return
    }

    // Skip if route not found (Fastify will handle 404)
    if (!req.routeOptions.config?.url) {
      return
    }

    const authHeader = req.headers.authorization

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedError('Missing Authorization header')
    }

    const token = authHeader.slice(7)

    try {
      const payloadB64 = token.split('.')[1]
      if (!payloadB64) throw new Error('Invalid token format')

      const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))

      if (!payload.tenant_id) {
        throw new UnauthorizedError('Token missing tenant_id claim')
      }

      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
        throw new UnauthorizedError('Token expired')
      }

      req.tenant = {
        tenantId: payload.tenant_id,
        subTenantId: payload.sub_tenant_id ?? null,
      }
    } catch (err) {
      if (err instanceof UnauthorizedError) throw err
      throw new UnauthorizedError('Invalid token')
    }
  })
})
