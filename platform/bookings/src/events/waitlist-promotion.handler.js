import { logger } from '../lib/logger.js'
import { subscribe, publish } from '../lib/redis.js'
import { pool, withTenantTransaction } from '../lib/db.js'
import * as repo from '../repositories/bookings.repository.js'

// Cierre del ciclo de waitlist: cuando un slot se libera (una booking se
// cancela o se reprograma a otra ventana), buscamos la entrada `waiting` más
// antigua del mismo servicio/recurso y la promovemos a `notified`, publicando
// `booking.waitlist.notified` para que platform/notifications avise al cliente.
//
// El cliente sigue siendo quien crea la booking real (no auto-reservamos) — el
// alcance de esta recomendación es ofrecer el hueco al primero de la cola. La
// promoción es atómica (promoteOldestWaiting usa FOR UPDATE SKIP LOCKED) para
// que dos eventos concurrentes no ofrezcan el mismo hueco dos veces a la misma
// entrada.
//
// Eventos consumidos:
//   - booking.cancelled  → payload { serviceId, resourceIds, ... }
//   - booking.rescheduled → payload { serviceId, resourceIds, ... }

async function promoteForFreedSlot({ appId, tenantId, serviceId, resourceIds }) {
  if (!appId || !tenantId || !serviceId) return []
  // Si la booking tenía N recursos, intentamos promover por cada recurso
  // liberado. Sin recursos (eventos sin sala), promovemos una entrada genérica
  // del servicio (resourceId undefined → cualquier entrada del servicio).
  const targets = resourceIds?.length ? resourceIds.map((r) => ({ resourceId: r })) : [{ resourceId: undefined }]

  return withTenantTransaction(pool, appId, tenantId, null, async (c) => {
    const promoted = []
    for (const { resourceId } of targets) {
      const entry = await repo.promoteOldestWaiting(c, appId, tenantId, { serviceId, resourceId })
      if (entry) promoted.push(entry)
    }
    return promoted
  })
}

async function handleEvent(evt) {
  const p = evt.payload ?? {}
  const promoted = await promoteForFreedSlot({
    appId: p.appId, tenantId: p.tenantId,
    serviceId: p.serviceId, resourceIds: p.resourceIds,
  })
  for (const entry of promoted) {
    await publish({
      type: 'booking.waitlist.notified',
      payload: {
        appId: p.appId, tenantId: p.tenantId,
        waitlistId: entry.id, serviceId: entry.service_id,
        resourceId: entry.resource_id ?? null,
        clientUserId: entry.client_user_id, clientPhone: entry.client_phone,
        // Pista para el cliente sobre qué evento liberó el hueco.
        freedBy: evt.type,
      },
    })
  }
  if (promoted.length) {
    logger.info({ appId: p.appId, tenantId: p.tenantId, serviceId: p.serviceId, promoted: promoted.length, via: evt.type },
      'waitlist entries promoted on freed slot')
  }
  return promoted.length
}

export function startWaitlistPromotionSubscriber() {
  return subscribe(async (_chan, raw) => {
    let evt
    try { evt = JSON.parse(raw) } catch { return }
    if (evt.type !== 'booking.cancelled' && evt.type !== 'booking.rescheduled') return
    try {
      await handleEvent(evt)
    } catch (err) {
      logger.error({ err, payload: evt.payload }, 'waitlist-promotion handler failed')
    }
  })
}
