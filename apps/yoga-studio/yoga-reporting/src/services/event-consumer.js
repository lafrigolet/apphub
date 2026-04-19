import Redis from 'ioredis'
import { env } from '../lib/env.js'
import { logger } from '../lib/logger.js'
import { pool, setTenantContext } from '../lib/db.js'
import * as reportRepo from '../repositories/reporting.repository.js'

export function startEventConsumer() {
  const sub = new Redis(env.REDIS_URL)

  sub.subscribe('yoga:events', (err) => {
    if (err) logger.error({ err }, 'Failed to subscribe to yoga:events')
    else logger.info('yoga-reporting subscribed to yoga:events')
  })

  sub.on('message', async (channel, message) => {
    let event
    try { event = JSON.parse(message) } catch { return }

    const { tenantId, subTenantId } = event.payload ?? {}
    if (!tenantId) {
      logger.warn({ event }, 'Event missing tenantId, skipping')
      return
    }

    const today = new Date().toISOString().slice(0, 10)
    const client = await pool.connect()
    try {
      await setTenantContext(client, tenantId, subTenantId)

      if (event.type === 'booking.created') {
        await reportRepo.upsertDailyMetric(client, tenantId, today, 'total_bookings')
      }
      if (event.type === 'booking.cancelled') {
        await reportRepo.upsertDailyMetric(client, tenantId, today, 'total_bookings', -1)
      }
      if (event.type === 'booking.attended') {
        await reportRepo.upsertDailyMetric(client, tenantId, today, 'total_attended')
      }
      if (event.type === 'no-show.detected') {
        await reportRepo.upsertDailyMetric(client, tenantId, today, 'total_no_show')
      }
    } catch (err) {
      logger.error({ err, event }, 'Error handling event in yoga-reporting')
    } finally {
      client.release()
    }
  })

  sub.on('error', (err) => logger.error({ err }, 'Event consumer Redis error'))
}
