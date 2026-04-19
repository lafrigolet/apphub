import cron from 'node-cron'
import { cronPool } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import { logger } from '../lib/logger.js'
import * as bonusRepo from '../repositories/bonus.repository.js'

export function startExpiryAlerts() {
  cron.schedule('0 8 * * *', async () => {
    const client = await cronPool.connect()
    try {
      const expiring = await bonusRepo.findExpiringBonuses(client)
      for (const bonus of expiring) {
        await publish({
          type: 'bonus.expiring-soon',
          payload: {
            userId: bonus.user_id,
            bonusId: bonus.id,
            expiresAt: bonus.expires_at,
            tenantId: bonus.tenant_id,
            subTenantId: bonus.sub_tenant_id,
          },
        })
        logger.info({ bonusId: bonus.id, tenantId: bonus.tenant_id }, 'Expiry alert published')
      }
    } catch (err) {
      logger.error({ err }, 'Expiry alert cron error')
    } finally {
      client.release()
    }
  })

  logger.info('Bonus expiry alert cron started')
}
