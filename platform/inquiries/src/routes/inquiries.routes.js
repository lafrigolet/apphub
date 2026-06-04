import { z } from 'zod'
import { requireRole } from '@apphub/platform-sdk/app-guard'
import { generateReference } from '../lib/reference.js'
import * as service         from '../services/inquiries.service.js'
import * as settingsService from '../services/settings.service.js'

// Body POST público — campos críticos del form de cualquier app. metadata
// queda libre para que cada app meta lo que quiera (campo del subject
// dropdown, hash anti-CSRF de la app, etc.).
const createBody = z.object({
  appId:        z.string().min(1).max(64),
  tenantId:     z.string().uuid(),
  subTenantId:  z.string().uuid().optional().nullable(),
  contactName:  z.string().min(1).max(128),
  email:        z.string().email().max(256),
  phone:        z.string().max(32).optional().nullable(),
  subject:      z.string().max(256).optional().nullable(),
  message:      z.string().min(1).max(4000),
  source:       z.string().max(64).optional().nullable(),
  metadata:     z.record(z.unknown()).optional(),
  // Honeypot anti-bot: campo invisible en el form. Si llega relleno
  // respondemos 201 fake y descartamos sin persistir.
  website:      z.string().max(256).optional().nullable(),
})

const listQuery = z.object({
  status: z.enum(['new', 'contacted', 'closed', 'spam']).optional(),
  limit:  z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
})

const updateBody = z.object({
  status:     z.enum(['new', 'contacted', 'closed', 'spam']).optional(),
  staffNotes: z.string().max(4000).optional().nullable(),
})

const settingsBody = z.object({
  contactInboxEmail: z.string().email().max(256),
  replyToEmail:      z.string().email().max(256).optional().nullable(),
  userThanksSubject: z.string().max(256).optional().nullable(),
  userThanksBody:    z.string().max(4000).optional().nullable(),
})

export async function publicRoutes(fastify, opts) {
  const { redis } = opts ?? {}
  fastify.post(
    '/',
    {
      config: {
        public: true,
        // Override del rate-limit global: endpoint público sin auth, blanco
        // fácil de spam. 5 consultas/min por IP es de sobra para humanos.
        rateLimit: { max: 5, timeWindow: '1 minute' },
      },
      schema: {
        tags:    ['inquiries'],
        summary: 'Submit a new inquiry from the app contact form (public)',
        body:    createBody,
      },
    },
    async (req, reply) => {
      const { website, ...body } = createBody.parse(req.body ?? {})
      // Honeypot relleno → bot. 201 indistinguible del éxito real para no
      // dar señal al bot, pero no persistimos ni publicamos evento.
      if (website) {
        req.log?.warn?.({ ip: req.ip, appId: body.appId, tenantId: body.tenantId }, 'inquiry honeypot triggered — discarded')
        reply.code(201)
        return { data: { reference: generateReference(), id: crypto.randomUUID(), createdAt: new Date().toISOString() } }
      }
      const created = await service.create({ redis }, {
        ...body,
        ip:        req.ip,
        userAgent: req.headers['user-agent'],
      })
      reply.code(201)
      return { data: { reference: created.reference, id: created.id, createdAt: created.created_at } }
    },
  )
}

export async function adminRoutes(fastify) {
  fastify.addHook('preHandler', requireRole('owner', 'admin', 'staff', 'super_admin'))

  // settings van bajo /admin/settings — debe declararse ANTES de /:id
  // para que '/settings' no choque con el matcher uuid del :id.
  fastify.get(
    '/settings',
    { schema: { tags: ['inquiries · admin'], summary: 'Get tenant settings for inquiries' } },
    async (req) => ({ data: await settingsService.getForTenant(req.identity) }),
  )

  fastify.put(
    '/settings',
    { schema: { tags: ['inquiries · admin'], summary: 'Upsert tenant settings', body: settingsBody } },
    async (req) => {
      const body = settingsBody.parse(req.body ?? {})
      return { data: await settingsService.upsertForTenant(req.identity, body) }
    },
  )

  fastify.get(
    '/',
    { schema: { tags: ['inquiries · admin'], summary: 'List inquiries', querystring: listQuery } },
    async (req) => {
      const q = listQuery.parse(req.query ?? {})
      return { data: await service.listAdmin(req.identity, q) }
    },
  )

  fastify.get(
    '/:id',
    { schema: { tags: ['inquiries · admin'], summary: 'Get an inquiry by id' } },
    async (req) => ({ data: await service.getById(req.identity, req.params.id) }),
  )

  fastify.patch(
    '/:id',
    { schema: { tags: ['inquiries · admin'], summary: 'Update inquiry (status, staff_notes)', body: updateBody } },
    async (req) => {
      const body = updateBody.parse(req.body ?? {})
      return { data: await service.update(req.identity, req.params.id, body) }
    },
  )
}
