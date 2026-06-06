// Subscriber to platform.events. When platform-auth publishes
// `user.revoked`, we delete the matching member row so we don't keep
// stale per-app data after a user is gone. This is the boundary-safe
// alternative to a SQL FK across schemas.
import Redis from 'ioredis'
import { env } from '../lib/env.js'
import { logger } from '../lib/logger.js'
import * as members from '../services/members.service.js'

const CHANNEL = 'platform:events'

export function startUserRevokedSubscriber() {
  // Pub/sub clients can't multiplex with regular commands, so we open a
  // dedicated subscriber connection.
  const sub = new Redis(env.REDIS_URL, { lazyConnect: true })

  sub.connect().catch((err) => {
    logger.error({ err }, 'Failed to connect Redis subscriber')
  })

  sub.on('error', (err) => logger.error({ err }, 'Redis subscriber error'))

  sub.subscribe(CHANNEL, (err) => {
    if (err) {
      logger.error({ err }, `Failed to subscribe to ${CHANNEL}`)
      return
    }
    logger.info(`aikikan-server subscribed to ${CHANNEL}`)
  })

  sub.on('message', async (_channel, message) => {
    let event
    try { event = JSON.parse(message) } catch { return }
    // Limpia el row de app_aikikan.members en dos casos:
    //   - user.revoked         → soft-delete del user (admin revoca)
    //   - auth.signup.rejected → hard-delete (admin rechaza solicitud)
    // En ambos casos el perfil aikikan se elimina para no dejar rows
    // colgantes apuntando a un user.id que ya no existe.
    if (event?.type !== 'user.revoked' && event?.type !== 'auth.signup.rejected') return

    const p = event.payload ?? {}
    if (p.appId !== 'aikikan') return                  // not our app (literal: en apps-servers el env es compartido, ADR 018)
    if (!p.userId || !p.tenantId)         return       // malformed

    try {
      const ok = await members.deleteMember({
        appId:       p.appId,
        tenantId:    p.tenantId,
        subTenantId: p.subTenantId ?? null,
        userId:      p.userId,
      })
      if (ok) logger.info({ userId: p.userId, eventType: event.type }, 'Deleted member')
    } catch (err) {
      logger.error({ err, userId: p.userId, eventType: event.type }, 'Failed to handle event')
    }
  })

  return sub
}
