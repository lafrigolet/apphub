import { z } from 'zod'
import { requireRole } from '@apphub/platform-sdk/app-guard'
import { generateReference } from '../lib/reference.js'
import * as service         from '../services/inquiries.service.js'
import * as settingsService from '../services/settings.service.js'

// Body POST público — campos críticos del form de cualquier app. metadata
// queda libre para que cada app meta lo que quiera (campo del subject
// dropdown, hash anti-CSRF de la app, etc.).
const createBody = z.object({
  appId:          z.string().min(1).max(64),
  tenantId:       z.string().uuid(),
  subTenantId:    z.string().uuid().optional().nullable(),
  contactName:    z.string().min(1).max(128),
  email:          z.string().email().max(256),
  phone:          z.string().max(32).optional().nullable(),
  subject:        z.string().max(256).optional().nullable(),
  message:        z.string().min(1).max(4000),
  source:         z.string().max(64).optional().nullable(),
  category:       z.string().max(64).optional().nullable(),
  metadata:       z.record(z.unknown()).optional(),
  // Consentimiento LOPDGDD/GDPR: texto + versión mostrados al visitante.
  consentText:    z.string().max(4000).optional().nullable(),
  consentVersion: z.string().max(64).optional().nullable(),
  // Honeypot anti-bot: campo invisible en el form. Si llega relleno
  // respondemos 201 fake y descartamos sin persistir.
  website:        z.string().max(256).optional().nullable(),
})

// CSAT público — el visitante puntúa la atención. Se autentica con la
// referencia + el email con que envió la consulta (capability check); sin JWT.
const csatBody = z.object({
  appId:     z.string().min(1).max(64),
  tenantId:  z.string().uuid(),
  reference: z.string().min(1).max(64),
  email:     z.string().email().max(256),
  score:     z.coerce.number().int().min(1).max(5),
  comment:   z.string().max(2000).optional().nullable(),
})

const listQuery = z.object({
  status:      z.enum(['new', 'contacted', 'resolved', 'closed', 'spam']).optional(),
  source:      z.string().max(64).optional(),
  category:    z.string().max(64).optional(),
  email:       z.string().max(256).optional(),
  // 'me' = mis consultas, 'none' = sin asignar, o un userId concreto.
  assignedTo:  z.string().max(64).optional(),
  createdFrom: z.string().datetime().optional(),
  createdTo:   z.string().datetime().optional(),
  q:           z.string().max(256).optional(),
  limit:       z.coerce.number().int().min(1).max(500).default(100),
  offset:      z.coerce.number().int().min(0).default(0),
})

const updateBody = z.object({
  status:      z.enum(['new', 'contacted', 'resolved', 'closed', 'spam']).optional(),
  staffNotes:  z.string().max(4000).optional().nullable(),
  closeReason: z.string().max(256).optional().nullable(),
})

const assignBody = z.object({
  assignedTo: z.string().uuid().optional().nullable(),
})

const noteBody = z.object({
  body: z.string().min(1).max(4000),
})

const activitiesQuery = z.object({
  limit:  z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
})

const analyticsQuery = z.object({
  createdFrom: z.string().datetime().optional(),
  createdTo:   z.string().datetime().optional(),
})

const settingsBody = z.object({
  contactInboxEmail: z.string().email().max(256),
  replyToEmail:      z.string().email().max(256).optional().nullable(),
  userThanksSubject: z.string().max(256).optional().nullable(),
  userThanksBody:    z.string().max(4000).optional().nullable(),
  retentionDays:     z.coerce.number().int().min(1).max(3650).optional().nullable(),
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

  // CSAT del visitante (#10/#15) — público, capability check reference+email.
  // Rate-limit propio igual que el alta: blanco de spam sin auth.
  fastify.post(
    '/csat',
    {
      config: {
        public: true,
        rateLimit: { max: 5, timeWindow: '1 minute' },
      },
      schema: {
        tags:    ['inquiries'],
        summary: 'Submit a CSAT score for a resolved/closed inquiry (public, reference + email)',
        body:    csatBody,
      },
    },
    async (req) => {
      const body = csatBody.parse(req.body ?? {})
      return { data: await service.submitCsat({ redis }, body) }
    },
  )
}

export async function adminRoutes(fastify, opts) {
  const { redis } = opts ?? {}
  fastify.addHook('preHandler', requireRole('owner', 'admin', 'staff', 'super_admin'))
  // Inyecta redis en identity para que los servicios publiquen eventos sin
  // tocar otro pool/módulo. (req.identity lo crea appGuard.)
  fastify.addHook('preHandler', async (req) => { if (req.identity) req.identity.redis = redis })

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

  // Analítica agregada — antes de /:id por el mismo motivo que /settings.
  fastify.get(
    '/analytics',
    { schema: { tags: ['inquiries · admin'], summary: 'Aggregate analytics (volume, MTR, MTTR, spam rate, CSAT)', querystring: analyticsQuery } },
    async (req) => {
      const q = analyticsQuery.parse(req.query ?? {})
      return { data: await service.analytics(req.identity, q) }
    },
  )

  fastify.get(
    '/',
    { schema: { tags: ['inquiries · admin'], summary: 'List inquiries (search + combined filters)', querystring: listQuery } },
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
    { schema: { tags: ['inquiries · admin'], summary: 'Update inquiry (status, staff_notes, close_reason)', body: updateBody } },
    async (req) => {
      const body = updateBody.parse(req.body ?? {})
      return { data: await service.update(req.identity, req.params.id, body) }
    },
  )

  // Asignación a un miembro del staff (#8). assignedTo=null desasigna.
  fastify.put(
    '/:id/assignment',
    { schema: { tags: ['inquiries · admin'], summary: 'Assign / unassign an inquiry to a staff member', body: assignBody } },
    async (req) => {
      const body = assignBody.parse(req.body ?? {})
      return { data: await service.assign(req.identity, req.params.id, body.assignedTo ?? null) }
    },
  )

  // Notas internas con autoría (#3) — sustituye al staff_notes plano.
  fastify.get(
    '/:id/activities',
    { schema: { tags: ['inquiries · admin'], summary: 'List the activity timeline of an inquiry', querystring: activitiesQuery } },
    async (req) => {
      const q = activitiesQuery.parse(req.query ?? {})
      return { data: await service.listActivities(req.identity, req.params.id, q) }
    },
  )

  fastify.post(
    '/:id/notes',
    { schema: { tags: ['inquiries · admin'], summary: 'Add an internal note (authored) to an inquiry', body: noteBody } },
    async (req, reply) => {
      const body = noteBody.parse(req.body ?? {})
      reply.code(201)
      return { data: await service.addNote(req.identity, req.params.id, body.body) }
    },
  )

  // GDPR — supresión + anonimización (right to be forgotten).
  fastify.delete(
    '/:id',
    { schema: { tags: ['inquiries · admin'], summary: 'GDPR erasure — soft-delete + anonymize an inquiry' } },
    async (req) => ({ data: await service.remove(req.identity, req.params.id) }),
  )
}
