import { z } from 'zod'
import { requireRole } from '@apphub/platform-sdk/app-guard'
import * as configRepo from '../repositories/config.repository.js'
import * as tmplRepo from '../repositories/templates.repository.js'
import { renderString } from '../services/template-renderer.js'
import { sendTestSms, invalidateSmsConfigCache } from '../services/sms.service.js'
import { invalidateConfigCache as invalidateEmailConfigCache } from '../services/email.service.js'
import { invalidateRateLimitCache } from '../services/rate-limit.service.js'
import { pool } from '../lib/db.js'

const configBody = z.object({
  sendgrid_api_key:             z.string().min(1).max(2048).optional().nullable(),
  sender_email:                 z.string().email().optional().nullable(),
  sender_name:                  z.string().max(256).optional().nullable(),
  twilio_account_sid:           z.string().min(1).max(64).optional().nullable(),
  twilio_api_key_sid:           z.string().min(1).max(64).optional().nullable(),
  twilio_api_key_secret:        z.string().min(1).max(2048).optional().nullable(),
  twilio_messaging_service_sid: z.string().min(1).max(64).optional().nullable(),
  twilio_default_sender:        z.string().min(1).max(32).optional().nullable(),
  // Per-user rate limit caps. Numeric strings (or null/empty for unlimited).
  rate_limit_per_user_per_hour: z.string().max(8).optional().nullable(),
  rate_limit_per_user_per_day:  z.string().max(8).optional().nullable(),
  // Digest mode: 'off' (default — send each event immediately) or 'daily'
  // (buffer non-urgent events into one composed email per user per day).
  digest_mode:                  z.enum(['off', 'daily']).optional().nullable(),
})

const smsTestBody = z.object({
  to:   z.string().min(8).max(32),
  body: z.string().min(1).max(320).optional().nullable(),
})

const templateBody = z.object({
  key:       z.string().min(1).max(128).optional(),
  channel:   z.enum(['email', 'sms', 'push']).optional(),
  // BCP-47-ish short tag (e.g. 'es', 'en', 'ca'). Defaults to 'es' on insert.
  locale:    z.string().min(2).max(8).optional(),
  subject:   z.string().max(512).optional().nullable(),
  body_text: z.string().min(1).max(20000).optional(),
  body_html: z.string().max(40000).optional().nullable(),
  variables: z.array(z.string()).optional(),
  enabled:   z.boolean().optional(),
})

const cfgTags = ['notifications · admin']
const tmplTags = ['notifications · templates']

export async function adminRoutes(fastify) {
  fastify.addHook('preHandler', requireRole('super_admin', 'staff'))

  // ── Module config (SendGrid + Twilio credentials, sender identity) ───────
  fastify.get('/config', {
    schema: { tags: cfgTags, summary: 'List notifications module config (SendGrid + Twilio)' },
  }, async () => {
    const client = await pool.connect()
    try { return { data: await configRepo.listConfig(client) } } finally { client.release() }
  })

  fastify.patch('/config', {
    schema: {
      tags: cfgTags,
      summary: 'Upsert notifications module config',
      body: configBody,
    },
  }, async (req) => {
    const body = configBody.parse(req.body ?? {})
    const client = await pool.connect()
    try {
      for (const [key, value] of Object.entries(body)) {
        if (value === undefined) continue
        await configRepo.upsertValue(client, key, value)
      }
      // Drop sender + rate-limit caches so the next send picks up new
      // credentials/limits without waiting 30s.
      invalidateEmailConfigCache()
      invalidateSmsConfigCache()
      invalidateRateLimitCache()
      const { invalidateDigestModeCache } = await import('../services/digest.service.js')
      invalidateDigestModeCache()
      return { data: await configRepo.listConfig(client) }
    } finally { client.release() }
  })

  // POST /v1/notifications/admin/sms/test  { to, body? }
  // Smoke test for the Twilio config; returns the message SID on success or
  // { stub: true } when no credentials are configured (logs to stdout).
  fastify.post('/sms/test', {
    schema: {
      tags: cfgTags,
      summary: 'Send a one-shot test SMS via Twilio (or stub-log when not configured)',
      body: smsTestBody,
    },
  }, async (req) => {
    const { to, body } = smsTestBody.parse(req.body ?? {})
    return { data: await sendTestSms(to, body) }
  })

  // ── Templates ────────────────────────────────────────────────
  fastify.get('/templates', {
    schema: { tags: tmplTags, summary: 'List notification templates' },
  }, async () => {
    const client = await pool.connect()
    try { return { data: await tmplRepo.list(client) } } finally { client.release() }
  })

  fastify.get('/templates/:id', {
    schema: { tags: tmplTags, summary: 'Get a notification template by id' },
  }, async (req, reply) => {
    const client = await pool.connect()
    try {
      const t = await tmplRepo.findById(client, req.params.id)
      if (!t) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'template not found' } })
      return { data: t }
    } finally { client.release() }
  })

  fastify.post('/templates', {
    schema: { tags: tmplTags, summary: 'Create a notification template', body: templateBody },
  }, async (req, reply) => {
    const body = templateBody.parse(req.body ?? {})
    if (!body.key || !body.body_text) {
      return reply.code(400).send({ error: { code: 'VALIDATION', message: 'key and body_text required' } })
    }
    const client = await pool.connect()
    try { return reply.code(201).send({ data: await tmplRepo.insert(client, body) }) }
    finally { client.release() }
  })

  fastify.patch('/templates/:id', {
    schema: { tags: tmplTags, summary: 'Update a notification template', body: templateBody },
  }, async (req, reply) => {
    const body = templateBody.parse(req.body ?? {})
    const client = await pool.connect()
    try {
      const t = await tmplRepo.update(client, req.params.id, body)
      if (!t) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'template not found' } })
      return { data: t }
    } finally { client.release() }
  })

  fastify.delete('/templates/:id', {
    schema: { tags: tmplTags, summary: 'Delete a notification template' },
  }, async (req, reply) => {
    const client = await pool.connect()
    try {
      await tmplRepo.remove(client, req.params.id)
      return reply.code(204).send()
    } finally { client.release() }
  })

  // ── Supported locales ────────────────────────────────────────
  fastify.get('/locales', {
    schema: {
      tags: cfgTags,
      summary: 'List supported notification locales (frontend uses this for dropdowns)',
    },
  }, async () => {
    const client = await pool.connect()
    try {
      const { rows } = await client.query(
        `SELECT locale, label, enabled, updated_at
           FROM platform_notifications.supported_locales
          ORDER BY locale`,
      )
      return { data: rows }
    } finally { client.release() }
  })

  // Renders a template with the supplied vars and returns the rendered
  // strings — useful for previewing edits before saving / sending.
  fastify.post('/templates/:id/preview', {
    schema: { tags: tmplTags, summary: 'Render a template with the supplied variables' },
  }, async (req, reply) => {
    const client = await pool.connect()
    try {
      const t = await tmplRepo.findById(client, req.params.id)
      if (!t) return reply.code(404).send({ error: { code: 'NOT_FOUND' } })
      const vars = req.body?.vars ?? {}
      return { data: { subject: renderString(t.subject, vars), text: renderString(t.body_text, vars), html: renderString(t.body_html, vars) } }
    } finally { client.release() }
  })
}
