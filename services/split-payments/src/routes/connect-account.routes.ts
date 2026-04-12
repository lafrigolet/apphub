import { Router } from 'express'
import { z } from 'zod'
import { asyncHandler } from '../middleware/error.middleware.js'
import { tenantMiddleware } from '../middleware/tenant.middleware.js'
import * as service from '../services/connect-account.service.js'
import { CreateConnectAccountSchema } from '../types/index.js'
import type { ApiSuccess } from '../types/index.js'

export const connectAccountRouter = Router()

connectAccountRouter.use(tenantMiddleware)

// POST /v1/connect-accounts — start onboarding for a new merchant
connectAccountRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = CreateConnectAccountSchema.parse(req.body)
    const result = await service.createConnectAccount(req.tenant, input)
    const response: ApiSuccess<typeof result> = { data: result }
    res.status(201).json(response)
  }),
)

// GET /v1/connect-accounts — list all merchant accounts for tenant
connectAccountRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const accounts = await service.listConnectAccounts(req.tenant)
    const response: ApiSuccess<typeof accounts> = { data: accounts }
    res.json(response)
  }),
)

// POST /v1/connect-accounts/:id/onboarding-link — refresh onboarding link
connectAccountRouter.post(
  '/:id/onboarding-link',
  asyncHandler(async (req, res) => {
    const schema = z.object({
      returnUrl: z.string().url(),
      refreshUrl: z.string().url(),
    })
    const { returnUrl, refreshUrl } = schema.parse(req.body)
    const result = await service.refreshOnboardingLink(
      req.tenant,
      req.params['id']!,
      returnUrl,
      refreshUrl,
    )
    const response: ApiSuccess<typeof result> = { data: result }
    res.json(response)
  }),
)
