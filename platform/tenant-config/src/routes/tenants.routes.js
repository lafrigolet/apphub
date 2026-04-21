import { z } from 'zod'
import * as tenantsService from '../services/tenants.service.js'

const createTenantBody = z.object({
  appId:       z.string().min(1),
  displayName: z.string().min(1).max(128),
  subdomain:   z.string().min(1).max(64),
})

const statusBody = z.object({
  status: z.enum(['active', 'suspended']),
})

export async function tenantsRoutes(fastify) {
  fastify.get('/v1/tenants', async (req) => {
    const appId = req.query.appId ?? null
    return tenantsService.listTenants(appId)
  })

  fastify.get('/v1/tenants/:id', async (req) => {
    return tenantsService.getTenant(req.params.id)
  })

  fastify.post('/v1/tenants', async (req, reply) => {
    const body = createTenantBody.parse(req.body)
    const tenant = await tenantsService.createTenant(body)
    return reply.status(201).send(tenant)
  })

  fastify.patch('/v1/tenants/:id/status', async (req) => {
    const { status } = statusBody.parse(req.body)
    return tenantsService.setTenantStatus(req.params.id, status)
  })
}
