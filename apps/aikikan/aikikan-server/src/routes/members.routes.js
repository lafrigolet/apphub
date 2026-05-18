import { z } from 'zod'
import * as service from '../services/members.service.js'

// Body schema — every field optional so partial updates work. Sending an
// empty body returns the row unchanged (acts as a touch).
const updateBody = z.object({
  memberNumber: z.string().min(1).max(64).optional(),
  memberSince:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),  // YYYY-MM-DD
  aikidoGrade:  z.string().min(1).max(32).optional(),
  dojoName:     z.string().min(1).max(128).optional(),
  notes:        z.string().max(1024).optional(),
})

const userIdParams = z.object({ userId: z.string().uuid() })

export async function membersRoutes(fastify) {
  fastify.get('/v1/aikikan/members/me', async (req) => {
    const row = await service.getMe(req.identity)
    return row ?? {
      // No row yet → respond with an empty profile carrying the user's
      // identity. The frontend can render "complete your profile".
      user_id:  req.identity.userId,
      app_id:   req.identity.appId,
      tenant_id: req.identity.tenantId,
      empty:    true,
    }
  })

  fastify.patch('/v1/aikikan/members/me', async (req) => {
    const body = updateBody.parse(req.body ?? {})
    return service.updateMe(req.identity, body)
  })

  // Admin endpoints — el chequeo de rol está en el service.
  fastify.get('/v1/aikikan/members', async (req) => {
    return service.listMembers(req.identity)
  })

  fastify.get('/v1/aikikan/members/:userId', async (req) => {
    const { userId } = userIdParams.parse(req.params)
    return service.getMemberByUserId(req.identity, userId)
  })

  fastify.patch('/v1/aikikan/members/:userId', async (req) => {
    const { userId } = userIdParams.parse(req.params)
    const body = updateBody.parse(req.body ?? {})
    return service.updateMemberAdmin(req.identity, userId, body)
  })
}
