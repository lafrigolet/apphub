import { z } from 'zod'
import * as service from '../services/email-domains.service.js'

const createBody = z.object({
  domain: z.string().min(3).max(253),
})

const defaultsBody = z.object({
  defaultFromLocal: z.string().min(1).max(64).optional().nullable(),
  defaultFromName:  z.string().min(1).max(128).optional().nullable(),
  replyToAddress:   z.string().email().optional().nullable(),
})

const suspendBody = z.object({
  reason: z.string().max(512).optional().nullable(),
})

// Resolve the (appId, tenantId) the caller is acting on.
//   - staff/super_admin may pass appId/tenantId in query → impersonation.
//   - everyone else uses ctx from JWT.
function ctxFromRequest(req) {
  const id = req.identity
  const isStaff = ['staff', 'super_admin'].includes(id.role)
  if (isStaff && (req.query?.appId || req.query?.tenantId)) {
    return {
      appId:    req.query.appId ?? id.appId,
      tenantId: req.query.tenantId ?? id.tenantId,
      subTenantId: null,
      userId:   id.userId,
      role:     id.role,
    }
  }
  return {
    appId:       id.appId,
    tenantId:    id.tenantId,
    subTenantId: id.subTenantId ?? null,
    userId:      id.userId,
    role:        id.role,
  }
}

function requireTenantOwnerOrStaff(req, reply) {
  const role = req.identity?.role
  if (!['owner', 'admin', 'staff', 'super_admin'].includes(role)) {
    return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'tenant owner/admin or staff required' } })
  }
}

function requireStaff(req, reply) {
  const role = req.identity?.role
  if (!['staff', 'super_admin'].includes(role)) {
    return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'staff required' } })
  }
}

function sendError(reply, err) {
  if (err?.statusCode && err?.code) {
    return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } })
  }
  throw err
}

const tags = ['notifications · email-domains']

const idParams = z.object({ id: z.string().uuid() })

export async function emailDomainsRoutes(fastify) {
  fastify.post('/', {
    schema: {
      tags,
      summary: 'Create a tenant email-sender domain (provisions in SendGrid)',
      body: createBody,
    },
  }, async (req, reply) => {
    const guarded = requireTenantOwnerOrStaff(req, reply); if (guarded) return guarded
    const body = createBody.parse(req.body ?? {})
    try {
      const r = await service.createForTenant(ctxFromRequest(req), body)
      return reply.code(201).send({ data: r })
    } catch (err) { return sendError(reply, err) }
  })

  fastify.get('/', {
    schema: {
      tags,
      summary: 'List the tenant email-sender domains',
    },
  }, async (req) => {
    return { data: await service.listForTenant(ctxFromRequest(req)) }
  })

  fastify.get('/:id', {
    schema: { tags, summary: 'Get one tenant email-sender domain', params: idParams },
  }, async (req, reply) => {
    try {
      return { data: await service.getForTenant(ctxFromRequest(req), req.params.id) }
    } catch (err) { return sendError(reply, err) }
  })

  fastify.post('/:id/verify', {
    schema: {
      tags,
      summary: 'Re-validate the SendGrid CNAMEs and update domain status',
      params: idParams,
    },
  }, async (req, reply) => {
    const guarded = requireTenantOwnerOrStaff(req, reply); if (guarded) return guarded
    try {
      return { data: await service.verifyForTenant(ctxFromRequest(req), req.params.id) }
    } catch (err) { return sendError(reply, err) }
  })

  fastify.patch('/:id', {
    schema: {
      tags,
      summary: 'Update default-from / reply-to of a verified domain',
      params: idParams,
      body: defaultsBody,
    },
  }, async (req, reply) => {
    const guarded = requireTenantOwnerOrStaff(req, reply); if (guarded) return guarded
    const body = defaultsBody.parse(req.body ?? {})
    try {
      return { data: await service.updateDefaultsForTenant(ctxFromRequest(req), req.params.id, body) }
    } catch (err) { return sendError(reply, err) }
  })

  fastify.post('/:id/suspend', {
    schema: {
      tags,
      summary: 'Suspend a domain (staff only) — sends from it are blocked',
      params: idParams,
      body: suspendBody,
    },
  }, async (req, reply) => {
    const guarded = requireStaff(req, reply); if (guarded) return guarded
    const body = suspendBody.parse(req.body ?? {})
    try {
      return { data: await service.suspendForTenant(ctxFromRequest(req), req.params.id, body.reason) }
    } catch (err) { return sendError(reply, err) }
  })

  fastify.delete('/:id', {
    schema: { tags, summary: 'Delete a domain (also removes it from SendGrid)', params: idParams },
  }, async (req, reply) => {
    const guarded = requireTenantOwnerOrStaff(req, reply); if (guarded) return guarded
    try {
      await service.deleteForTenant(ctxFromRequest(req), req.params.id)
      return reply.code(204).send()
    } catch (err) { return sendError(reply, err) }
  })
}
