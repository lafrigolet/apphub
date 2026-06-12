import { logger } from '../lib/logger.js'
import { drenar } from './remision.service.js'

const PATTERN = '*.events'

// Subscriber del tick de remisión publicado por el worker del scheduler
// (verifactu-remision-retry). La lógica pesada (descifrar el cert, firmar, mTLS,
// parsear la respuesta y actualizar la cola) vive aquí, en el módulo, no en el
// scheduler: el scheduler sólo detecta qué tenants tienen trabajo y publica
// `verifactu.remision.due { appId, tenantId, subTenantId }`; nosotros drenamos.
export function startRemisionEventsHandler({ redis }) {
  const sub = redis.duplicate()
  sub.psubscribe(PATTERN, (err) => {
    if (err) { logger.error({ err, pattern: PATTERN }, 'Failed to psubscribe'); return }
    logger.info({ pattern: PATTERN }, 'verifactu subscribed to remision events')
  })

  sub.on('pmessage', async (_pattern, channel, message) => {
    let event
    try { event = JSON.parse(message) } catch { return }
    if (event?.type !== 'verifactu.remision.due') return
    const p = event.payload ?? {}
    if (!p.appId || !p.tenantId) return

    try {
      const res = await drenar({ appId: p.appId, tenantId: p.tenantId, subTenantId: p.subTenantId ?? null })
      if (res.remitidos) logger.info({ tenant: p.tenantId, ...res }, 'verifactu remisión drenada')
    } catch (err) {
      // SIN_CERTIFICADO y demás reglas de negocio no son fallos del handler: el
      // estado ya quedó reflejado en la cola; sólo lo registramos.
      logger.warn({ err: err.message, tenant: p.tenantId, channel }, 'verifactu remisión no completada')
    }
  })

  return sub
}
