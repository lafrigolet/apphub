// Digest mode: queue non-urgent events into a per-user Redis list instead of
// sending immediately. A scheduled job (notification-digest in
// platform-scheduler) flushes the queue once per day, composing a single
// email per user that summarises everything queued.
//
// Only an allowlist of event types is digestable. Time-critical events
// (reminders, password resets, OTPs) bypass the queue and send immediately.
//
// Queue layout:
//   key   = nd:digest:<userId>
//   value = list of JSON {to, eventType, payload, locale, ts}
//   TTL   = 7d (so unflushed entries don't grow unbounded if the job is
//           disabled or the user is later deleted)

import { redis } from '../lib/redis.js'
import { logger } from '../lib/logger.js'
import { pool } from '../lib/db.js'
import * as configRepo from '../repositories/config.repository.js'
import { renderTemplate } from './template-renderer.js'

const TTL_SECONDS = 7 * 86_400
const QUEUE_PREFIX = 'nd:digest:'

// Set of event types that are routed through the digest when digest_mode
// is 'daily'. Keep this narrow — anything time-sensitive (reminders, auth)
// must NOT be added here.
const DIGESTABLE = new Set([
  'booking.confirmed',
  'booking.cancelled',
  'booking.rescheduled',
  'reservation.created',
  'reservation.cancelled',
  'package.exhausted',
  'payout.paid',
])

const CACHE_TTL_MS = 30_000
let modeCache = { mode: null, expiresAt: 0 }

async function loadMode() {
  if (Date.now() < modeCache.expiresAt) return modeCache.mode
  const client = await pool.connect()
  try {
    const v = await configRepo.getValue(client, 'digest_mode')
    modeCache = { mode: v ?? 'off', expiresAt: Date.now() + CACHE_TTL_MS }
  } finally { client.release() }
  return modeCache.mode
}

export function invalidateDigestModeCache() { modeCache.expiresAt = 0 }

// Returns true when the consumer should buffer this event instead of
// dispatching immediately.
export async function shouldDigest(eventType) {
  if (!DIGESTABLE.has(eventType)) return false
  const mode = await loadMode()
  return mode === 'daily'
}

export async function enqueueDigest({ userId, eventType, payload, locale, to }) {
  if (!userId || !to) return
  const key = `${QUEUE_PREFIX}${userId}`
  const entry = JSON.stringify({ to, eventType, payload, locale: locale ?? 'es', ts: Date.now() })
  const pipe = redis.multi()
  pipe.rpush(key, entry).expire(key, TTL_SECONDS)
  await pipe.exec()
  logger.debug({ userId, eventType }, 'event enqueued in digest')
}

// One-line summary per event used inside the composed digest email.
function summarize(event, locale) {
  const p = event.payload ?? {}
  const en = locale === 'en'
  switch (event.eventType) {
    case 'booking.confirmed':
      return en ? `Appointment confirmed for ${p.startsAt}` : `Cita confirmada para ${p.startsAt}`
    case 'booking.cancelled':
      return en ? `Appointment on ${p.startsAt} cancelled` : `Cita del ${p.startsAt} cancelada`
    case 'booking.rescheduled':
      return en ? `Appointment rescheduled to ${p.startsAt}` : `Cita reprogramada al ${p.startsAt}`
    case 'reservation.created':
      return en ? `Reservation received for ${p.reservedFor} (${p.partySize})` : `Reserva recibida para ${p.reservedFor} (${p.partySize})`
    case 'reservation.cancelled':
      return en ? `Reservation on ${p.reservedFor} cancelled` : `Reserva del ${p.reservedFor} cancelada`
    case 'package.exhausted':
      return en ? 'Your package is fully used' : 'Has agotado las sesiones de tu bono'
    case 'payout.paid':
      return en ? `Payout ${p.amount} paid (${p.periodLabel})` : `Liquidación ${p.amount} pagada (${p.periodLabel})`
    default:
      return event.eventType
  }
}

// Pulls every queue, builds one digest per user, sends, clears. The send
// callback is injected so this module doesn't import email.service.js
// (avoids a circular import — email.service can't import digest helpers).
//
// Returns { usersFlushed, eventsSent }.
export async function flushAll({ send, logger: log = logger } = {}) {
  if (typeof send !== 'function') throw new Error('flushAll requires a send({to,subject,text}) callback')

  let cursor = '0'
  let usersFlushed = 0
  let eventsSent = 0

  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', `${QUEUE_PREFIX}*`, 'COUNT', 100)
    cursor = next
    for (const key of keys) {
      // Atomically read+clear: rename to a temp key so new RPUSHes during
      // composition land in a fresh list rather than getting wiped.
      const tmpKey = `${key}:flushing`
      try { await redis.rename(key, tmpKey) } catch (_e) { continue /* race: another worker took it */ }
      const items = await redis.lrange(tmpKey, 0, -1)
      await redis.del(tmpKey)
      if (!items?.length) continue

      const events = items.map((s) => { try { return JSON.parse(s) } catch { return null } }).filter(Boolean)
      if (events.length === 0) continue

      const to = events[0].to
      const locale = events[0].locale ?? 'es'
      const subject = locale === 'en'
        ? `Your AppHub digest (${events.length} updates)`
        : `Tu resumen de AppHub (${events.length} novedades)`

      // Try a DB-stored digest template first; if absent, build a simple
      // bulleted body locally so the system works before any staff edit.
      const lines = events.map(summarize)
      const tmpl = await renderTemplate('notifications.digest', { count: events.length, items: lines.join('\n• ') }, 'email', locale)
      const body = tmpl ?? {
        subject,
        text: (locale === 'en' ? 'Hi,\n\nHere is your daily digest:\n• '
                                : 'Hola,\n\nEste es tu resumen diario:\n• ') + lines.join('\n• '),
      }

      try {
        await send({ to, ...body })
        usersFlushed += 1
        eventsSent += events.length
      } catch (err) {
        log.error({ err, key }, 'digest send failed; entries lost')
      }
    }
  } while (cursor !== '0')

  return { usersFlushed, eventsSent }
}
