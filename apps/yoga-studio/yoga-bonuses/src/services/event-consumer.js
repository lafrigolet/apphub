import Redis from 'ioredis'
import { v4 as uuidv4 } from 'uuid'
import { env } from '../lib/env.js'
import { logger } from '../lib/logger.js'
import { withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as bonusRepo from '../repositories/bonus.repository.js'

export function startEventConsumer() {
  const sub = new Redis(env.REDIS_URL)

  sub.subscribe('yoga:events', (err) => {
    if (err) logger.error({ err }, 'Failed to subscribe to yoga:events')
    else logger.info('yoga-bonuses subscribed to yoga:events')
  })

  sub.on('message', async (channel, message) => {
    let event
    try { event = JSON.parse(message) } catch { return }

    const { tenantId, subTenantId } = event.payload ?? {}
    if (!tenantId) {
      logger.warn({ event }, 'Event missing tenantId, skipping')
      return
    }

    try {
      if (event.type === 'payment.completed') {
        const { userId, bonusTypeId } = event.payload
        const bonus = await withTenantTransaction(tenantId, subTenantId, async (client) => {
          return bonusRepo.activateBonusByPayment(client, { id: uuidv4(), userId, bonusTypeId, tenantId, subTenantId })
        })
        if (bonus) {
          logger.info({ userId, bonusId: bonus.id }, 'Bonus activated from payment')
        }
      }

      if (event.type === 'booking.cancelled') {
        const { userId } = event.payload
        await withTenantTransaction(tenantId, subTenantId, async (client) => {
          await bonusRepo.returnCredit(client, userId, tenantId)
        })
        logger.info({ userId }, 'Credit returned from cancellation')
      }

      if (event.type === 'no-show.detected') {
        const { userId } = event.payload
        logger.info({ userId }, 'No-show processed — no credit refund')
      }
    } catch (err) {
      logger.error({ err, event }, 'Error handling event in yoga-bonuses')
    }
  })

  sub.on('error', (err) => logger.error({ err }, 'Event consumer Redis error'))
}
