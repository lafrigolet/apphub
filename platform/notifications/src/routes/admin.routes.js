import { z } from 'zod'
import { requireRole } from '@apphub/platform-sdk/app-guard'
import * as configRepo from '../repositories/config.repository.js'
import * as tmplRepo from '../repositories/templates.repository.js'
import { renderString } from '../services/template-renderer.js'
import { pool } from '../lib/db.js'

const configBody = z.object({
  sendgrid_api_key: z.string().min(1).max(2048).optional().nullable(),
  sender_email:     z.string().email().optional().nullable(),
  sender_name:      z.string().max(256).optional().nullable(),
})

const templateBody = z.object({
  key:       z.string().min(1).max(128).optional(),
  channel:   z.enum(['email', 'sms', 'push']).optional(),
  subject:   z.string().max(512).optional().nullable(),
  body_text: z.string().min(1).max(20000).optional(),
  body_html: z.string().max(40000).optional().nullable(),
  variables: z.array(z.string()).optional(),
  enabled:   z.boolean().optional(),
})

export async function adminRoutes(fastify) {
  fastify.addHook('preHandler', requireRole('super_admin', 'staff'))

  // ── Module config (SendGrid API key, sender) ──────────────────
  fastify.get('/config', async () => {
    const client = await pool.connect()
    try { return { data: await configRepo.listConfig(client) } } finally { client.release() }
  })

  fastify.patch('/config', async (req) => {
    const body = configBody.parse(req.body ?? {})
    const client = await pool.connect()
    try {
      for (const [key, value] of Object.entries(body)) {
        if (value === undefined) continue
        await configRepo.upsertValue(client, key, value)
      }
      return { data: await configRepo.listConfig(client) }
    } finally { client.release() }
  })

  // ── Templates ────────────────────────────────────────────────
  fastify.get('/templates', async () => {
    const client = await pool.connect()
    try { return { data: await tmplRepo.list(client) } } finally { client.release() }
  })

  fastify.get('/templates/:id', async (req, reply) => {
    const client = await pool.connect()
    try {
      const t = await tmplRepo.findById(client, req.params.id)
      if (!t) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'template not found' } })
      return { data: t }
    } finally { client.release() }
  })

  fastify.post('/templates', async (req, reply) => {
    const body = templateBody.parse(req.body ?? {})
    if (!body.key || !body.body_text) {
      return reply.code(400).send({ error: { code: 'VALIDATION', message: 'key and body_text required' } })
    }
    const client = await pool.connect()
    try { return reply.code(201).send({ data: await tmplRepo.insert(client, body) }) }
    finally { client.release() }
  })

  fastify.patch('/templates/:id', async (req, reply) => {
    const body = templateBody.parse(req.body ?? {})
    const client = await pool.connect()
    try {
      const t = await tmplRepo.update(client, req.params.id, body)
      if (!t) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'template not found' } })
      return { data: t }
    } finally { client.release() }
  })

  fastify.delete('/templates/:id', async (req, reply) => {
    const client = await pool.connect()
    try {
      await tmplRepo.remove(client, req.params.id)
      return reply.code(204).send()
    } finally { client.release() }
  })

  // Renders a template with the supplied vars and returns the rendered
  // strings — useful for previewing edits before saving / sending.
  fastify.post('/templates/:id/preview', async (req, reply) => {
    const client = await pool.connect()
    try {
      const t = await tmplRepo.findById(client, req.params.id)
      if (!t) return reply.code(404).send({ error: { code: 'NOT_FOUND' } })
      const vars = req.body?.vars ?? {}
      return { data: { subject: renderString(t.subject, vars), text: renderString(t.body_text, vars), html: renderString(t.body_html, vars) } }
    } finally { client.release() }
  })
}
