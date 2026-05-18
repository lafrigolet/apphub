import { Resend } from 'resend'
import { env } from '../lib/env.js'
import { logger } from '../lib/logger.js'
import { pool } from '../lib/db.js'
import * as configRepo from '../repositories/config.repository.js'
import { renderTemplate } from './template-renderer.js'

// Resolve runtime config: prefer DB rows (set by staff via console),
// fall back to env var. Cached for 30s to avoid hammering Postgres on
// every email.
const CACHE_TTL_MS = 30_000
let cache = { resendApiKey: null, senderEmail: null, senderName: null, expiresAt: 0 }

async function loadConfig() {
  if (Date.now() < cache.expiresAt) return cache
  const client = await pool.connect()
  try {
    const apiKey      = await configRepo.getValue(client, 'resend_api_key')
    const senderEmail = await configRepo.getValue(client, 'sender_email')
    const senderName  = await configRepo.getValue(client, 'sender_name')
    cache = {
      resendApiKey: apiKey ?? env.RESEND_API_KEY,
      senderEmail:  senderEmail ?? env.EMAIL_FROM_ADDRESS,
      senderName:   senderName ?? null,
      expiresAt:    Date.now() + CACHE_TTL_MS,
    }
  } finally {
    client.release()
  }
  return cache
}

// Public — call after a config change to drop the cache.
export function invalidateConfigCache() { cache.expiresAt = 0 }

// Public passthrough used by the digest flush job (which composes its own
// subject/body and just needs the underlying send).
export async function sendRaw(msg) { await send(msg) }

async function send(msg) {
  const cfg = await loadConfig()
  // Send if the operator configured a Resend API key. Tests skip via
  // NODE_ENV='test' (vi.mock already isolates them but the guard is
  // belt-and-braces). NOT keyed off NODE_ENV='development' because the
  // compose base sets that even in prod and it would mute real emails.
  const skip = !cfg.resendApiKey || env.NODE_ENV === 'test'

  if (skip) {
    logger.info({ to: msg.to, subject: msg.subject }, '[dev] Email not sent — logged only')
    return
  }
  // Resend expects `from` as "Name <email@domain>" or just "email@domain".
  const from = cfg.senderName
    ? `${cfg.senderName} <${cfg.senderEmail}>`
    : cfg.senderEmail
  try {
    const resend = new Resend(cfg.resendApiKey)
    const { data, error } = await resend.emails.send({
      from,
      to:      msg.to,
      subject: msg.subject,
      html:    msg.html,
      text:    msg.text,
    })
    if (error) {
      logger.error({ err: error, to: msg.to }, 'Failed to send email')
      return
    }
    logger.info({ to: msg.to, subject: msg.subject, messageId: data?.id }, 'Email sent')
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
  if (!fromDb) return defaults
  // Fallback PER FIELD: si la plantilla en DB tiene algún campo
  // (subject/text/html) en NULL, sustituimos por el hardcoded default.
  // Antes hacíamos "fromDb ?? defaults" y un body_html=NULL llegaba a
  // Resend como literal null → 'string expected for html'.
  return {
    subject: fromDb.subject ?? defaults.subject,
    text:    fromDb.text    ?? defaults.text,
    html:    fromDb.html    ?? defaults.html,
    locale:  fromDb.locale,
  }
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

// ── Self-register + Admin-approval (Ruta 1) ─────────────────────────────

export async function sendSignupRequestedEmail(to, { displayName, locale = 'es' } = {}) {
  const namePrefix = displayName ? ' ' + displayName : ''
  const tmpl = await compose('auth.signup.requested', { namePrefix }, {
    subject: 'Hemos recibido tu solicitud',
    text: `Hola${namePrefix},\n\nHemos recibido tu solicitud de alta. Un administrador la revisará y te avisaremos por email en cuanto la decisión esté tomada.\n\nGracias por tu interés.`,
    html: `<p>Hola${namePrefix},</p><p>Hemos recibido tu solicitud de alta. Un administrador la revisará y te avisaremos por email en cuanto la decisión esté tomada.</p><p>Gracias por tu interés.</p>`,
  }, locale)
  await send({ to, ...tmpl })
}

export async function sendSignupApprovedEmail(to, { displayName, magicLinkUrl, locale = 'es' } = {}) {
  const namePrefix = displayName ? ' ' + displayName : ''
  const tmpl = await compose('auth.signup.approved', { namePrefix, magicLinkUrl }, {
    subject: 'Tu cuenta ha sido aprobada — fija tu contraseña',
    text: `Hola${namePrefix},\n\n¡Buenas noticias! Tu solicitud ha sido aprobada. Para activar tu cuenta, pulsa el siguiente enlace y fija tu contraseña (válido durante 1 hora):\n\n${magicLinkUrl}\n\nSi te has registrado con Google o Facebook, puedes ignorar este enlace y simplemente volver a iniciar sesión con ese proveedor.`,
    html: `<p>Hola${namePrefix},</p><p>¡Buenas noticias! Tu solicitud ha sido aprobada. Para activar tu cuenta, pulsa el siguiente enlace y fija tu contraseña (válido durante 1 hora):</p><p><a href="${magicLinkUrl}">${magicLinkUrl}</a></p><p>Si te has registrado con Google o Facebook, puedes ignorar este enlace y simplemente volver a iniciar sesión con ese proveedor.</p>`,
  }, locale)
  await send({ to, ...tmpl })
}

export async function sendSignupRejectedEmail(to, { displayName, reason, locale = 'es' } = {}) {
  const namePrefix  = displayName ? ' ' + displayName : ''
  const reasonBlock = reason ? ` Motivo: ${reason}.` : ''
  const tmpl = await compose('auth.signup.rejected', { namePrefix, reasonBlock }, {
    subject: 'Tu solicitud no ha sido aprobada',
    text: `Hola${namePrefix},\n\nLamentamos comunicarte que tu solicitud de alta no ha sido aprobada.${reasonBlock}\n\nSi crees que se trata de un error o quieres volver a solicitarlo más adelante, contacta con el equipo.`,
    html: `<p>Hola${namePrefix},</p><p>Lamentamos comunicarte que tu solicitud de alta no ha sido aprobada.${reasonBlock}</p><p>Si crees que se trata de un error o quieres volver a solicitarlo más adelante, contacta con el equipo.</p>`,
  }, locale)
  await send({ to, ...tmpl })
}

// Enviado tras POST /v1/tenants/bootstrap. Incluye el magic-link que el
// owner abrirá en su portal (subdomain.hulkstein.com/activate?token=...).
export async function sendTenantBootstrapEmail(to, { ownerDisplayName, magicLinkUrl, expiresAt, appDisplayName, tenantDisplayName, locale = 'es' }) {
  const namePrefix = ownerDisplayName ? ' ' + ownerDisplayName : ''
  const expiresStr = expiresAt ? new Date(expiresAt).toLocaleString(intlLocale(locale), { timeZone: 'Europe/Madrid' }) : ''
  const appLabel    = appDisplayName    ?? (locale === 'en' ? 'the platform' : 'la plataforma')
  const tenantLabel = tenantDisplayName ?? appLabel
  const tmpl = await compose('tenant.bootstrap_started', {
    namePrefix, magicLinkUrl, expiresStr, appLabel, tenantLabel,
  }, locale === 'en' ? {
    subject: `Welcome to ${appLabel} — activate your account`,
    text: `Hi${namePrefix},\n\nYour account for ${tenantLabel} on ${appLabel} is ready. Click the link below to set a password and start using it (valid until ${expiresStr}):\n\n${magicLinkUrl}\n\nIf you didn't expect this email, you can ignore it.`,
    html: `<p>Hi${namePrefix},</p><p>Your account for <strong>${tenantLabel}</strong> on <strong>${appLabel}</strong> is ready. Click the link below to set a password and start using it (valid until ${expiresStr}):</p><p><a href="${magicLinkUrl}">${magicLinkUrl}</a></p><p>If you didn't expect this email, you can ignore it.</p>`,
  } : {
    subject: `Bienvenido a ${appLabel} — activa tu cuenta`,
    text: `Hola${namePrefix},\n\nTu cuenta de ${tenantLabel} en ${appLabel} ya está lista. Pulsa el enlace para fijar tu contraseña y empezar a usarla (válido hasta ${expiresStr}):\n\n${magicLinkUrl}\n\nSi no esperabas este email, puedes ignorarlo.`,
    html: `<p>Hola${namePrefix},</p><p>Tu cuenta de <strong>${tenantLabel}</strong> en <strong>${appLabel}</strong> ya está lista. Pulsa el enlace para fijar tu contraseña y empezar a usarla (válido hasta ${expiresStr}):</p><p><a href="${magicLinkUrl}">${magicLinkUrl}</a></p><p>Si no esperabas este email, puedes ignorarlo.</p>`,
  })
  await send({ to, ...tmpl })
}

// Enviado tras consumir el magic-link. Email corto de bienvenida + tip
// para el siguiente paso del onboarding (Fase B).
export async function sendTenantActivatedEmail(to, { locale = 'es' } = {}) {
  const tmpl = await compose('tenant.activated', {}, locale === 'en' ? {
    subject: 'Your account is active — set up your workspace',
    text: 'Welcome! Your account is now active. Open the dashboard to finish configuring your workspace and invite your team.',
    html: '<p>Welcome!</p><p>Your account is now active. Open the dashboard to finish configuring your workspace and invite your team.</p>',
  } : {
    subject: 'Tu cuenta está activa — termina la configuración',
    text: '¡Bienvenido! Tu cuenta está activa. Entra al panel para terminar de configurar tu espacio e invitar a tu equipo.',
    html: '<p>¡Bienvenido!</p><p>Tu cuenta está activa. Entra al panel para terminar de configurar tu espacio e invitar a tu equipo.</p>',
  })
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

export async function sendBasketAbandonedEmail(to, { itemCount, locale = 'es' }) {
  const itemNoun = locale === 'en'
    ? (itemCount === 1 ? 'item' : 'items')
    : (itemCount === 1 ? 'artículo' : 'artículos')
  const tmpl = await compose('basket.abandoned', { itemCount, itemNoun }, {
    subject: locale === 'en'
      ? `Your basket is waiting (${itemCount} ${itemNoun})`
      : `Tu carrito te espera (${itemCount} ${itemNoun})`,
    text: locale === 'en'
      ? `Hi,\n\nYou left ${itemCount} ${itemNoun} in your basket. Pick up where you left off whenever you want.`
      : `Hola,\n\nDejaste ${itemCount} ${itemNoun} en tu carrito. Cuando quieras, retoma la compra.`,
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
