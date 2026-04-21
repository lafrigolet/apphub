import { z } from 'zod'
import * as oauthService from '../services/oauth.service.js'

const googleBody = z.object({
  appId:       z.string().min(1),
  tenantId:    z.string().uuid(),
  subTenantId: z.string().uuid().optional(),
  credential:  z.string().min(1),
})

const facebookBody = z.object({
  appId:        z.string().min(1),
  tenantId:     z.string().uuid(),
  subTenantId:  z.string().uuid().optional(),
  accessToken:  z.string().min(1),
})

export async function oauthRoutes(fastify) {
  fastify.post('/google', { schema: { body: googleBody }, config: { public: true } }, async (req, reply) => {
    const result = await oauthService.loginWithGoogle(req.body)
    return reply.send({ data: result })
  })

  fastify.post('/facebook', { schema: { body: facebookBody }, config: { public: true } }, async (req, reply) => {
    const result = await oauthService.loginWithFacebook(req.body)
    return reply.send({ data: result })
  })
}
