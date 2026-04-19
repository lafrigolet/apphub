import cron from 'node-cron'
import { cronPool } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import { logger } from '../lib/logger.js'
import * as bookingRepo from '../repositories/booking.repository.js'

export function startNoShowCron() {
  cron.schedule('*/15 * * * *', async () => {
    const client = await cronPool.connect()
    try {
      const unresolved = await bookingRepo.findFinishedUnreported(client)
      for (const booking of unresolved) {
        await bookingRepo.markNoShow(client, booking.id)
        await publish({
          type: 'no-show.detected',
          payload: {
            bookingId: booking.id,
            userId: booking.user_id,
            sessionId: booking.session_id,
            tenantId: booking.tenant_id,
            subTenantId: booking.sub_tenant_id,
          },
        })
        logger.info({ bookingId: booking.id, tenantId: booking.tenant_id }, 'No-show detected')
      }
    } catch (err) {
      logger.error({ err }, 'No-show cron error')
    } finally {
      client.release()
    }
  })

  logger.info('No-show detection cron started')
}
