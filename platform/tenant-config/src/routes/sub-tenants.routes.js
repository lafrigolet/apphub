import { z } from 'zod'
import { requireRole } from '@apphub/platform-sdk/app-guard'
import * as subTenantsService from '../services/sub-tenants.service.js'

// Writes are staff-gated like the rest of the registry. Reads stay open to any
// authenticated user (the shell lists a tenant's sub-tenants).
const writeGuard = requireRole('super_admin', 'staff')

const createBody = z.object({
  displayName: z.string().min(1).max(128),
  slug:        z.string().min(1).max(64).regex(/^[a-z0-9-]+$/, 'slug must be kebab-case'),
})

const updateBody = z.object({
  displayName: z.string().min(1).max(128).optional(),
  slug:        z.string().min(1).max(64).regex(/^[a-z0-9-]+$/, 'slug must be kebab-case').optional(),
  status:      z.enum(['active', 'suspended', 'archived']).optional(),
})

function actorFromRequest(req) {
  return {
    userId: req.identity?.userId ?? null,
    role:   req.identity?.role   ?? null,
    ip:     req.ip               ?? null,
  }
}

export async function subTenantsRoutes(fastify) {
  fastify.get('/v1/tenants/:tenantId/sub-tenants', {
    schema: {
      tags: ['sub-tenants'],
      summary: 'List sub-tenants of a tenant',
      params: { type: 'object', properties: { tenantId: { type: 'string' } }, required: ['tenantId'] },
    },
  }, async (req) => {
    return subTenantsService.listSubTenants(req.params.tenantId)
  })

  fastify.get('/v1/tenants/:tenantId/sub-tenants/:id', {
    schema: {
      tags: ['sub-tenants'],
      summary: 'Get a single sub-tenant',
      params: {
        type: 'object',
        properties: { tenantId: { type: 'string' }, id: { type: 'string' } },
        required: ['tenantId', 'id'],
      },
    },
  }, async (req) => {
    return subTenantsService.getSubTenant(req.params.tenantId, req.params.id)
  })

  fastify.post('/v1/tenants/:tenantId/sub-tenants', {
    preHandler: writeGuard,
    schema: {
      tags: ['sub-tenants'],
      summary: 'Create a sub-tenant under a tenant',
      params: { type: 'object', properties: { tenantId: { type: 'string' } }, required: ['tenantId'] },
      body: {
        type: 'object',
        properties: { displayName: { type: 'string' }, slug: { type: 'string' } },
        required: ['displayName', 'slug'],
      },
    },
  }, async (req, reply) => {
    const body = createBody.parse(req.body)
    const sub = await subTenantsService.createSubTenant(req.params.tenantId, body, actorFromRequest(req))
    return reply.status(201).send(sub)
  })

  fastify.patch('/v1/tenants/:tenantId/sub-tenants/:id', {
    preHandler: writeGuard,
    schema: {
      tags: ['sub-tenants'],
      summary: 'Update a sub-tenant',
      params: {
        type: 'object',
        properties: { tenantId: { type: 'string' }, id: { type: 'string' } },
        required: ['tenantId', 'id'],
      },
      body: {
        type: 'object',
        properties: {
          displayName: { type: 'string' },
          slug:        { type: 'string' },
          status:      { type: 'string', enum: ['active', 'suspended', 'archived'] },
        },
      },
    },
  }, async (req) => {
    const body = updateBody.parse(req.body)
    return subTenantsService.updateSubTenant(req.params.tenantId, req.params.id, body, actorFromRequest(req))
  })

  fastify.delete('/v1/tenants/:tenantId/sub-tenants/:id', {
    preHandler: writeGuard,
    schema: {
      tags: ['sub-tenants'],
      summary: 'Delete a sub-tenant',
      params: {
        type: 'object',
        properties: { tenantId: { type: 'string' }, id: { type: 'string' } },
        required: ['tenantId', 'id'],
      },
    },
  }, async (req) => {
    return subTenantsService.deleteSubTenant(req.params.tenantId, req.params.id, actorFromRequest(req))
  })
}
