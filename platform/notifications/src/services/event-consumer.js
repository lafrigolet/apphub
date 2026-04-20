import Redis from 'ioredis'
import { env } from '../lib/env.js'
import { logger } from '../lib/logger.js'
import { sendWelcomeEmail, sendPasswordResetEmail } from './email.service.js'

export function startEventConsumer() {
  const sub = new Redis(env.REDIS_URL)

  sub.subscribe('platform:events', (err) => {
    if (err) logger.error({ err }, 'Failed to subscribe to platform:events')
    else logger.info('platform-notifications subscribed to platform:events')
  })

  sub.on('message', async (_channel, message) => {
    let event
    try {
      event = JSON.parse(message)
    } catch {
      return
    }

    try {
      if (event.type === 'user.registered') {
        const { email, appId } = event.payload ?? {}
        if (email) await sendWelcomeEmail(email, appId)
      }

      if (event.type === 'auth.password_reset_requested') {
        const { email, token } = event.payload ?? {}
        if (email && token) {
          const resetUrl = `${process.env.APP_BASE_URL ?? 'http://aikikan.apphub.local:8080'}/reset-password?token=${token}`
          await sendPasswordResetEmail(email, resetUrl)
        }
      }
    } catch (err) {
      logger.error({ err, event }, 'Error handling event')
    }
  })

  sub.on('error', (err) => logger.error({ err }, 'Redis subscriber error'))

  return sub
}
