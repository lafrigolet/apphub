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
  return env.NODE_ENV === 'development'
    || !cfg.twilioAccountSid
    || !cfg.twilioApiKeySid
    || !cfg.twilioApiKeySecret
    || (!cfg.twilioMessagingServiceSid && !cfg.twilioDefaultSender)
}

async function send({ to, body }) {
  if (!to || !body) return
  const cfg = await loadConfig()

  if (isStubMode(cfg)) {
    logger.info({ to, body }, '[stub] SMS not sent — Twilio not configured (or NODE_ENV=development)')
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
      return { error: text || res.statusText }
    }
    const data = await res.json()
    logger.info({ sid: data.sid, to }, 'SMS sent')
    return { sid: data.sid }
  } catch (err) {
    logger.error({ err, to }, 'Failed to send SMS')
    return { error: err.message }
  }
}

// Public: smoke-test endpoint helper. Sends a simple body to a number, used
// from voragine-console > Configuración > Twilio > "Probar".
export async function sendTestSms(to, body) {
  return send({ to, body: body ?? 'Test from AppHub notifications.' })
}

async function compose(key, vars, fallback) {
  const fromDb = await renderTemplate(key, vars, 'sms')
  return fromDb ?? fallback
}

export async function sendBookingReminderSms(to, { name, startsAt, window }) {
  const when = new Date(startsAt).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })
  const lead = window === 't_minus_24h' ? 'mañana' : 'en 2 horas'
  const tmpl = await compose('booking.reminder.due', { lead, when, name }, {
    text: `Recordatorio: tu cita es ${lead} (${when}). Si no puedes asistir, cancela con antelación.`,
  })
  return send({ to, body: tmpl.text })
}
