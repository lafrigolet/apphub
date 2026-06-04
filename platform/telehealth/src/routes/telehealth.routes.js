import { z } from 'zod'
import * as service from '../services/telehealth.service.js'

const dataRegion = z.enum(['eu-west', 'eu-central', 'us-east', 'ap-southeast'])

const roomBody = z.object({
  bookingId:        z.string().uuid().optional(),
  startsAt:         z.string().datetime(),
  endsAt:           z.string().datetime(),
  recordingEnabled: z.boolean().optional(),
  dataRegion:       dataRegion.optional(),
  metadata:         z.record(z.any()).optional(),
})

const tokenBody = z.object({
  userId:          z.string().uuid().optional(),
  participantRole: z.enum(['host', 'guest']),
})

const consentBody = z.object({
  status: z.enum(['pending', 'granted', 'denied']),
  by:     z.string().uuid().optional(),
  text:   z.string().max(8192).optional(),
})

const noteBody = z.object({
  bookingId:  z.string().uuid().optional(),
  authorId:   z.string().uuid().optional(),
  subjective: z.string().max(16384).optional(),
  objective:  z.string().max(16384).optional(),
  assessment: z.string().max(16384).optional(),
  plan:       z.string().max(16384).optional(),
  body:       z.string().max(65536).optional(),
  metadata:   z.record(z.any()).optional(),
})

const noteUpdateBody = z.object({
  subjective: z.string().max(16384).optional(),
  objective:  z.string().max(16384).optional(),
  assessment: z.string().max(16384).optional(),
  plan:       z.string().max(16384).optional(),
  body:       z.string().max(65536).optional(),
})

const idParam = z.object({ id: z.string() })
const noteIdParam = z.object({ noteId: z.string() })

const tags = ['telehealth']

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
  fastify.post('/v1/telehealth/rooms', {
    schema: { tags, summary: 'Create a telehealth video room', body: roomBody },
  }, async (req, reply) => {
    const body = roomBody.parse(req.body)
    return reply.status(201).send(await service.createRoom(ctxFromRequest(req), body))
  })

  fastify.get('/v1/telehealth/rooms/:id', {
    schema: { tags, summary: 'Get a telehealth room by id', params: idParam },
  }, async (req) => service.getRoom(ctxFromRequest(req), req.params.id))

  fastify.get('/v1/telehealth/rooms/:id/events', {
    schema: { tags, summary: 'List FSM transition history for a room', params: idParam },
  }, async (req) => ({ data: await service.listRoomEvents(ctxFromRequest(req), req.params.id) }))

  fastify.post('/v1/telehealth/rooms/:id/tokens', {
    schema: { tags, summary: 'Issue an access token for a room', params: idParam, body: tokenBody },
  }, async (req, reply) => {
    const body = tokenBody.parse(req.body)
    return reply.status(201).send(await service.issueToken(ctxFromRequest(req), req.params.id, body))
  })

  fastify.post('/v1/telehealth/rooms/:id/recording-consent', {
    schema: { tags, summary: 'Record a recording-consent decision (GDPR Art. 9)', params: idParam, body: consentBody },
  }, async (req) => {
    const body = consentBody.parse(req.body)
    return service.setRecordingConsent(ctxFromRequest(req), req.params.id, body)
  })

  fastify.post('/v1/telehealth/rooms/:id/end', {
    schema: { tags, summary: 'End a telehealth room', params: idParam },
  }, async (req) => service.endRoom(ctxFromRequest(req), req.params.id))

  fastify.post('/v1/telehealth/rooms/:id/cancel', {
    schema: { tags, summary: 'Cancel a telehealth room', params: idParam },
  }, async (req) => service.cancelRoom(ctxFromRequest(req), req.params.id))

  // ---- Post-session clinical notes ----------------------------------------

  fastify.post('/v1/telehealth/rooms/:id/notes', {
    schema: { tags, summary: 'Create a post-session clinical note', params: idParam, body: noteBody },
  }, async (req, reply) => {
    const body = noteBody.parse(req.body)
    return reply.status(201).send(await service.createNote(ctxFromRequest(req), req.params.id, body))
  })

  fastify.get('/v1/telehealth/rooms/:id/notes', {
    schema: { tags, summary: 'List clinical notes for a room', params: idParam },
  }, async (req) => ({ data: await service.listNotes(ctxFromRequest(req), req.params.id) }))

  fastify.patch('/v1/telehealth/notes/:noteId', {
    schema: { tags, summary: 'Update an unsigned clinical note', params: noteIdParam, body: noteUpdateBody },
  }, async (req) => {
    const body = noteUpdateBody.parse(req.body)
    return service.updateNote(ctxFromRequest(req), req.params.noteId, body)
  })

  fastify.post('/v1/telehealth/notes/:noteId/sign', {
    schema: { tags, summary: 'Digitally sign (lock) a clinical note', params: noteIdParam },
  }, async (req) => service.signNote(ctxFromRequest(req), req.params.noteId))
}
