import { z } from 'zod'
import * as oauthService from '../services/oauth.service.js'

// Colapso 1 app → 1 tenant: tenantId opcional (se deriva del app);
// subTenantId reservado (no se acepta).
const googleBody = z.object({
  appId:       z.string().min(1),
  tenantId:    z.string().uuid().optional(),
  credential:  z.string().min(1),
})

const facebookBody = z.object({
  appId:        z.string().min(1),
  tenantId:     z.string().uuid().optional(),
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
