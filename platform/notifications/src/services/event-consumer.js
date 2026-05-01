import Redis from 'ioredis'
import { env } from '../lib/env.js'
import { logger } from '../lib/logger.js'
import {
  sendWelcomeEmail, sendPasswordResetEmail,
  sendBookingReminderEmail, sendReservationReminderEmail,
  sendPackageExpiryEmail, sendDisputeSlaInternalEmail,
} from './email.service.js'
import { sendBookingReminderSms } from './sms.service.js'

export function startEventConsumer() {
  const sub = new Redis(env.REDIS_URL)

  sub.ready = new Promise((resolve, reject) => {
    sub.subscribe('platform:events', (err) => {
      if (err) { logger.error({ err }, 'Failed to subscribe to platform:events'); reject(err) }
      else { logger.info('platform-notifications subscribed to platform:events'); resolve() }
    })
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

      // ── platform-scheduler events ────────────────────────────────────
      if (event.type === 'booking.reminder.due') {
        const { clientEmail, clientPhone, clientName, startsAt, window } = event.payload ?? {}
        if (clientEmail) await sendBookingReminderEmail(clientEmail, { name: clientName, startsAt, window })
        // SMS goes out only when the scheduler hydrated the phone number;
        // the booking module is responsible for including it in the event
        // payload. Stays a noop in dev / when Twilio is not configured.
        if (clientPhone) await sendBookingReminderSms(clientPhone, { name: clientName, startsAt, window })
      }

      if (event.type === 'reservation.reminder.due') {
        const { guestEmail, guestName, reservedFor, partySize, window } = event.payload ?? {}
        if (guestEmail) await sendReservationReminderEmail(guestEmail, { name: guestName, reservedFor, partySize, window })
      }

      if (event.type === 'package.expiring') {
        // The scheduler doesn't carry the user's email — clients should hydrate
        // it. For V1 we look it up via auth's user_id → email cache; falling
        // back to a noop if missing. This is a known limitation tracked in TODO.
        const { remainingSessions, expiresAt, window, clientEmail } = event.payload ?? {}
        if (clientEmail) await sendPackageExpiryEmail(clientEmail, { remainingSessions, expiresAt, window })
      }

      if (event.type === 'dispute.sla_breached') {
        const staffEmail = process.env.STAFF_OPS_EMAIL
        if (staffEmail) {
          const { disputeId, orderId, openedAt } = event.payload ?? {}
          await sendDisputeSlaInternalEmail(staffEmail, { disputeId, orderId, openedAt })
        }
      }
    } catch (err) {
      logger.error({ err, event }, 'Error handling event')
    }
  })

  sub.on('error', (err) => logger.error({ err }, 'Redis subscriber error'))

  return sub
}
