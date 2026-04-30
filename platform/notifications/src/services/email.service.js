import sgMail from '@sendgrid/mail'
import { env } from '../lib/env.js'
import { logger } from '../lib/logger.js'

const isDev = env.NODE_ENV === 'development' || env.SENDGRID_API_KEY === 'dev_no_sendgrid'

if (!isDev) {
  sgMail.setApiKey(env.SENDGRID_API_KEY)
}

async function send(msg) {
  if (isDev) {
    logger.info({ to: msg.to, subject: msg.subject }, '[dev] Email not sent — logged only')
    return
  }
  try {
    await sgMail.send(msg)
    logger.info({ to: msg.to, subject: msg.subject }, 'Email sent')
  } catch (err) {
    logger.error({ err, to: msg.to }, 'Failed to send email')
  }
}

export async function sendWelcomeEmail(to, appId) {
  await send({
    to,
    from: env.SENDGRID_FROM_EMAIL,
    subject: 'Bienvenido a AIKIKAN',
    text: `Hola,\n\nTu cuenta en ${appId} ha sido creada correctamente. ¡Bienvenido!\n\nEl equipo de AIKIKAN`,
    html: `<p>Hola,</p><p>Tu cuenta en <strong>${appId}</strong> ha sido creada correctamente. ¡Bienvenido!</p><p>El equipo de AIKIKAN</p>`,
  })
}

export async function sendPasswordResetEmail(to, resetUrl) {
  await send({
    to,
    from: env.SENDGRID_FROM_EMAIL,
    subject: 'Restablecer contraseña — AIKIKAN',
    text: `Haz clic en el siguiente enlace para restablecer tu contraseña (válido 1 hora):\n\n${resetUrl}\n\nSi no solicitaste este cambio, ignora este mensaje.`,
    html: `<p>Haz clic en el siguiente enlace para restablecer tu contraseña (válido 1 hora):</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>Si no solicitaste este cambio, ignora este mensaje.</p>`,
  })
}

// ── Reminder / expiry / SLA emails (driven by platform-scheduler events) ────

export async function sendBookingReminderEmail(to, { name, startsAt, window }) {
  const when = new Date(startsAt).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })
  const lead = window === 't_minus_24h' ? 'mañana' : 'en 2 horas'
  await send({
    to,
    from: env.SENDGRID_FROM_EMAIL,
    subject: `Recordatorio: tu cita es ${lead}`,
    text: `Hola${name ? ' ' + name : ''},\n\nTe recordamos que tienes una cita ${lead} (${when}).\n\nSi no puedes asistir, por favor cancela con antelación.`,
  })
}

export async function sendReservationReminderEmail(to, { name, reservedFor, partySize, window }) {
  const when = new Date(reservedFor).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })
  const lead = window === 't_minus_24h' ? 'mañana' : 'en 2 horas'
  await send({
    to,
    from: env.SENDGRID_FROM_EMAIL,
    subject: `Recordatorio: tu reserva es ${lead}`,
    text: `Hola${name ? ' ' + name : ''},\n\nTe recordamos tu reserva ${lead} (${when}) para ${partySize} personas.\n\nSi no puedes asistir, te agradeceríamos que canceles con antelación.`,
  })
}

export async function sendPackageExpiryEmail(to, { remainingSessions, expiresAt, window }) {
  const expires = new Date(expiresAt).toLocaleDateString('es-ES')
  const lead = window === 't_minus_30d' ? 'en 30 días' : 'en 7 días'
  await send({
    to,
    from: env.SENDGRID_FROM_EMAIL,
    subject: `Tu bono caduca ${lead}`,
    text: `Hola,\n\nTu bono caduca el ${expires} (${lead}). Te quedan ${remainingSessions} sesión(es) por usar.\n\nReserva ahora para no perderlas.`,
  })
}

export async function sendDisputeSlaInternalEmail(to, { disputeId, orderId, openedAt }) {
  await send({
    to,
    from: env.SENDGRID_FROM_EMAIL,
    subject: `[STAFF] Disputa sin respuesta del vendedor (>48h)`,
    text: `Disputa ${disputeId} sobre el pedido ${orderId} (abierta ${openedAt}) lleva más de 48 h sin respuesta del vendedor. Revisar y escalar.`,
  })
}
