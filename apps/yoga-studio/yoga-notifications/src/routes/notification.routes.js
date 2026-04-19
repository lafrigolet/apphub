import { z } from 'zod'
import { pool } from '../lib/db.js'
import { sendEmail } from '../services/mailer.js'
import { requireRole } from '../plugins/auth.js'
import { logger } from '../lib/logger.js'

const broadcastBody = z.object({
  subject: z.string().min(1),
  text: z.string().min(1),
  segment: z.enum(['all', 'active_bonus']).default('all'),
})

export async function notificationRoutes(fastify) {
  fastify.post('/broadcast', {
    schema: { body: broadcastBody },
    preHandler: requireRole('admin'),
  }, async (req, reply) => {
    const { subject, text, segment } = req.body

    const client = await pool.connect()
    let emails = []
    try {
      const { rows } = await client.query(
        segment === 'all'
          ? `SELECT DISTINCT u.email FROM yoga_auth.users u WHERE u.email IS NOT NULL`
          : `SELECT DISTINCT u.email FROM yoga_auth.users u
             JOIN yoga_bonuses.bonuses b ON b.user_id = u.id
             WHERE b.is_active = true AND b.expires_at >= CURRENT_DATE`,
      )
      emails = rows.map((r) => r.email)
    } finally {
      client.release()
    }

    // Fire and forget (background sends)
    setImmediate(async () => {
      for (const to of emails) {
        try {
          await sendEmail({ to, subject, text })
        } catch (err) {
          logger.error({ err, to }, 'Broadcast send failed')
        }
      }
    })

    return reply.send({ data: { queued: emails.length } })
  })
}
