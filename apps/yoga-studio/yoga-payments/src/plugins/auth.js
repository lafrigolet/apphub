import fp from 'fastify-plugin'
import { UnauthorizedError, ForbiddenError } from '../utils/errors.js'

export const authPlugin = fp(async (fastify) => {
  fastify.decorateRequest('user', null)

  fastify.addHook('preHandler', async (req) => {
    // Public routes skip auth
    if (req.url === '/health' || req.url.startsWith('/internal')) return
    if (req.routeOptions?.config?.public) return

    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) throw new UnauthorizedError('Missing Authorization header')

    const token = authHeader.slice(7)
    try {
      const payloadB64 = token.split('.')[1]
      if (!payloadB64) throw new Error('Invalid token format')
      const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
      if (!payload.sub) throw new UnauthorizedError('Token missing sub claim')
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) throw new UnauthorizedError('Token expired')
      if (!payload.tenant_id) throw new UnauthorizedError('Token missing tenant_id claim')
      req.user = {
        userId: payload.sub,
        role: payload.role,
        email: payload.email,
        tenantId: payload.tenant_id,
        subTenantId: payload.sub_tenant_id ?? null,
      }
    } catch (err) {
      if (err instanceof UnauthorizedError) throw err
      throw new UnauthorizedError('Invalid token')
    }
  })
})

export function requireRole(...roles) {
  return async (req) => {
    if (!req.user) throw new UnauthorizedError()
    if (!roles.includes(req.user.role)) throw new ForbiddenError(`Requires role: ${roles.join(' or ')}`)
  }
}
