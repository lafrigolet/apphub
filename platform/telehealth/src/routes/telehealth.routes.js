import { z } from 'zod'
import * as service from '../services/telehealth.service.js'

const roomBody = z.object({
  bookingId:        z.string().uuid().optional(),
  startsAt:         z.string().datetime(),
  endsAt:           z.string().datetime(),
  recordingEnabled: z.boolean().optional(),
  metadata:         z.record(z.any()).optional(),
})

const tokenBody = z.object({
  userId:          z.string().uuid().optional(),
  participantRole: z.enum(['host','guest']),
})

function ctxFromRequest(req) {
  return {
    appId:       req.identity.appId,
    tenantId:    req.identity.tenantId,
    subTenantId: req.identity.subTenantId ?? null,
    userId:      req.identity.userId,
    role:        req.identity.role,
  }
}

export async function telehealthRoutes(fastify) {
  fastify.post('/v1/telehealth/rooms', async (req, reply) => {
    const body = roomBody.parse(req.body)
    return reply.status(201).send(await service.createRoom(ctxFromRequest(req), body))
  })

  fastify.get('/v1/telehealth/rooms/:id', async (req) =>
    service.getRoom(ctxFromRequest(req), req.params.id),
  )

  fastify.post('/v1/telehealth/rooms/:id/tokens', async (req, reply) => {
    const body = tokenBody.parse(req.body)
    return reply.status(201).send(await service.issueToken(ctxFromRequest(req), req.params.id, body))
  })

  fastify.post('/v1/telehealth/rooms/:id/end', async (req) =>
    service.endRoom(ctxFromRequest(req), req.params.id),
  )

  fastify.post('/v1/telehealth/rooms/:id/cancel', async (req) =>
    service.cancelRoom(ctxFromRequest(req), req.params.id),
  )
}
