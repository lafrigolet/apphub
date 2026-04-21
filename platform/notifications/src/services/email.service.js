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
