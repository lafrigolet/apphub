import { z } from 'zod'
import { requireRole } from '@apphub/platform-sdk/app-guard'
import * as service from '../services/leads.service.js'

const createBody = z.object({
  contactName:  z.string().min(1).max(128),
  email:        z.string().email().max(256),
  businessName: z.string().max(256).optional().nullable(),
  phone:        z.string().max(32).optional().nullable(),
  industry:     z.enum(['restaurant', 'gym', 'services', 'shop', 'other']).optional().nullable(),
  message:      z.string().max(4000).optional().nullable(),
  source:       z.string().max(64).optional().nullable(),
})

const listQuery = z.object({
  status: z.enum(['new', 'contacted', 'qualified', 'closed']).optional(),
  limit:  z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
})

const updateBody = z.object({
  status:     z.enum(['new', 'contacted', 'qualified', 'closed']),
  staffNotes: z.string().max(4000).optional().nullable(),
})

export async function publicRoutes(fastify) {
  fastify.post(
    '/',
    {
      config: { public: true },
      schema: {
        tags: ['leads'],
        summary: 'Submit a new lead from the public landing form',
        body: createBody,
      },
    },
    async (req, reply) => {
      const body = createBody.parse(req.body ?? {})
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

  fastify.get(
    '/',
    { schema: { tags: ['leads-admin'], summary: 'List leads', querystring: listQuery } },
    async (req) => {
      const q = listQuery.parse(req.query ?? {})
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
    { schema: { tags: ['leads-admin'], summary: 'Update lead status / staff notes', body: updateBody } },
    async (req, reply) => {
      const body = updateBody.parse(req.body ?? {})
      const updated = await service.setStatus(req.params.id, body.status, body.staffNotes)
      if (!updated) { reply.code(404); return { error: { code: 'NOT_FOUND' } } }
      return { data: updated }
    },
  )
}
