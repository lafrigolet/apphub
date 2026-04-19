import sgMail from '@sendgrid/mail'
import { env } from '../lib/env.js'
import { logger } from '../lib/logger.js'

if (env.YOGA_SENDGRID_API_KEY) {
  sgMail.setApiKey(env.YOGA_SENDGRID_API_KEY)
}

export async function sendEmail({ to, subject, text, html }) {
  if (!env.YOGA_SENDGRID_API_KEY) {
    logger.info({ to, subject }, '[DEV] Email not sent — no SendGrid API key configured')
    return
  }

  try {
    await sgMail.send({
      to,
      from: env.YOGA_SENDGRID_FROM_EMAIL,
      subject,
      text,
      html: html ?? text,
    })
    logger.info({ to, subject }, 'Email sent')
  } catch (err) {
    logger.error({ err, to, subject }, 'Failed to send email')
    throw err
  }
}
