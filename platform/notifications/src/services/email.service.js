import sgMail from '@sendgrid/mail'
import { env } from '../lib/env.js'
import { logger } from '../lib/logger.js'
import { pool } from '../lib/db.js'
import * as configRepo from '../repositories/config.repository.js'
import { renderTemplate } from './template-renderer.js'

// Resolve runtime config: prefer DB rows (set by staff via voragine-console),
// fall back to env vars for back-compat. Cached for 30s to avoid hammering
// Postgres on every email.
const CACHE_TTL_MS = 30_000
let cache = { sendgridApiKey: null, senderEmail: null, senderName: null, expiresAt: 0 }

async function loadConfig() {
  if (Date.now() < cache.expiresAt) return cache
  const client = await pool.connect()
  try {
    const apiKey = await configRepo.getValue(client, 'sendgrid_api_key')
    const senderEmail = await configRepo.getValue(client, 'sender_email')
    const senderName  = await configRepo.getValue(client, 'sender_name')
    cache = {
      sendgridApiKey: apiKey ?? env.SENDGRID_API_KEY,
      senderEmail:    senderEmail ?? env.SENDGRID_FROM_EMAIL,
      senderName:     senderName ?? null,
      expiresAt:      Date.now() + CACHE_TTL_MS,
    }
  } finally {
    client.release()
  }
  return cache
}

// Public — call after a config change to drop the cache.
export function invalidateConfigCache() { cache.expiresAt = 0 }

async function send(msg) {
  const cfg = await loadConfig()
  const isDev = env.NODE_ENV === 'development' || !cfg.sendgridApiKey || cfg.sendgridApiKey === 'dev_no_sendgrid'
  const from = cfg.senderName ? { email: cfg.senderEmail, name: cfg.senderName } : cfg.senderEmail

  if (isDev) {
    logger.info({ to: msg.to, subject: msg.subject }, '[dev] Email not sent — logged only')
    return
  }
  try {
    sgMail.setApiKey(cfg.sendgridApiKey)
    await sgMail.send({ ...msg, from })
    logger.info({ to: msg.to, subject: msg.subject }, 'Email sent')
  } catch (err) {
    logger.error({ err, to: msg.to }, 'Failed to send email')
  }
}

// Try to render the named template from DB; if not present, fall back to the
// hardcoded `defaults` so the system keeps working even before a staff edit.
// `locale` is forwarded to renderTemplate which falls back to 'es' when the
// requested locale has no row.
async function compose(key, vars, defaults, locale) {
  const fromDb = await renderTemplate(key, vars, 'email', locale)
  return fromDb ?? defaults
}

// Locale-aware lead-time labels used in the hardcoded fallbacks. The DB
// templates carry their own translated wording so most paths skip these.
function leadEs(window) {
  return window === 't_minus_24h' ? 'mañana' : 'en 2 horas'
}
function leadEn(window) {
  return window === 't_minus_24h' ? 'tomorrow' : 'in 2 hours'
}
function intlLocale(loc) {
  // Map our short locale to a BCP-47 tag for Intl.DateTimeFormat.
  return loc === 'en' ? 'en-GB' : 'es-ES'
}

export async function sendWelcomeEmail(to, appId, locale = 'es') {
  const tmpl = await compose('user.welcome', { appId }, {
    subject: `Bienvenido a ${appId}`,
    text: `Hola,\n\nTu cuenta en ${appId} ha sido creada correctamente. ¡Bienvenido!\n\nEl equipo de AIKIKAN`,
    html: `<p>Hola,</p><p>Tu cuenta en <strong>${appId}</strong> ha sido creada correctamente. ¡Bienvenido!</p><p>El equipo de AIKIKAN</p>`,
  }, locale)
  await send({ to, ...tmpl })
}

export async function sendPasswordResetEmail(to, resetUrl, locale = 'es') {
  const tmpl = await compose('auth.password_reset', { resetUrl }, {
    subject: 'Restablecer contraseña — AIKIKAN',
    text: `Haz clic en el siguiente enlace para restablecer tu contraseña (válido 1 hora):\n\n${resetUrl}\n\nSi no solicitaste este cambio, ignora este mensaje.`,
    html: `<p>Haz clic en el siguiente enlace para restablecer tu contraseña (válido 1 hora):</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>Si no solicitaste este cambio, ignora este mensaje.</p>`,
  }, locale)
  await send({ to, ...tmpl })
}

export async function sendBookingReminderEmail(to, { name, startsAt, window, locale = 'es' }) {
  const when = new Date(startsAt).toLocaleString(intlLocale(locale), { timeZone: 'Europe/Madrid' })
  const lead = locale === 'en' ? leadEn(window) : leadEs(window)
  const namePrefix = name ? ' ' + name : ''
  const tmpl = await compose('booking.reminder.due', { namePrefix, lead, when }, {
    subject: `Recordatorio: tu cita es ${lead}`,
    text: `Hola${namePrefix},\n\nTe recordamos que tienes una cita ${lead} (${when}).\n\nSi no puedes asistir, por favor cancela con antelación.`,
  }, locale)
  await send({ to, ...tmpl })
}

export async function sendReservationReminderEmail(to, { name, reservedFor, partySize, window, locale = 'es' }) {
  const when = new Date(reservedFor).toLocaleString(intlLocale(locale), { timeZone: 'Europe/Madrid' })
  const lead = locale === 'en' ? leadEn(window) : leadEs(window)
  const namePrefix = name ? ' ' + name : ''
  const tmpl = await compose('reservation.reminder.due', { namePrefix, lead, when, partySize }, {
    subject: `Recordatorio: tu reserva es ${lead}`,
    text: `Hola${namePrefix},\n\nTe recordamos tu reserva ${lead} (${when}) para ${partySize} personas.\n\nSi no puedes asistir, te agradeceríamos que canceles con antelación.`,
  }, locale)
  await send({ to, ...tmpl })
}

export async function sendPackageExpiryEmail(to, { remainingSessions, expiresAt, window, locale = 'es' }) {
  const expires = new Date(expiresAt).toLocaleDateString(intlLocale(locale))
  const lead = locale === 'en'
    ? (window === 't_minus_30d' ? 'in 30 days' : 'in 7 days')
    : (window === 't_minus_30d' ? 'en 30 días' : 'en 7 días')
  const tmpl = await compose('package.expiring', { expires, lead, remainingSessions }, {
    subject: `Tu bono caduca ${lead}`,
    text: `Hola,\n\nTu bono caduca el ${expires} (${lead}). Te quedan ${remainingSessions} sesión(es) por usar.\n\nReserva ahora para no perderlas.`,
  }, locale)
  await send({ to, ...tmpl })
}

export async function sendDisputeSlaInternalEmail(to, { disputeId, orderId, openedAt, locale = 'es' }) {
  const tmpl = await compose('dispute.sla_breached.staff', { disputeId, orderId, openedAt }, {
    subject: '[STAFF] Disputa sin respuesta del vendedor (>48h)',
    text: `Disputa ${disputeId} sobre el pedido ${orderId} (abierta ${openedAt}) lleva más de 48 h sin respuesta del vendedor. Revisar y escalar.`,
  }, locale)
  await send({ to, ...tmpl })
}
