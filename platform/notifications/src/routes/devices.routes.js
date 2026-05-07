// User-facing device registration. Any authenticated user can register and
// list their own push tokens. There is no staff-impersonation path here:
// staff-side device management would belong to a separate admin route if
// ever needed.
import { z } from 'zod'
import { withTenantTransaction, pool } from '../lib/db.js'
import * as repo from '../repositories/push-devices.repository.js'

const tags = ['notifications · devices']

const registerBody = z.object({
  platform: z.enum(['ios', 'android', 'web']),
  token:    z.string().min(8).max(4096),
  label:    z.string().max(128).optional().nullable(),
})

const idParams = z.object({ id: z.string().uuid() })

function ctxFromRequest(req) {
  return {
    appId:       req.identity.appId,
    tenantId:    req.identity.tenantId,
    subTenantId: req.identity.subTenantId ?? null,
    userId:      req.identity.userId,
    role:        req.identity.role,
  }
}

export async function devicesRoutes(fastify) {
  fastify.post('/', {
    schema: {
      tags,
      summary: 'Register / refresh a push device token for the current user',
      body: registerBody,
    },
  }, async (req, reply) => {
    const body = registerBody.parse(req.body ?? {})
    const ctx = ctxFromRequest(req)
    const r = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
      repo.upsertByToken(c, { ...ctx, userId: ctx.userId, ...body }),
    )
    return reply.code(201).send({ data: r })
  })

  fastify.get('/', {
    schema: { tags, summary: 'List the current user devices' },
  }, async (req) => {
    const ctx = ctxFromRequest(req)
    const r = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
      repo.listByUser(c, ctx.userId),
    )
    return { data: r }
  })

  fastify.delete('/:id', {
    schema: { tags, summary: 'Unregister one of the current user devices', params: idParams },
  }, async (req, reply) => {
    const ctx = ctxFromRequest(req)
    const ok = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
      const r = await repo.findById(c, req.params.id)
      if (!r || r.user_id !== ctx.userId) return false
      return repo.deleteById(c, req.params.id)
    })
    if (!ok) return reply.code(404).send({ error: { code: 'NOT_FOUND' } })
    return reply.code(204).send()
  })
}
