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

// Public passthrough used by the digest flush job (which composes its own
// subject/body and just needs the underlying SendGrid send).
export async function sendRaw(msg) { await send(msg) }

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

// ── New event senders (subscribed in event-consumer) ──────────────────

export async function sendBookingConfirmedEmail(to, { name, startsAt, locale = 'es' }) {
  const when = new Date(startsAt).toLocaleString(intlLocale(locale), { timeZone: 'Europe/Madrid' })
  const namePrefix = name ? ' ' + name : ''
  const tmpl = await compose('booking.confirmed', { namePrefix, when }, {
    subject: locale === 'en' ? `Your appointment is confirmed — ${when}` : `Tu cita está confirmada — ${when}`,
    text: (locale === 'en'
      ? `Hi${namePrefix},\n\nYour appointment has been confirmed for ${when}.\n\nIf you need to cancel or reschedule, please do it in advance.`
      : `Hola${namePrefix},\n\nTu cita ha sido confirmada para el ${when}.\n\nSi necesitas cancelar o cambiarla, hazlo con antelación.`),
  }, locale)
  await send({ to, ...tmpl })
}

export async function sendBookingCancelledEmail(to, { name, startsAt, reason, locale = 'es' }) {
  const when = new Date(startsAt).toLocaleString(intlLocale(locale), { timeZone: 'Europe/Madrid' })
  const namePrefix = name ? ' ' + name : ''
  const reasonLine = reason ? (locale === 'en' ? ` Reason: ${reason}.` : ` Motivo: ${reason}.`) : ''
  const tmpl = await compose('booking.cancelled', { namePrefix, when, reasonLine }, {
    subject: locale === 'en' ? 'Your appointment has been cancelled' : 'Tu cita ha sido cancelada',
    text: (locale === 'en'
      ? `Hi${namePrefix},\n\nYour appointment on ${when} has been cancelled.${reasonLine}\n\nYou can book another slot whenever you want.`
      : `Hola${namePrefix},\n\nTu cita del ${when} ha sido cancelada.${reasonLine}\n\nSi quieres reservar otro hueco, te esperamos.`),
  }, locale)
  await send({ to, ...tmpl })
}

export async function sendBookingRescheduledEmail(to, { name, startsAt, locale = 'es' }) {
  const when = new Date(startsAt).toLocaleString(intlLocale(locale), { timeZone: 'Europe/Madrid' })
  const namePrefix = name ? ' ' + name : ''
  const tmpl = await compose('booking.rescheduled', { namePrefix, when }, {
    subject: locale === 'en' ? `Your appointment has been rescheduled — ${when}` : `Tu cita ha sido reprogramada — ${when}`,
    text: (locale === 'en'
      ? `Hi${namePrefix},\n\nYour appointment has been rescheduled to ${when}.\n\nIf this new time does not work, please reply to this email.`
      : `Hola${namePrefix},\n\nTu cita ha sido reprogramada para el ${when}.\n\nSi la nueva fecha no te encaja, escríbenos.`),
  }, locale)
  await send({ to, ...tmpl })
}

export async function sendReservationCreatedEmail(to, { name, reservedFor, partySize, locale = 'es' }) {
  const when = new Date(reservedFor).toLocaleString(intlLocale(locale), { timeZone: 'Europe/Madrid' })
  const namePrefix = name ? ' ' + name : ''
  const tmpl = await compose('reservation.created', { namePrefix, when, partySize }, {
    subject: locale === 'en' ? `Reservation received — ${when} for ${partySize}` : `Reserva recibida — ${when} para ${partySize}`,
    text: (locale === 'en'
      ? `Hi${namePrefix},\n\nWe have received your reservation for ${when} (${partySize} guests). We will confirm it shortly.`
      : `Hola${namePrefix},\n\nHemos recibido tu reserva para el ${when} (${partySize} personas). Te avisaremos en cuanto la confirmemos.`),
  }, locale)
  await send({ to, ...tmpl })
}

export async function sendReservationCancelledEmail(to, { name, reservedFor, locale = 'es' }) {
  const when = new Date(reservedFor).toLocaleString(intlLocale(locale), { timeZone: 'Europe/Madrid' })
  const namePrefix = name ? ' ' + name : ''
  const tmpl = await compose('reservation.cancelled', { namePrefix, when }, {
    subject: locale === 'en' ? 'Your reservation has been cancelled' : 'Tu reserva ha sido cancelada',
    text: (locale === 'en'
      ? `Hi${namePrefix},\n\nYour reservation on ${when} has been cancelled.`
      : `Hola${namePrefix},\n\nTu reserva del ${when} ha sido cancelada.`),
  }, locale)
  await send({ to, ...tmpl })
}

export async function sendPackageExhaustedEmail(to, { locale = 'es' } = {}) {
  const tmpl = await compose('package.exhausted', {}, {
    subject: locale === 'en' ? 'Your package is fully used' : 'Has agotado las sesiones de tu bono',
    text: (locale === 'en'
      ? 'Hi,\n\nYou have used the last session of your package. We hope to see you again soon.'
      : 'Hola,\n\nHas utilizado la última sesión de tu bono. ¡Esperamos verte pronto de nuevo!'),
  }, locale)
  await send({ to, ...tmpl })
}

function formatAmount(cents, currency, locale) {
  if (cents == null) return ''
  try {
    return new Intl.NumberFormat(intlLocale(locale), { style: 'currency', currency: currency || 'EUR' })
      .format(cents / 100)
  } catch { return `${(cents / 100).toFixed(2)} ${currency || ''}`.trim() }
}

export async function sendOrderPaidEmail(to, { orderId, totalCents, currency, locale = 'es' }) {
  const total = formatAmount(totalCents, currency, locale)
  const tmpl = await compose('order.paid', { orderId, total }, {
    subject: locale === 'en' ? `Payment received · Order #${orderId}` : `Pago confirmado · Pedido #${orderId}`,
    text: locale === 'en'
      ? `Hi,\n\nWe have received the payment for your order #${orderId} (${total}). We will notify you when it ships.`
      : `Hola,\n\nHemos recibido el pago de tu pedido #${orderId} (${total}). Te avisaremos cuando se envíe.`,
  }, locale)
  await send({ to, ...tmpl })
}

export async function sendOrderShippedEmail(to, { orderId, trackingCode, carrier, locale = 'es' }) {
  const trackingLine = trackingCode
    ? (locale === 'en' ? ` Tracking: ${carrier ?? ''} ${trackingCode}.` : ` Seguimiento: ${carrier ?? ''} ${trackingCode}.`)
    : ''
  const tmpl = await compose('order.shipped', { orderId, trackingLine }, {
    subject: locale === 'en' ? `Your order is on its way · #${orderId}` : `Tu pedido va en camino · #${orderId}`,
    text: (locale === 'en' ? `Hi,\n\nYour order #${orderId} is on its way.${trackingLine}` : `Hola,\n\nTu pedido #${orderId} ya está en camino.${trackingLine}`),
  }, locale)
  await send({ to, ...tmpl })
}

export async function sendOrderDeliveredEmail(to, { orderId, locale = 'es' }) {
  const tmpl = await compose('order.delivered', { orderId }, {
    subject: locale === 'en' ? `Order delivered · #${orderId}` : `Pedido entregado · #${orderId}`,
    text: locale === 'en' ? `Hi,\n\nYour order #${orderId} has been delivered. We hope you enjoy it.` : `Hola,\n\nTu pedido #${orderId} ha sido entregado. Esperamos que disfrutes de tu compra.`,
  }, locale)
  await send({ to, ...tmpl })
}

export async function sendOrderCancelledEmail(to, { orderId, reason, locale = 'es' }) {
  const reasonLine = reason ? (locale === 'en' ? ` Reason: ${reason}.` : ` Motivo: ${reason}.`) : ''
  const tmpl = await compose('order.cancelled', { orderId, reasonLine }, {
    subject: locale === 'en' ? `Order cancelled · #${orderId}` : `Pedido cancelado · #${orderId}`,
    text: (locale === 'en'
      ? `Hi,\n\nYour order #${orderId} has been cancelled.${reasonLine} If this is not what you expected, please contact support.`
      : `Hola,\n\nTu pedido #${orderId} ha sido cancelado.${reasonLine} Si esto no es lo que esperabas, contacta con soporte.`),
  }, locale)
  await send({ to, ...tmpl })
}

export async function sendOrderRefundedEmail(to, { orderId, totalCents, currency, locale = 'es' }) {
  const total = formatAmount(totalCents, currency, locale)
  const tmpl = await compose('order.refunded', { orderId, total }, {
    subject: locale === 'en' ? `Refund issued · #${orderId}` : `Reembolso emitido · #${orderId}`,
    text: locale === 'en'
      ? `Hi,\n\nWe have issued a refund for your order #${orderId} (${total}). It can take several days to appear on your statement.`
      : `Hola,\n\nHemos emitido el reembolso de tu pedido #${orderId} (${total}). Puede tardar varios días en reflejarse en tu cuenta.`,
  }, locale)
  await send({ to, ...tmpl })
}

export async function sendPayoutPaidEmail(to, { amount, periodLabel, externalRef, locale = 'es' }) {
  const tmpl = await compose('payout.paid', { amount, periodLabel, externalRef }, {
    subject: locale === 'en' ? `Your ${amount} payout has been paid` : `Tu liquidación de ${amount} se ha pagado`,
    text: (locale === 'en'
      ? `Hi,\n\nYour payout for period ${periodLabel} has been paid: ${amount}. Reference: ${externalRef}.`
      : `Hola,\n\nTu liquidación correspondiente al periodo ${periodLabel} ha sido pagada por importe de ${amount}. Referencia: ${externalRef}.`),
  }, locale)
  await send({ to, ...tmpl })
}
