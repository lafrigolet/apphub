import { CreateConnectAccountSchema } from '../schemas/index.js'
import * as service from '../services/connect-account.service.js'
import { z } from 'zod'

export async function connectAccountRoutes(fastify) {
  // POST /v1/connect-accounts — start onboarding for a new merchant
  fastify.post(
    '/',
    {
      schema: {
        body: CreateConnectAccountSchema,
      },
    },
    async (req, reply) => {
      const result = await service.createConnectAccount(req.tenant, req.body)
      return reply.status(201).send({ data: result })
    },
  )

  // GET /v1/connect-accounts — list all merchant accounts for tenant
  fastify.get('/', async (req) => {
    const accounts = await service.listConnectAccounts(req.tenant)
    return { data: accounts }
  })

  // POST /v1/connect-accounts/:id/onboarding-link — refresh onboarding link
  fastify.post(
    '/:id/onboarding-link',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          returnUrl: z.string().url(),
          refreshUrl: z.string().url(),
        }),
      },
    },
    async (req) => {
      const { returnUrl, refreshUrl } = req.body
      const result = await service.refreshOnboardingLink(
        req.tenant,
        req.params.id,
        returnUrl,
        refreshUrl,
      )
      return { data: result }
    },
  )
}
