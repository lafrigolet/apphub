import { z } from 'zod'
import * as appsService from '../services/apps.service.js'

const createAppBody = z.object({
  appId:           z.string().min(1).max(64),
  displayName:     z.string().min(1).max(128),
  subdomain:       z.string().min(1).max(64),
  jwtAudience:     z.string().min(1).max(64),
  splitpayEnabled: z.boolean().optional(),
})

const statusBody = z.object({
  status: z.enum(['active', 'suspended']),
})

const splitpayBody = z.object({
  enabled: z.boolean(),
})

export async function appsRoutes(fastify) {
  fastify.get('/v1/apps', async () => {
    return appsService.listApps()
  })

  fastify.get('/v1/apps/:appId', async (req) => {
    return appsService.getApp(req.params.appId)
  })

  fastify.post('/v1/apps', async (req, reply) => {
    const body = createAppBody.parse(req.body)
    const app = await appsService.createApp(body)
    return reply.status(201).send(app)
  })

  fastify.patch('/v1/apps/:appId/status', async (req) => {
    const { status } = statusBody.parse(req.body)
    return appsService.setAppStatus(req.params.appId, status)
  })

  fastify.patch('/v1/apps/:appId/splitpay', async (req) => {
    const { enabled } = splitpayBody.parse(req.body)
    return appsService.setAppSplitpayEnabled(req.params.appId, enabled)
  })
}
