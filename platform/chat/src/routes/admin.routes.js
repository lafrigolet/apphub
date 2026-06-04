import { z } from 'zod'
import { requireRole } from '@apphub/platform-sdk/app-guard'
import * as moderation from '../services/moderation.service.js'
import * as settingsService from '../services/settings.service.js'
import * as adminService from '../services/admin.service.js'

const TAG = ['chat · admin']
const uuid = z.string().uuid()
const banBody = z.object({
  userId:      uuid,
  reason:      z.string().max(1000).optional(),
  bannedUntil: z.string().datetime().optional(),
})
const metricsQuery = z.object({ sinceDays: z.coerce.number().int().min(1).max(365).default(7) })

const reportsQuery = z.object({
  status: z.enum(['open', 'reviewed', 'dismissed']).optional(),
  limit:  z.coerce.number().int().min(1).max(500).default(100),
})
const reportPatchBody = z.object({ status: z.enum(['reviewed', 'dismissed']) })
const userReportsQuery = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) })
const userParams = z.object({ userId: uuid })
const slaMinutes = z.coerce.number().int().min(1).max(525600).optional().nullable()
const settingsBody = z.object({
  allowGroups:      z.boolean().optional(),
  maxGroupSize:     z.coerce.number().int().min(2).max(100000).optional(),
  redactionEnabled: z.boolean().optional(),
  retentionDays:    z.coerce.number().int().min(1).max(36500).optional().nullable(),
  supportEnabled:   z.boolean().optional(),
  dmRequests:       z.boolean().optional(),
  slaMinutesLow:    slaMinutes,
  slaMinutesNormal: slaMinutes,
  slaMinutesHigh:   slaMinutes,
  slaMinutesUrgent: slaMinutes,
  searchLanguage:   z.enum(['simple', 'spanish', 'english']).optional(),
  // Empty string clears the auto-reply; omit to leave it unchanged.
  supportAutoReply: z.string().max(2000).optional(),
})

export async function adminRoutes(fastify) {
  fastify.addHook('preHandler', requireRole('owner', 'admin', 'staff', 'super_admin'))
  const ctx = (req) => req.identity

  fastify.get('/settings', {
    schema: { tags: TAG, summary: 'Get tenant chat settings' },
  }, async (req) => ({ data: await settingsService.getForTenant(ctx(req)) }))

  fastify.put('/settings', {
    schema: { tags: TAG, summary: 'Upsert tenant chat settings', body: settingsBody },
  }, async (req) => {
    const body = settingsBody.parse(req.body ?? {})
    return { data: await settingsService.upsertForTenant(ctx(req), body) }
  })

  fastify.get('/reports', {
    schema: { tags: TAG, summary: 'List reports', querystring: reportsQuery },
  }, async (req) => {
    const q = reportsQuery.parse(req.query ?? {})
    return { data: await moderation.listReports(ctx(req), q) }
  })

  fastify.patch('/reports/:id', {
    schema: { tags: TAG, summary: 'Review / dismiss a report', body: reportPatchBody },
  }, async (req) => {
    const body = reportPatchBody.parse(req.body ?? {})
    return { data: await moderation.updateReport(ctx(req), req.params.id, body.status) }
  })

  // ── per-user report history + GDPR erasure ─────────────────────────────────
  fastify.get('/users/:userId/reports', {
    schema: {
      tags: TAG, summary: 'Report history for a reported user (repeat-offender lookup)',
      params: userParams, querystring: userReportsQuery,
    },
  }, async (req) => {
    const { userId } = userParams.parse(req.params)
    const q = userReportsQuery.parse(req.query ?? {})
    return { data: await moderation.listUserReports(ctx(req), userId, q) }
  })

  fastify.delete('/users/:userId/data', {
    schema: {
      tags: TAG, summary: 'GDPR: erase a user\'s chat footprint (anonymize messages, drop blocks/reactions/mentions)',
      params: userParams,
    },
  }, async (req) => {
    const { userId } = userParams.parse(req.params)
    return { data: await moderation.eraseUserData(ctx(req), userId) }
  })

  // ── tenant bans ──────────────────────────────────────────────────────────────
  fastify.get('/bans', {
    schema: { tags: TAG, summary: 'List tenant-banned users' },
  }, async (req) => ({ data: await moderation.listBans(ctx(req)) }))

  fastify.post('/bans', {
    schema: { tags: TAG, summary: 'Ban a user from chat in this tenant', body: banBody },
  }, async (req, reply) => {
    const body = banBody.parse(req.body ?? {})
    const data = await moderation.banUser(ctx(req), body.userId, body.reason, body.bannedUntil ?? null)
    reply.code(201)
    return { data }
  })

  fastify.delete('/bans/:userId', {
    schema: { tags: TAG, summary: 'Lift a tenant ban' },
  }, async (req) => {
    await moderation.unbanUser(ctx(req), req.params.userId)
    return { data: { ok: true } }
  })

  // ── metrics + export ───────────────────────────────────────────────────────
  fastify.get('/metrics', {
    schema: { tags: TAG, summary: 'Tenant chat metrics', querystring: metricsQuery },
  }, async (req) => {
    const q = metricsQuery.parse(req.query ?? {})
    return { data: await adminService.metrics(ctx(req), q.sinceDays) }
  })

  fastify.get('/conversations/:id/export', {
    schema: { tags: TAG, summary: 'Export a conversation\'s messages (audit)' },
  }, async (req) => ({ data: await adminService.exportConversation(ctx(req), req.params.id) }))
}
