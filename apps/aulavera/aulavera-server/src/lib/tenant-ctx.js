import { ValidationError, UnauthorizedError } from '@apphub/platform-sdk/errors'

// Las rutas públicas (listado de eventos/disciplinas) necesitan saber qué
// tenant servir. Dos vías:
//
//   1) Authorization: Bearer <jwt>  → extraemos `tenant_id` del JWT
//   2) ?tenantId=<uuid>             → query param explícito
//
// appGuard ya decodifica JWTs en rutas no-públicas y deja `req.identity`.
// En públicas se salta — por eso hacemos un parse light aquí sin verificar
// firma (la firma sólo importa para escrituras).
export function tenantFromRequest(req) {
  const auth = req.headers.authorization
  if (auth?.startsWith('Bearer ')) {
    try {
      const payloadB64 = auth.slice(7).split('.')[1]
      if (payloadB64) {
        const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
        if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
          throw new UnauthorizedError('Token expired')
        }
        if (payload.tenant_id) return payload.tenant_id
      }
    } catch (err) {
      if (err instanceof UnauthorizedError) throw err
    }
  }
  const q = req.query?.tenantId
  if (typeof q === 'string' && q.length > 0) return q
  throw new ValidationError('tenantId requerido (vía Bearer token o ?tenantId=<uuid>)')
}
