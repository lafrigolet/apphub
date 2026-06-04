import { z } from 'zod'
import { requireRole } from '@apphub/platform-sdk'
import * as service from '../services/reviews.service.js'

// Roles allowed to moderate, reply to and triage reviews (recommendation #1).
const MODERATOR_ROLES = ['vendor', 'staff', 'super_admin', 'admin']

const targetTypeEnum = z.enum(['product', 'vendor', 'service'])

const createBody = z.object({
  targetType: targetTypeEnum,
  targetId:   z.string().min(1).max(256),
  orderId:    z.string().uuid().optional(),
  rating:     z.number().int().min(1).max(5),
  title:      z.string().max(256).optional(),
  body:       z.string().max(4000).optional(),
  status:     z.enum(['pending', 'published']).optional(),
})

const replyBody  = z.object({ body: z.string().min(1).max(4000) })
const statusBody = z.object({
  status:           z.enum(['pending', 'published', 'hidden', 'removed']),
  moderationReason: z.string().max(1000).optional(),
})
const voteBody   = z.object({ vote: z.enum(['helpful', 'unhelpful']) })
const mediaBody  = z.object({
  objectId:     z.string().uuid(),
  kind:         z.enum(['photo', 'video']),
  displayOrder: z.number().int().min(0).max(100).optional(),
})
const reportBody = z.object({
  reason: z.enum(['spam', 'fake', 'inappropriate', 'misinformation', 'incentivized', 'other']),
  detail: z.string().max(2000).optional(),
})
const reportStatusBody = z.object({ status: z.enum(['open', 'reviewed', 'dismissed']) })
const idParams       = z.object({ id: z.string().uuid() })
const mediaIdParams  = z.object({ id: z.string().uuid(), mediaId: z.string().uuid() })
const reportIdParams = z.object({ reportId: z.string().uuid() })

const tags        = ['reviews']
const voteTags    = ['reviews · voting']
const mediaTags   = ['reviews · media']
const seoTags     = ['reviews · seo']
const modTags     = ['reviews · moderation']

const sortEnum = z.enum(['recent', 'oldest', 'helpful', 'rating_high', 'rating_low'])

const listQuery = z.object({
  targetType:   targetTypeEnum,
  targetId:     z.string().min(1),
  status:       z.enum(['pending', 'published', 'hidden', 'removed']).optional(),
  verifiedOnly: z.coerce.boolean().optional(),
  sort:         sortEnum.optional(),
  limit:        z.coerce.number().int().min(1).max(200).optional(),
  offset:       z.coerce.number().int().min(0).optional(),
})

const modListQuery = z.object({
  status: z.enum(['pending', 'published', 'hidden', 'removed']).optional(),
  limit:  z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
})

const reportListQuery = z.object({
  status: z.enum(['open', 'reviewed', 'dismissed']).optional(),
  limit:  z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
})

function ctxFromRequest(req) {
  return {
    appId: req.identity.appId,
    tenantId: req.identity.tenantId,
    subTenantId: req.identity.subTenantId ?? null,
    userId: req.identity.userId,
    role: req.identity.role,
    // Forward the raw JWT so the service can call orders/:id loopback as
    // the same user. RLS in platform_orders enforces tenant isolation.
    jwt: req.headers.authorization?.replace(/^Bearer\s+/i, '') ?? null,
  }
}

export async function reviewsRoutes(fastify) {
  fastify.post('/v1/reviews', {
    schema: { tags, summary: 'Create a review (verified-purchase auto-detected)', body: createBody },
  }, async (req, reply) => {
    const body = createBody.parse(req.body)
    const r = await service.createReview(ctxFromRequest(req), body)
    return reply.status(201).send(r)
  })

  fastify.get('/v1/reviews', {
    schema: { tags, summary: 'List reviews for a target' },
  }, async (req) => {
    const q = listQuery.parse(req.query)
    return service.listByTarget(ctxFromRequest(req), q)
  })

  fastify.get('/v1/reviews/aggregate', {
    schema: { tags, summary: 'Aggregate (count + average rating + verified count) for a target' },
  }, async (req) => {
    const q = listQuery.parse(req.query)
    return service.aggregateForTarget(ctxFromRequest(req), q)
  })

  // Schema.org JSON-LD for SEO. Public — frontends embed this in <script>.
  fastify.get('/v1/reviews/jsonld', {
    schema: { tags: seoTags, summary: 'Schema.org Product+AggregateRating+Review JSON-LD for SEO' },
    config: { public: true },
  }, async (req) => {
    const q = listQuery.parse(req.query)
    return service.jsonLd(ctxFromRequest(req), q)
  })

  fastify.get('/v1/reviews/:id', {
    schema: { tags, summary: 'Get a review with replies', params: idParams },
  }, async (req) => {
    return service.getReview(ctxFromRequest(req), req.params.id)
  })

  fastify.post('/v1/reviews/:id/reply', {
    schema: { tags, summary: 'Append a vendor / staff reply to a review', params: idParams, body: replyBody },
    preHandler: requireRole(...MODERATOR_ROLES),
  }, async (req, reply) => {
    const b = replyBody.parse(req.body)
    const r = await service.reply(ctxFromRequest(req), req.params.id, b.body)
    return reply.status(201).send(r)
  })

  fastify.patch('/v1/reviews/:id/status', {
    schema: { tags, summary: 'Moderate a review (publish / hide / remove, with reason)', params: idParams, body: statusBody },
    preHandler: requireRole(...MODERATOR_ROLES),
  }, async (req) => {
    const b = statusBody.parse(req.body)
    return service.setStatus(ctxFromRequest(req), req.params.id, b.status, b.moderationReason ?? null)
  })

  fastify.delete('/v1/reviews/:id', {
    schema: { tags, summary: 'Hard-delete a review (and cascade votes/media)', params: idParams },
    preHandler: requireRole(...MODERATOR_ROLES),
  }, async (req, reply) => {
    await service.remove(ctxFromRequest(req), req.params.id)
    return reply.status(204).send()
  })

  // ── Moderation queue (staff triage) ──────────────────────────────────
  fastify.get('/v1/reviews/moderation/queue', {
    schema: {
      tags: modTags,
      summary: 'List reviews awaiting moderation across all targets (default status=pending)',
      querystring: modListQuery,
    },
    preHandler: requireRole(...MODERATOR_ROLES),
  }, async (req) => {
    const q = modListQuery.parse(req.query)
    return { data: await service.listForModeration(ctxFromRequest(req), q) }
  })

  // ── Reports / abuse flags ────────────────────────────────────────────
  fastify.post('/v1/reviews/:id/report', {
    schema: { tags: modTags, summary: 'Report a review for abuse (spam / fake / …)', params: idParams, body: reportBody },
  }, async (req, reply) => {
    const b = reportBody.parse(req.body)
    const r = await service.report(ctxFromRequest(req), req.params.id, b.reason, b.detail)
    return reply.status(201).send(r)
  })

  fastify.get('/v1/reviews/reports', {
    schema: {
      tags: modTags,
      summary: 'List review reports for the tenant (default status=open)',
      querystring: reportListQuery,
    },
    preHandler: requireRole(...MODERATOR_ROLES),
  }, async (req) => {
    const q = reportListQuery.parse(req.query)
    return { data: await service.listReports(ctxFromRequest(req), q) }
  })

  fastify.patch('/v1/reviews/reports/:reportId', {
    schema: { tags: modTags, summary: 'Resolve a report (reviewed / dismissed)', params: reportIdParams, body: reportStatusBody },
    preHandler: requireRole(...MODERATOR_ROLES),
  }, async (req) => {
    const b = reportStatusBody.parse(req.body)
    return service.setReportStatus(ctxFromRequest(req), req.params.reportId, b.status)
  })

  // ── Voting (helpful/unhelpful) ───────────────────────────────────────
  fastify.put('/v1/reviews/:id/vote', {
    schema: { tags: voteTags, summary: 'Vote helpful or unhelpful on a review (one per user)', params: idParams, body: voteBody },
  }, async (req) => {
    const b = voteBody.parse(req.body)
    return service.vote(ctxFromRequest(req), req.params.id, b.vote === 'helpful' ? 1 : -1)
  })

  fastify.delete('/v1/reviews/:id/vote', {
    schema: { tags: voteTags, summary: 'Remove the current user vote on a review', params: idParams },
  }, async (req) => {
    return service.unvote(ctxFromRequest(req), req.params.id)
  })

  // ── Media (photo/video via platform_storage) ─────────────────────────
  fastify.get('/v1/reviews/:id/media', {
    schema: { tags: mediaTags, summary: 'List media attached to a review', params: idParams },
  }, async (req) => {
    return { data: await service.listMedia(ctxFromRequest(req), req.params.id) }
  })

  fastify.post('/v1/reviews/:id/media', {
    schema: {
      tags: mediaTags,
      summary: 'Attach media (photo/video) to a review (objectId from platform_storage)',
      params: idParams,
      body: mediaBody,
    },
  }, async (req, reply) => {
    const b = mediaBody.parse(req.body)
    const r = await service.attachMedia(ctxFromRequest(req), req.params.id, b)
    return reply.status(201).send(r)
  })

  fastify.delete('/v1/reviews/:id/media/:mediaId', {
    schema: { tags: mediaTags, summary: 'Detach media from a review', params: mediaIdParams },
  }, async (req, reply) => {
    await service.detachMedia(ctxFromRequest(req), req.params.mediaId)
    return reply.status(204).send()
  })
}
