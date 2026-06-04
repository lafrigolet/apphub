// Best-effort sink hacia platform_notifications.send_log.
//
// Lo llaman los tres senders (email/sms/push) tras cada intento. NUNCA
// propaga errores — un fallo al registrar no debe tumbar el envío (ni el
// envío fallar dos veces por culpa del log). En NODE_ENV='test' es no-op:
// las suites mockean los providers, no la DB, y no queremos escrituras
// reales desde tests unitarios.
import { env } from '../lib/env.js'
import { pool } from '../lib/db.js'
import { logger } from '../lib/logger.js'
import * as sendLogRepo from '../repositories/send-log.repository.js'

export async function logSend({ appId, tenantId, userId, channel, template, recipient, status, error }) {
  if (env.NODE_ENV === 'test') return
  let client
  try {
    client = await pool.connect()
    await sendLogRepo.insert(client, {
      appId, tenantId, userId, channel,
      template:  template ?? 'raw',
      recipient: recipient ?? 'unknown',
      status,
      // Trunca: error puede ser un body entero de Twilio/FCM.
      error: error ? String(error).slice(0, 2000) : null,
    })
  } catch (err) {
    logger.error({ err, channel, template, status }, 'failed to write send_log')
  } finally {
    client?.release()
  }
}
