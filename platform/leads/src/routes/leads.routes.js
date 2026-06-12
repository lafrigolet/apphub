import { z } from 'zod'
import { requireRole } from '@apphub/platform-sdk/app-guard'
import * as service from '../services/leads.service.js'
import * as analytics from '../services/analytics.service.js'

const STATUSES = ['new', 'contacted', 'qualified', 'won', 'lost', 'closed']

const createBody = z.object({
  contactName:  z.string().min(1).max(128),
  email:        z.string().email().max(256),
  businessName: z.string().max(256).optional().nullable(),
  phone:        z.string().max(32).optional().nullable(),
  industry:     z.enum(['restaurant', 'gym', 'services', 'shop', 'other']).optional().nullable(),
  message:      z.string().max(4000).optional().nullable(),
  source:       z.string().max(64).optional().nullable(),
  // Atribución opcional: app/portal de origen + UTM + referrer.
  appId:        z.string().max(64).optional().nullable(),
  utmSource:    z.string().max(256).optional().nullable(),
  utmMedium:    z.string().max(256).optional().nullable(),
  utmCampaign:  z.string().max(256).optional().nullable(),
  utmTerm:      z.string().max(256).optional().nullable(),
  utmContent:   z.string().max(256).optional().nullable(),
  referrer:     z.string().max(2048).optional().nullable(),
  landingUrl:   z.string().max(2048).optional().nullable(),
  // Consentimiento LOPDGDD: texto y versión mostrados al usuario al captar.
  consentText:    z.string().max(2000).optional().nullable(),
  consentVersion: z.string().max(32).optional().nullable(),
  // Honeypot anti-bot: campo invisible en el form. Un humano lo deja vacío;
  // si llega relleno respondemos 201 fake y descartamos sin persistir.
  website:      z.string().max(256).optional().nullable(),
})

const listQuery = z.object({
  status:      z.enum(STATUSES).optional(),
  assignedTo:  z.union([z.string().uuid(), z.literal('me'), z.literal('none')]).optional(),
  industry:    z.enum(['restaurant', 'gym', 'services', 'shop', 'other']).optional(),
  source:      z.string().max(64).optional(),
  appId:       z.string().max(64).optional(),
  tag:         z.string().max(64).optional(),
  q:           z.string().max(256).optional(),
  followUpDue: z.coerce.boolean().optional(),
  createdFrom: z.coerce.date().optional(),
  createdTo:   z.coerce.date().optional(),
  sort:        z.enum(['created_at', 'updated_at', 'score', 'next_follow_up_at']).default('created_at'),
  dir:         z.enum(['asc', 'desc']).default('desc'),
  limit:       z.coerce.number().int().min(1).max(500).default(100),
  offset:      z.coerce.number().int().min(0).default(0),
})

const updateBody = z.object({
  status:         z.enum(STATUSES).optional(),
  staffNotes:     z.string().max(4000).optional().nullable(),    // legacy
  assignedTo:     z.string().uuid().optional().nullable(),
  score:          z.number().int().min(0).max(100).optional().nullable(),
  lostReason:     z.string().max(512).optional().nullable(),
  tags:           z.array(z.string().max(64)).max(32).optional(),
  customFields:   z.record(z.unknown()).optional().nullable(),
  nextFollowUpAt: z.coerce.date().optional().nullable(),
}).refine((b) => b.status !== 'lost' || !!b.lostReason, {
  message: 'lostReason is required when status is lost',
  path: ['lostReason'],
})

const activityBody = z.object({
  type: z.enum(['note', 'email', 'call', 'meeting']),
  body: z.string().min(1).max(8000),
})

const activitiesQuery = z.object({
  limit:  z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
})

const convertBody = z.object({
  tenantId: z.string().uuid(),
})

// ── Analítica ────────────────────────────────────────────────────────────
const rangeQuery = z.object({
  createdFrom: z.coerce.date().optional(),
  createdTo:   z.coerce.date().optional(),
})
const dimensionQuery = rangeQuery.extend({
  dimension: z.enum(['source', 'app_id', 'industry', 'utm_source', 'utm_campaign']).default('source'),
})
const timeseriesQuery = rangeQuery.extend({
  granularity: z.enum(['day', 'week', 'month']).default('day'),
})

export async function publicRoutes(fastify) {
  fastify.post(
    '/',
    {
      config: {
        public: true,
        // Override del rate-limit global: endpoint público sin auth, blanco
        // fácil de spam. 5 leads/min por IP es de sobra para humanos.
        rateLimit: { max: 5, timeWindow: '1 minute' },
      },
      schema: {
        tags: ['leads'],
        summary: 'Submit a new lead from the public landing form',
        body: createBody,
      },
    },
    async (req, reply) => {
      const { website, ...body } = createBody.parse(req.body ?? {})
      // Honeypot relleno → bot. 201 indistinguible del éxito real para no
      // dar señal al bot, pero no persistimos ni publicamos evento.
      if (website) {
        req.log?.warn?.({ ip: req.ip, source: body.source }, 'lead honeypot triggered — discarded')
        reply.code(201)
        return { data: { id: crypto.randomUUID(), status: 'new' } }
      }
      const lead = await service.create({
        ...body,
        ip:        req.ip,
        userAgent: req.headers['user-agent'],
      })
      reply.code(201)
      return { data: lead }
    },
  )
}

export async function adminRoutes(fastify) {
  fastify.addHook('preHandler', requireRole('super_admin', 'staff'))

  const actor = (req) => ({ userId: req.identity?.userId, email: req.identity?.email })

  fastify.get(
    '/',
    { schema: { tags: ['leads-admin'], summary: 'List leads (filters + search)', querystring: listQuery } },
    async (req) => {
      const q = listQuery.parse(req.query ?? {})
      // 'me' → bandeja del staff autenticado.
      if (q.assignedTo === 'me') q.assignedTo = req.identity?.userId
      return { data: await service.listLeads(q) }
    },
  )

  fastify.get(
    '/:id',
    { schema: { tags: ['leads-admin'], summary: 'Get a lead by id' } },
    async (req, reply) => {
      const lead = await service.getById(req.params.id)
      if (!lead) { reply.code(404); return { error: { code: 'NOT_FOUND' } } }
      return { data: lead }
    },
  )

  fastify.patch(
    '/:id',
    {
      schema: {
        tags: ['leads-admin'],
        summary: 'Update lead (status, assignment, score, tags, follow-up, notes)',
        body: updateBody,
      },
    },
    async (req, reply) => {
      const body = updateBody.parse(req.body ?? {})
      const updated = await service.update(req.params.id, body, actor(req))
      if (!updated) { reply.code(404); return { error: { code: 'NOT_FOUND' } } }
      return { data: updated }
    },
  )

  // ── Timeline de actividad ──────────────────────────────────────────────

  fastify.get(
    '/:id/activities',
    { schema: { tags: ['leads-admin'], summary: 'List lead activity timeline', querystring: activitiesQuery } },
    async (req, reply) => {
      const q = activitiesQuery.parse(req.query ?? {})
      const rows = await service.listActivities(req.params.id, q)
      if (rows === null) { reply.code(404); return { error: { code: 'NOT_FOUND' } } }
      return { data: rows }
    },
  )

  fastify.post(
    '/:id/activities',
    { schema: { tags: ['leads-admin'], summary: 'Add an activity (note/call/email/meeting)', body: activityBody } },
    async (req, reply) => {
      const body = activityBody.parse(req.body ?? {})
      const created = await service.addActivity(req.params.id, body, actor(req))
      if (!created) { reply.code(404); return { error: { code: 'NOT_FOUND' } } }
      reply.code(201)
      return { data: created }
    },
  )

  // ── Conversión lead → tenant ───────────────────────────────────────────

  fastify.post(
    '/:id/convert',
    { schema: { tags: ['leads-admin'], summary: 'Mark lead as converted to a tenant (traceability)', body: convertBody } },
    async (req, reply) => {
      const { tenantId } = convertBody.parse(req.body ?? {})
      const result = await service.convert(req.params.id, tenantId, actor(req))
      if (!result) { reply.code(404); return { error: { code: 'NOT_FOUND' } } }
      if (result.conflict) {
        reply.code(409)
        return { error: { code: 'ALREADY_CONVERTED', message: 'Lead is already linked to a tenant' } }
      }
      return { data: result.lead }
    },
  )

  // ── Analítica / reporting ──────────────────────────────────────────────

  fastify.get(
    '/analytics/funnel',
    { schema: { tags: ['leads-admin'], summary: 'Funnel: status counts + stage milestones/timing', querystring: rangeQuery } },
    async (req) => {
      const range = rangeQuery.parse(req.query ?? {})
      return { data: await analytics.funnel(range) }
    },
  )

  fastify.get(
    '/analytics/by-dimension',
    { schema: { tags: ['leads-admin'], summary: 'Leads + won/lost grouped by source/app/industry/utm', querystring: dimensionQuery } },
    async (req) => {
      const { dimension, ...range } = dimensionQuery.parse(req.query ?? {})
      return { data: await analytics.byDimension(dimension, range) }
    },
  )

  fastify.get(
    '/analytics/by-owner',
    { schema: { tags: ['leads-admin'], summary: 'Productivity per assigned staff owner', querystring: rangeQuery } },
    async (req) => {
      const range = rangeQuery.parse(req.query ?? {})
      return { data: await analytics.byOwner(range) }
    },
  )

  fastify.get(
    '/analytics/timeseries',
    { schema: { tags: ['leads-admin'], summary: 'Created vs won leads bucketed by day/week/month', querystring: timeseriesQuery } },
    async (req) => {
      const { granularity, ...range } = timeseriesQuery.parse(req.query ?? {})
      return { data: await analytics.timeseries(granularity, range) }
    },
  )

  fastify.get(
    '/analytics/export.csv',
    { schema: { tags: ['leads-admin'], summary: 'Export filtered leads as CSV', querystring: listQuery } },
    async (req, reply) => {
      const q = listQuery.parse(req.query ?? {})
      if (q.assignedTo === 'me') q.assignedTo = req.identity?.userId
      const csv = await analytics.exportCsv(q)
      reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', 'attachment; filename="leads-export.csv"')
      return csv
    },
  )

  // ── GDPR — borrado físico ──────────────────────────────────────────────

  fastify.delete(
    '/:id',
    { schema: { tags: ['leads-admin'], summary: 'Delete a lead and its activities (GDPR erasure)' } },
    async (req, reply) => {
      const removed = await service.removeLead(req.params.id, actor(req))
      if (!removed) { reply.code(404); return { error: { code: 'NOT_FOUND' } } }
      reply.code(204)
    },
  )
}
