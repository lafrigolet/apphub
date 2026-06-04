// SMS sender — Twilio API (Programmable Messaging) via plain fetch().
//
// Mirrors email.service.js: settings cached for 30s, dev-stub fallback when
// no API key is configured (logs the message instead of sending), and a
// compose() helper that pulls templates by (key, channel='sms') with hardcoded
// fallbacks so the system keeps working before any template edit.
//
// Twilio docs: https://www.twilio.com/docs/usage/api
import { env } from '../lib/env.js'
import { logger } from '../lib/logger.js'
import { pool } from '../lib/db.js'
import * as configRepo from '../repositories/config.repository.js'
import { renderTemplate } from './template-renderer.js'
import { logSend } from './send-log.service.js'
import { isSuppressed } from './suppression.service.js'

const CACHE_TTL_MS = 30_000
let cache = {
  twilioAccountSid:           null,
  twilioApiKeySid:            null,
  twilioApiKeySecret:         null,
  twilioMessagingServiceSid:  null,
  twilioDefaultSender:        null,
  expiresAt: 0,
}

async function loadConfig() {
  if (Date.now() < cache.expiresAt) return cache
  const client = await pool.connect()
  try {
    cache = {
      twilioAccountSid:           await configRepo.getValue(client, 'twilio_account_sid'),
      twilioApiKeySid:            await configRepo.getValue(client, 'twilio_api_key_sid'),
      twilioApiKeySecret:         await configRepo.getValue(client, 'twilio_api_key_secret'),
      twilioMessagingServiceSid:  await configRepo.getValue(client, 'twilio_messaging_service_sid'),
      twilioDefaultSender:        await configRepo.getValue(client, 'twilio_default_sender'),
      expiresAt: Date.now() + CACHE_TTL_MS,
    }
  } finally { client.release() }
  return cache
}

export function invalidateSmsConfigCache() { cache.expiresAt = 0 }

function isStubMode(cfg) {
  // Stub when credentials are missing OR running tests. Don't key off
  // NODE_ENV='development' — compose base leaves that flag set even in
  // prod, which would mute real SMS.
  return env.NODE_ENV === 'test'
    || !cfg.twilioAccountSid
    || !cfg.twilioApiKeySid
    || !cfg.twilioApiKeySecret
    || (!cfg.twilioMessagingServiceSid && !cfg.twilioDefaultSender)
}

async function send({ to, body, templateKey, meta }) {
  if (!to || !body) return
  const cfg = await loadConfig()

  // Audit best-effort hacia send_log — mismo patrón que email.service.js.
  const audit = (status, error, providerMessageId) => logSend({
    ...meta, channel: 'sms', template: templateKey, recipient: to, status, error, providerMessageId,
  })

  // Suppression gate (recommendation #5): skip numbers that opted out (STOP).
  // Fails open, so a store hiccup never silences a legitimate SMS.
  if (await isSuppressed('sms', to)) {
    logger.info({ to, template: templateKey }, 'SMS suppressed (opt-out list)')
    await audit('skipped', 'suppressed')
    return { suppressed: true }
  }

  if (isStubMode(cfg)) {
    logger.info({ to, body }, '[stub] SMS not sent — Twilio not configured (or NODE_ENV=development)')
    await audit('skipped')
    return { stub: true }
  }

  const auth = Buffer.from(`${cfg.twilioApiKeySid}:${cfg.twilioApiKeySecret}`).toString('base64')
  const form = new URLSearchParams()
  form.set('To', to)
  form.set('Body', body)
  if (cfg.twilioMessagingServiceSid) form.set('MessagingServiceSid', cfg.twilioMessagingServiceSid)
  else form.set('From', cfg.twilioDefaultSender)

  const url = `https://api.twilio.com/2010-04-01/Accounts/${cfg.twilioAccountSid}/Messages.json`
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      logger.error({ status: res.status, body: text, to }, 'Twilio send failed')
      await audit('failed', text || res.statusText)
      return { error: text || res.statusText }
    }
    const data = await res.json()
    logger.info({ sid: data.sid, to }, 'SMS sent')
    // Stash the Twilio SID so the StatusCallback webhook can correlate the
    // async delivery result (delivered / failed / undelivered) back here.
    await audit('sent', null, data.sid ?? null)
    return { sid: data.sid }
  } catch (err) {
    logger.error({ err, to }, 'Failed to send SMS')
    await audit('failed', err.message)
    return { error: err.message }
  }
}

// Public: smoke-test endpoint helper. Sends a simple body to a number, used
// from console > Configuración > Twilio > "Probar".
export async function sendTestSms(to, body) {
  return send({ to, body: body ?? 'Test from AppHub notifications.', templateKey: 'sms.test' })
}

async function compose(key, vars, fallback, locale) {
  const fromDb = await renderTemplate(key, vars, 'sms', locale)
  return fromDb ?? fallback
}

function intlLocale(loc) { return loc === 'en' ? 'en-GB' : 'es-ES' }

export async function sendBookingReminderSms(to, { name, startsAt, window, locale = 'es' }) {
  const when = new Date(startsAt).toLocaleString(intlLocale(locale), { timeZone: 'Europe/Madrid' })
  const lead = locale === 'en'
    ? (window === 't_minus_24h' ? 'tomorrow'  : 'in 2 hours')
    : (window === 't_minus_24h' ? 'mañana'    : 'en 2 horas')
  const tmpl = await compose('booking.reminder.due', { lead, when, name }, {
    text: `Recordatorio: tu cita es ${lead} (${when}). Si no puedes asistir, cancela con antelación.`,
  }, locale)
  return send({ to, body: tmpl.text, templateKey: 'booking.reminder.due' })
}

export async function sendReservationReminderSms(to, { name, reservedFor, partySize, window, locale = 'es' }) {
  const when = new Date(reservedFor).toLocaleString(intlLocale(locale), { timeZone: 'Europe/Madrid' })
  const lead = locale === 'en'
    ? (window === 't_minus_24h' ? 'tomorrow'  : 'in 2 hours')
    : (window === 't_minus_24h' ? 'mañana'    : 'en 2 horas')
  const tmpl = await compose('reservation.reminder.due', { lead, when, partySize, name }, {
    text: `Recordatorio: tu reserva es ${lead} (${when}) para ${partySize} personas. Si no puedes asistir, cancela con antelación.`,
  }, locale)
  return send({ to, body: tmpl.text, templateKey: 'reservation.reminder.due' })
}

// ── New event SMS senders ─────────────────────────────────────────────

export async function sendBookingConfirmedSms(to, { startsAt, locale = 'es' }) {
  const when = new Date(startsAt).toLocaleString(intlLocale(locale), { timeZone: 'Europe/Madrid' })
  const tmpl = await compose('booking.confirmed', { when }, {
    text: locale === 'en' ? `Your appointment is confirmed for ${when}.` : `Tu cita ha sido confirmada para el ${when}.`,
  }, locale)
  return send({ to, body: tmpl.text, templateKey: 'booking.confirmed' })
}

export async function sendBookingCancelledSms(to, { startsAt, locale = 'es' }) {
  const when = new Date(startsAt).toLocaleString(intlLocale(locale), { timeZone: 'Europe/Madrid' })
  const tmpl = await compose('booking.cancelled', { when }, {
    text: locale === 'en' ? `Your appointment on ${when} has been cancelled.` : `Tu cita del ${when} ha sido cancelada.`,
  }, locale)
  return send({ to, body: tmpl.text, templateKey: 'booking.cancelled' })
}

export async function sendBookingRescheduledSms(to, { startsAt, locale = 'es' }) {
  const when = new Date(startsAt).toLocaleString(intlLocale(locale), { timeZone: 'Europe/Madrid' })
  const tmpl = await compose('booking.rescheduled', { when }, {
    text: locale === 'en' ? `Your appointment has been rescheduled to ${when}.` : `Tu cita ha sido reprogramada para el ${when}.`,
  }, locale)
  return send({ to, body: tmpl.text, templateKey: 'booking.rescheduled' })
}

export async function sendReservationCancelledSms(to, { reservedFor, locale = 'es' }) {
  const when = new Date(reservedFor).toLocaleString(intlLocale(locale), { timeZone: 'Europe/Madrid' })
  const tmpl = await compose('reservation.cancelled', { when }, {
    text: locale === 'en' ? `Your reservation on ${when} has been cancelled.` : `Tu reserva del ${when} ha sido cancelada.`,
  }, locale)
  return send({ to, body: tmpl.text, templateKey: 'reservation.cancelled' })
}
