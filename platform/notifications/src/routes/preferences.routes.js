// User-facing notification preferences (self-service opt-out) + one-click
// unsubscribe.
//
//   GET    /v1/notifications/preferences            — current user's muted prefs
//   PATCH  /v1/notifications/preferences            — mute/unmute a category/channel
//   GET    /v1/notifications/preferences/unsubscribe-token — stable token for footer links
//   POST   /v1/notifications/unsubscribe            — public, token-based one-click unsubscribe
//
// The first three require auth (the appGuard sets req.identity). The last is
// PUBLIC (config.public) — it's the target of the List-Unsubscribe link in
// email footers and must work without a session.
import { z } from 'zod'
import { withTenantTransaction, pool } from '../lib/db.js'
import * as repo from '../repositories/preferences.repository.js'
import {
  MUTABLE_CATEGORIES, ensureUnsubscribeToken,
} from '../services/preferences.service.js'

const tags = ['notifications · preferences']

const patchBody = z.object({
  category: z.enum(MUTABLE_CATEGORIES),
  channel:  z.enum(['email', 'sms', 'push', '*']).default('*'),
  muted:    z.boolean(),
})

const unsubBody = z.object({
  token:    z.string().min(8).max(256),
  category: z.enum(MUTABLE_CATEGORIES).optional(),
})

function ctxFromRequest(req) {
  return {
    appId:       req.identity.appId,
    tenantId:    req.identity.tenantId,
    subTenantId: req.identity.subTenantId ?? null,
    userId:      req.identity.userId,
  }
}

export async function preferencesRoutes(fastify) {
  fastify.get('/preferences', {
    schema: { tags, summary: 'List the current user notification preferences (muted categories/channels)' },
  }, async (req) => {
    const ctx = ctxFromRequest(req)
    const rows = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
      repo.listForUser(c, ctx.userId),
    )
    return { data: { categories: MUTABLE_CATEGORIES, muted: rows } }
  })

  fastify.patch('/preferences', {
    schema: {
      tags,
      summary: 'Mute or unmute a notification category for the current user',
      body: patchBody,
    },
  }, async (req) => {
    const body = patchBody.parse(req.body ?? {})
    const ctx = ctxFromRequest(req)
    const r = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
      repo.setPreference(c, { ...ctx, ...body }),
    )
    return { data: r }
  })

  fastify.get('/preferences/unsubscribe-token', {
    schema: {
      tags,
      summary: 'Get the current user stable unsubscribe token (used in email footers)',
    },
  }, async (req) => {
    const ctx = ctxFromRequest(req)
    const token = await ensureUnsubscribeToken({
      appId: ctx.appId, tenantId: ctx.tenantId, userId: ctx.userId,
    })
    return { data: { token } }
  })

  // PUBLIC — one-click unsubscribe target. Resolves the token, then mutes the
  // requested category (or 'marketing' by default) for that user. Idempotent.
  fastify.post('/unsubscribe', {
    config: { public: true },
    schema: {
      tags,
      summary: 'One-click unsubscribe via token (public, no auth) — mutes a category for the user',
      body: unsubBody,
    },
  }, async (req, reply) => {
    const { token, category } = unsubBody.parse(req.body ?? {})
    const client = await pool.connect()
    try {
      const row = await repo.findByToken(client, token)
      if (!row) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'invalid unsubscribe token' } })
      const cat = category ?? 'marketing'
      await repo.muteByScope(client, {
        appId: row.app_id, tenantId: row.tenant_id, userId: row.user_id, category: cat, channel: '*',
      })
      return { data: { unsubscribed: true, category: cat } }
    } finally {
      client.release()
    }
  })
}
