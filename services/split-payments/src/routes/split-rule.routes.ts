import { Router } from 'express'
import { z } from 'zod'
import { asyncHandler } from '../middleware/error.middleware.js'
import { tenantMiddleware } from '../middleware/tenant.middleware.js'
import * as service from '../services/split-rule.service.js'
import { CreateSplitRuleSchema } from '../types/index.js'
import type { ApiSuccess } from '../types/index.js'

export const splitRuleRouter = Router()

splitRuleRouter.use(tenantMiddleware)

// GET /v1/split-rules
splitRuleRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const rules = await service.listSplitRules(req.tenant)
    const response: ApiSuccess<typeof rules> = { data: rules }
    res.json(response)
  }),
)

// POST /v1/split-rules
splitRuleRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = CreateSplitRuleSchema.parse(req.body)
    const rule = await service.createSplitRule(req.tenant, input)
    const response: ApiSuccess<typeof rule> = { data: rule }
    res.status(201).json(response)
  }),
)

// GET /v1/split-rules/:id
splitRuleRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const rule = await service.getSplitRule(req.tenant, req.params['id']!)
    const response: ApiSuccess<typeof rule> = { data: rule }
    res.json(response)
  }),
)

// DELETE /v1/split-rules/:id
splitRuleRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await service.deactivateSplitRule(req.tenant, req.params['id']!)
    res.status(204).send()
  }),
)

// POST /v1/split-rules/simulate
splitRuleRouter.post(
  '/simulate',
  asyncHandler(async (req, res) => {
    const schema = z.object({
      splitRuleId: z.string().uuid(),
      amount: z.number().int().positive(),
      currency: z.string().length(3),
    })
    const { splitRuleId, amount, currency } = schema.parse(req.body)
    const simulation = await service.simulate(req.tenant, splitRuleId, amount, currency)
    const response: ApiSuccess<typeof simulation> = { data: simulation }
    res.json(response)
  }),
)
