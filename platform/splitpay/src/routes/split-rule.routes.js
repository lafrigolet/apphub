import { CreateSplitRuleSchema } from '../schemas/index.js'
import * as service from '../services/split-rule.service.js'
import { z } from 'zod'

export async function splitRuleRoutes(fastify) {
  // GET /v1/split-rules
  fastify.get('/', async (req) => {
    const rules = await service.listSplitRules(req.tenant)
    return { data: rules }
  })

  // POST /v1/split-rules
  fastify.post(
    '/',
    {
      schema: {
        body: CreateSplitRuleSchema,
      },
    },
    async (req, reply) => {
      const rule = await service.createSplitRule(req.tenant, req.body)
      return reply.status(201).send({ data: rule })
    },
  )

  // GET /v1/split-rules/:id
  fastify.get(
    '/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
      },
    },
    async (req) => {
      const rule = await service.getSplitRule(req.tenant, req.params.id)
      return { data: rule }
    },
  )

  // DELETE /v1/split-rules/:id
  fastify.delete(
    '/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
      },
    },
    async (req, reply) => {
      await service.deactivateSplitRule(req.tenant, req.params.id)
      return reply.status(204).send()
    },
  )

  // POST /v1/split-rules/simulate
  fastify.post(
    '/simulate',
    {
      schema: {
        body: z.object({
          splitRuleId: z.string().uuid(),
          amount: z.number().int().positive(),
          currency: z.string().length(3),
        }),
      },
    },
    async (req) => {
      const { splitRuleId, amount, currency } = req.body
      const simulation = await service.simulate(req.tenant, splitRuleId, amount, currency)
      return { data: simulation }
    },
  )
}
