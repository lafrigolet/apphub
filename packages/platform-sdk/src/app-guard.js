import fp from 'fastify-plugin'
import { UnauthorizedError, AppMismatchError } from './errors.js'

/**
 * Núcleo del guard como factory: devuelve el preHandler que valida el JWT
 * contra un app_id esperado concreto.
 *
 * Lo consumen dos envoltorios:
 *  - `appGuard` (plugin fastify-plugin, hook GLOBAL) — un proceso, un
 *    EXPECTED_APP_ID. Es lo que usan los monolitos platform-* y los
 *    app-servers en modo standalone.
 *  - `scopedAppGuard(appId)` (plugin SIN fastify-plugin, hook ENCAPSULADO) —
 *    para orquestadores que hospedan varios apps en un proceso (ADR 018,
 *    apps-servers): cada app registra su guard dentro de su propio scope y
 *    un token de aikikan no puede tocar rutas de aulavera.
 */
export function makeAppGuardHook(expectedAppId) {
  if (!expectedAppId) throw new Error('makeAppGuardHook: expectedAppId is required')

  return async (req) => {
    if (req.routeOptions?.config?.public) return
    if (req.url === '/health') return
    if (req.url.startsWith('/internal')) return
    // OpenAPI / Swagger UI is a public artifact (spec + static assets).
    if (req.url === '/docs' || req.url.startsWith('/docs/')) return

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
        // Subtenancy reservada — siempre NULL (colapso a tenant por defecto).
        // Tolerante con tokens legacy que aún la traigan: se ignora.
        subTenantId: null,
        role:       payload.role,
        email:      payload.email,
      }
    } catch (err) {
      if (err instanceof UnauthorizedError || err instanceof AppMismatchError) throw err
      throw new UnauthorizedError('Invalid token')
    }
  }
}

/**
 * Fastify plugin that validates JWT app_id against EXPECTED_APP_ID env var.
 *
 * Platform services set EXPECTED_APP_ID=platform.
 * App-specific services set EXPECTED_APP_ID=aikikan, split-pay, etc.
 *
 * Sets req.identity = { userId, appId, tenantId, subTenantId, role, email }
 */
export const appGuard = fp(async (fastify) => {
  const expectedAppId = process.env.EXPECTED_APP_ID
  if (!expectedAppId) throw new Error('EXPECTED_APP_ID env var is required')

  fastify.decorateRequest('identity', null)

  fastify.addHook('preHandler', makeAppGuardHook(expectedAppId))
})

/**
 * Variante ENCAPSULADA del guard: el hook solo aplica a las rutas
 * registradas dentro del mismo scope (no usa fastify-plugin a propósito).
 * El orquestador debe haber decorado `identity` en el root (o registrar
 * `appGuard` global con EXPECTED_APP_ID=platform NO es equivalente: ese
 * acepta cualquier app_id).
 *
 * Uso (dentro del register() de un app-server hospedado):
 *   await app.register(async (scope) => {
 *     scope.addHook('preHandler', makeAppGuardHook('aikikan'))
 *     await scope.register(routes)
 *   })
 */
export async function ensureIdentityDecorator(fastify) {
  if (!fastify.hasRequestDecorator('identity')) {
    fastify.decorateRequest('identity', null)
  }
}

export function requireRole(...roles) {
  return async (req) => {
    if (!req.identity) throw new UnauthorizedError()
    if (!roles.includes(req.identity.role)) {
      const { ForbiddenError } = await import('./errors.js')
      throw new ForbiddenError(`Requires role: ${roles.join(' or ')}`)
    }
  }
}
