import fp from 'fastify-plugin'
import { UnauthorizedError, AppMismatchError } from './errors.js'

/**
 * Fastify plugin that validates JWT app_id against EXPECTED_APP_ID env var.
 *
 * Platform services set EXPECTED_APP_ID=platform.
 * App-specific services set EXPECTED_APP_ID=yoga-studio, split-pay, etc.
 *
 * Sets req.identity = { userId, appId, tenantId, subTenantId, role, email }
 */
export const appGuard = fp(async (fastify) => {
  const expectedAppId = process.env.EXPECTED_APP_ID
  if (!expectedAppId) throw new Error('EXPECTED_APP_ID env var is required')

  fastify.decorateRequest('identity', null)

  fastify.addHook('preHandler', async (req) => {
    if (req.routeOptions?.config?.public) return
    if (req.url === '/health') return
    if (req.url.startsWith('/internal')) return

    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) throw new UnauthorizedError('Missing Authorization header')

    const token = authHeader.slice(7)
    try {
      const payloadB64 = token.split('.')[1]
      if (!payloadB64) throw new Error('Invalid token format')
      const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))

      if (!payload.sub)       throw new UnauthorizedError('Token missing sub claim')
      if (!payload.app_id)    throw new UnauthorizedError('Token missing app_id claim')
      if (!payload.tenant_id) throw new UnauthorizedError('Token missing tenant_id claim')
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) throw new UnauthorizedError('Token expired')

      if (payload.app_id !== expectedAppId && expectedAppId !== 'platform') {
        throw new AppMismatchError()
      }

      req.identity = {
        userId:     payload.sub,
        appId:      payload.app_id,
        tenantId:   payload.tenant_id,
        subTenantId: payload.sub_tenant_id ?? null,
        role:       payload.role,
        email:      payload.email,
      }
    } catch (err) {
      if (err instanceof UnauthorizedError || err instanceof AppMismatchError) throw err
      throw new UnauthorizedError('Invalid token')
    }
  })
})

export function requireRole(...roles) {
  return async (req) => {
    if (!req.identity) throw new UnauthorizedError()
    if (!roles.includes(req.identity.role)) {
      const { ForbiddenError } = await import('./errors.js')
      throw new ForbiddenError(`Requires role: ${roles.join(' or ')}`)
    }
  }
}
