import Redis from 'ioredis'
import { v4 as uuidv4 } from 'uuid'
import { env } from '../lib/env.js'
import { logger } from '../lib/logger.js'
import { pool, setTenantContext } from '../lib/db.js'
import { sendEmail } from './mailer.js'

const TEMPLATES = {
  'user.registered': (p) => ({
    subject: 'Welcome to Yoga Studio!',
    text: `Hi! Your account has been created. Email: ${p.email}`,
  }),
  'booking.created': (p) => ({
    subject: 'Booking Confirmed',
    text: `Your booking for session ${p.sessionId} has been confirmed.`,
  }),
  'booking.cancelled': (p) => ({
    subject: 'Booking Cancelled',
    text: `Your booking ${p.bookingId} has been cancelled.`,
  }),
  'waitinglist.spot.available': (p) => ({
    subject: 'A spot is available!',
    text: `A spot opened up in your waitlisted session. You have 30 minutes to confirm.`,
  }),
  'bonus.expiring-soon': (p) => ({
    subject: 'Your bonus is expiring soon',
    text: `Your yoga bonus expires on ${new Date(p.expiresAt).toLocaleDateString()}. Book your classes!`,
  }),
  'class.cancelled': (p) => ({
    subject: 'Class Cancelled',
    text: `The class (session ${p.classId}) has been cancelled.`,
  }),
  'password.reset.requested': (p) => ({
    subject: 'Password Reset Request',
    text: `Use this token to reset your password: ${p.token} (valid 1 hour)`,
  }),
  'payment.completed': (p) => ({
    subject: 'Payment Received',
    text: `Your payment of €${p.amountEur} has been received. Your bonus is now active!`,
  }),
  'no-show.detected': (p) => ({
    subject: 'Missed Class Notice',
    text: `You were marked as a no-show for booking ${p.bookingId}.`,
  }),
}

async function logSend(client, { userId, template, status, errorMsg, tenantId, subTenantId }) {
  await client.query(
    `INSERT INTO yoga_notifications.send_log (id, user_id, template, channel, status, error_msg, tenant_id, sub_tenant_id)
     VALUES ($1, $2, $3, 'email', $4, $5, $6, $7)`,
    [uuidv4(), userId, template, status, errorMsg ?? null, tenantId, subTenantId ?? null],
  )
}

async function getUserEmail(client, userId) {
  const { rows } = await client.query(
    'SELECT email FROM yoga_auth.users WHERE id = $1',
    [userId],
  )
  return rows[0]?.email ?? null
}

export function startEventConsumer() {
  const sub = new Redis(env.REDIS_URL)

  sub.subscribe('yoga:events', (err) => {
    if (err) logger.error({ err }, 'Failed to subscribe to yoga:events')
    else logger.info('yoga-notifications subscribed to yoga:events')
  })

  sub.on('message', async (channel, message) => {
    let event
    try { event = JSON.parse(message) } catch { return }

    const template = TEMPLATES[event.type]
    if (!template) return

    const userId = event.payload.userId
    if (!userId) return

    const { tenantId, subTenantId } = event.payload
    if (!tenantId) {
      logger.warn({ event }, 'Event missing tenantId, skipping')
      return
    }

    const client = await pool.connect()
    try {
      await setTenantContext(client, tenantId, subTenantId)

      const email = await getUserEmail(client, userId)
      if (!email) return

      const { subject, text } = template(event.payload)

      await sendEmail({ to: email, subject, text })
      await logSend(client, { userId, template: event.type, status: 'sent', tenantId, subTenantId })
    } catch (err) {
      logger.error({ err, event }, 'Failed to send notification')
      await logSend(client, { userId, template: event.type, status: 'failed', errorMsg: err.message, tenantId, subTenantId }).catch(() => {})
    } finally {
      client.release()
    }
  })

  sub.on('error', (err) => logger.error({ err }, 'Event consumer Redis error'))
}
