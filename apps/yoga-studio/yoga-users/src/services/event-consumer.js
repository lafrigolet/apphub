import Redis from 'ioredis'
import { env } from '../lib/env.js'
import { logger } from '../lib/logger.js'
import { pool, setTenantContext } from '../lib/db.js'
import * as profileRepo from '../repositories/profile.repository.js'

export function startEventConsumer() {
  const sub = new Redis(env.REDIS_URL)

  sub.subscribe('yoga:events', (err) => {
    if (err) logger.error({ err }, 'Failed to subscribe to yoga:events')
    else logger.info('yoga-users subscribed to yoga:events')
  })

  sub.on('message', async (channel, message) => {
    let event
    try {
      event = JSON.parse(message)
    } catch {
      return
    }

    const { tenantId, subTenantId } = event.payload ?? {}
    if (!tenantId) {
      logger.warn({ event }, 'Event missing tenantId, skipping')
      return
    }

    const client = await pool.connect()
    try {
      await setTenantContext(client, tenantId, subTenantId)

      if (event.type === 'user.registered') {
        const { userId, email, role } = event.payload
        await profileRepo.upsertProfile(client, { id: userId, name: email.split('@')[0], email, role, tenantId, subTenantId })
        logger.info({ userId }, 'Profile created from user.registered event')
      }

      if (event.type === 'booking.attended') {
        const { userId, bookingId, className, instructorName, attendedAt } = event.payload
        await profileRepo.addHistory(client, {
          userId, bookingId, className, instructor: instructorName, attendedAt, tenantId, subTenantId,
        })
        logger.info({ userId, bookingId }, 'History updated from booking.attended event')
      }
    } catch (err) {
      logger.error({ err, event }, 'Error handling event in yoga-users')
    } finally {
      client.release()
    }
  })

  sub.on('error', (err) => logger.error({ err }, 'Event consumer Redis error'))
}
