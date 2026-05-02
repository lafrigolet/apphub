import Redis from 'ioredis'
import { env } from '../lib/env.js'
import { logger } from '../lib/logger.js'
import {
  sendWelcomeEmail, sendPasswordResetEmail,
  sendBookingReminderEmail, sendReservationReminderEmail,
  sendPackageExpiryEmail, sendDisputeSlaInternalEmail,
  sendBookingConfirmedEmail, sendBookingCancelledEmail, sendBookingRescheduledEmail,
  sendReservationCreatedEmail, sendReservationCancelledEmail,
  sendPackageExhaustedEmail, sendPayoutPaidEmail,
} from './email.service.js'
import {
  sendBookingReminderSms, sendReservationReminderSms,
  sendBookingConfirmedSms, sendBookingCancelledSms, sendBookingRescheduledSms,
  sendReservationCancelledSms,
} from './sms.service.js'
import { checkRateLimit } from './rate-limit.service.js'
import { shouldDigest, enqueueDigest } from './digest.service.js'

// Rate-limit gate: skip the send when the per-user/hour or per-user/day cap
// is hit. We only check when userId is present — staff/system messages bypass.
async function gated(userId, eventClass, channel, fn) {
  if (userId) {
    const v = await checkRateLimit({ userId, eventClass, channel })
    if (!v.allowed) {
      logger.info({ userId, eventClass, channel, reason: v.reason }, 'notification suppressed by rate-limit')
      return
    }
  }
  await fn()
}

// Email-only digest hook. Returns true when the event was buffered (and the
// caller should NOT send immediately); false when the caller should proceed
// with the immediate send. SMS bypasses the digest by design — text messages
// are usually time-sensitive and digesting them defeats the channel's value.
async function maybeDigestEmail(event, { userId, to, locale }) {
  if (!userId || !to) return false
  if (!(await shouldDigest(event.type))) return false
  await enqueueDigest({ userId, eventType: event.type, payload: event.payload, locale, to })
  return true
}

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
      // Locale is optional on every event payload. Senders default to 'es'
      // when missing, and the template repo falls back to 'es' rows when the
      // requested locale has no row — so an unknown/missing locale never
      // breaks delivery.
      const locale = event.payload?.locale ?? 'es'

      if (event.type === 'user.registered') {
        const { email, appId, userId } = event.payload ?? {}
        if (email) await gated(userId, event.type, 'email', () => sendWelcomeEmail(email, appId, locale))
      }

      if (event.type === 'auth.password_reset_requested') {
        const { email, token, userId } = event.payload ?? {}
        if (email && token) {
          const resetUrl = `${process.env.APP_BASE_URL ?? 'http://aikikan.apphub.local:8080'}/reset-password?token=${token}`
          await gated(userId, event.type, 'email', () => sendPasswordResetEmail(email, resetUrl, locale))
        }
      }

      // ── platform-scheduler events ────────────────────────────────────
      if (event.type === 'booking.reminder.due') {
        const { clientEmail, clientPhone, clientName, clientUserId, startsAt, window } = event.payload ?? {}
        if (clientEmail) await gated(clientUserId, event.type, 'email', () => sendBookingReminderEmail(clientEmail, { name: clientName, startsAt, window, locale }))
        // SMS goes out only when the scheduler hydrated the phone number;
        // the booking module is responsible for including it in the event
        // payload. Stays a noop in dev / when Twilio is not configured.
        if (clientPhone) await gated(clientUserId, event.type, 'sms', () => sendBookingReminderSms(clientPhone, { name: clientName, startsAt, window, locale }))
      }

      if (event.type === 'reservation.reminder.due') {
        const { guestEmail, guestPhone, guestName, guestUserId, reservedFor, partySize, window } = event.payload ?? {}
        if (guestEmail) await gated(guestUserId, event.type, 'email', () => sendReservationReminderEmail(guestEmail, { name: guestName, reservedFor, partySize, window, locale }))
        if (guestPhone) await gated(guestUserId, event.type, 'sms',   () => sendReservationReminderSms(guestPhone, { name: guestName, reservedFor, partySize, window, locale }))
      }

      if (event.type === 'package.expiring') {
        // The scheduler doesn't carry the user's email — clients should hydrate
        // it. For V1 we look it up via auth's user_id → email cache; falling
        // back to a noop if missing. This is a known limitation tracked in TODO.
        const { remainingSessions, expiresAt, window, clientEmail, clientUserId } = event.payload ?? {}
        if (clientEmail) await gated(clientUserId, event.type, 'email', () => sendPackageExpiryEmail(clientEmail, { remainingSessions, expiresAt, window, locale }))
      }

      if (event.type === 'dispute.sla_breached') {
        const staffEmail = process.env.STAFF_OPS_EMAIL
        if (staffEmail) {
          const { disputeId, orderId, openedAt } = event.payload ?? {}
          // Staff dispatch — bypass rate limit (same recipient, low volume).
          await sendDisputeSlaInternalEmail(staffEmail, { disputeId, orderId, openedAt, locale })
        }
      }

      // ── New event subscriptions ──────────────────────────────────────
      if (event.type === 'booking.confirmed' || event.type === 'booking.reminded') {
        const { clientEmail, clientPhone, clientName, clientUserId, startsAt } = event.payload ?? {}
        if (clientEmail && !await maybeDigestEmail(event, { userId: clientUserId, to: clientEmail, locale })) {
          await gated(clientUserId, event.type, 'email', () => sendBookingConfirmedEmail(clientEmail, { name: clientName, startsAt, locale }))
        }
        if (clientPhone) await gated(clientUserId, event.type, 'sms', () => sendBookingConfirmedSms(clientPhone, { startsAt, locale }))
      }

      if (event.type === 'booking.cancelled') {
        const { clientEmail, clientPhone, clientName, clientUserId, startsAt, reason } = event.payload ?? {}
        if (clientEmail && !await maybeDigestEmail(event, { userId: clientUserId, to: clientEmail, locale })) {
          await gated(clientUserId, event.type, 'email', () => sendBookingCancelledEmail(clientEmail, { name: clientName, startsAt, reason, locale }))
        }
        if (clientPhone) await gated(clientUserId, event.type, 'sms', () => sendBookingCancelledSms(clientPhone, { startsAt, locale }))
      }

      if (event.type === 'booking.rescheduled') {
        const { clientEmail, clientPhone, clientName, clientUserId, startsAt } = event.payload ?? {}
        if (clientEmail && !await maybeDigestEmail(event, { userId: clientUserId, to: clientEmail, locale })) {
          await gated(clientUserId, event.type, 'email', () => sendBookingRescheduledEmail(clientEmail, { name: clientName, startsAt, locale }))
        }
        if (clientPhone) await gated(clientUserId, event.type, 'sms', () => sendBookingRescheduledSms(clientPhone, { startsAt, locale }))
      }

      if (event.type === 'reservation.created') {
        const { guestEmail, guestName, guestUserId, reservedFor, partySize } = event.payload ?? {}
        if (guestEmail && !await maybeDigestEmail(event, { userId: guestUserId, to: guestEmail, locale })) {
          await gated(guestUserId, event.type, 'email', () => sendReservationCreatedEmail(guestEmail, { name: guestName, reservedFor, partySize, locale }))
        }
      }

      if (event.type === 'reservation.cancelled') {
        const { guestEmail, guestPhone, guestName, guestUserId, reservedFor } = event.payload ?? {}
        if (guestEmail && !await maybeDigestEmail(event, { userId: guestUserId, to: guestEmail, locale })) {
          await gated(guestUserId, event.type, 'email', () => sendReservationCancelledEmail(guestEmail, { name: guestName, reservedFor, locale }))
        }
        if (guestPhone) await gated(guestUserId, event.type, 'sms', () => sendReservationCancelledSms(guestPhone, { reservedFor, locale }))
      }

      if (event.type === 'package.exhausted') {
        const { clientEmail, clientUserId } = event.payload ?? {}
        if (clientEmail && !await maybeDigestEmail(event, { userId: clientUserId, to: clientEmail, locale })) {
          await gated(clientUserId, event.type, 'email', () => sendPackageExhaustedEmail(clientEmail, { locale }))
        }
      }

      // Internal event published by platform-scheduler at the configured
      // cadence. Drains every per-user digest queue into one composed email
      // each. Idempotent under concurrent firings (renames the queue key
      // before reading).
      if (event.type === 'notifications.digest.flush') {
        const { flushAll } = await import('./digest.service.js')
        const { sendRaw }  = await import('./email.service.js')
        const result = await flushAll({ send: sendRaw, logger })
        logger.info(result, 'digest flushed')
      }

      if (event.type === 'payout.paid') {
        const { practitionerEmail, practitionerUserId, amount, periodLabel, externalRef } = event.payload ?? {}
        if (practitionerEmail && !await maybeDigestEmail(event, { userId: practitionerUserId, to: practitionerEmail, locale })) {
          await gated(practitionerUserId, event.type, 'email', () => sendPayoutPaidEmail(practitionerEmail, { amount, periodLabel, externalRef, locale }))
        }
      }
    } catch (err) {
      logger.error({ err, event }, 'Error handling event')
    }
  })

  sub.on('error', (err) => logger.error({ err }, 'Redis subscriber error'))

  return sub
}
