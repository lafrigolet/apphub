import { z } from 'zod'
import * as moderation from '../services/moderation.service.js'
import * as search from '../services/search.service.js'
import * as presence from '../services/presence.service.js'

const uuid = z.string().uuid()
const TAG = ['chat · moderation']

const reportBody = z.object({
  targetType: z.enum(['message', 'conversation']),
  targetId:   uuid,
  reason:     z.string().max(1000).optional(),
})
const searchQuery = z.object({
  q:              z.string().min(1).max(200),
  conversationId: uuid.optional(),
  senderUserId:   uuid.optional(),
  type:           z.enum(['text', 'system', 'attachment']).optional(),
  before:         z.string().datetime().optional(),
  after:          z.string().datetime().optional(),
  limit:          z.coerce.number().int().min(1).max(200).default(50),
})
const presenceQuery = z.object({
  userIds: z.string().min(1), // comma-separated
})

export async function moderationRoutes(fastify) {
  const ctx = (req) => req.identity

  // ── blocks ───────────────────────────────────────────────────────────────
  fastify.get('/blocks', {
    schema: { tags: TAG, summary: 'List users I have blocked' },
  }, async (req) => ({ data: await moderation.listBlocks(ctx(req)) }))

  fastify.put('/blocks/:userId', {
    schema: { tags: TAG, summary: 'Block a user' },
  }, async (req, reply) => {
    const data = await moderation.block(ctx(req), req.params.userId)
    reply.code(201)
    return { data }
  })

  fastify.delete('/blocks/:userId', {
    schema: { tags: TAG, summary: 'Unblock a user' },
  }, async (req) => {
    await moderation.unblock(ctx(req), req.params.userId)
    return { data: { ok: true } }
  })

  // ── reports ──────────────────────────────────────────────────────────────
  fastify.post('/reports', {
    schema: { tags: TAG, summary: 'Report a message or conversation', body: reportBody },
  }, async (req, reply) => {
    const body = reportBody.parse(req.body ?? {})
    const data = await moderation.report(ctx(req), body)
    reply.code(201)
    return { data }
  })

  // ── search ────────────────────────────────────────────────────────────────
  fastify.get('/search', {
    schema: { tags: ['chat'], summary: 'Search messages in my conversations (filters: conversation/sender/type/date)', querystring: searchQuery },
  }, async (req) => {
    const { q, ...filters } = searchQuery.parse(req.query ?? {})
    return { data: await search.search(ctx(req), q, filters) }
  })

  // ── presence ──────────────────────────────────────────────────────────────
  fastify.get('/presence', {
    schema: { tags: ['chat'], summary: 'Presence snapshot for the given users (?userIds=a,b,c)', querystring: presenceQuery },
  }, async (req) => {
    const q = presenceQuery.parse(req.query ?? {})
    const userIds = q.userIds.split(',').map((s) => s.trim()).filter(Boolean)
    return { data: await presence.snapshot(ctx(req), userIds) }
  })
}
