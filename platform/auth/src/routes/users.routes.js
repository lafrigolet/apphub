import { z } from 'zod'
import * as usersService from '../services/users.service.js'
import { ForbiddenError } from '../utils/errors.js'

const listQuery = z.object({
  appId:    z.string().min(1).optional(),
  tenantId: z.string().uuid().optional(),
  role:     z.string().min(1).optional(),
})

const roleBody = z.object({
  role: z.string().min(1).max(32),
})

const STAFF_ROLES = new Set(['staff', 'super_admin', 'admin', 'owner'])

function requireStaffOrAdmin(req) {
  if (!STAFF_ROLES.has(req.identity?.role)) {
    throw new ForbiddenError('Requires staff or admin role')
  }
}

export async function usersRoutes(fastify) {
  fastify.get('/v1/users', async (req) => {
    requireStaffOrAdmin(req)
    const { appId, tenantId, role } = listQuery.parse(req.query)
    const roles = role ? role.split(',').map((s) => s.trim()).filter(Boolean) : undefined
    return usersService.listUsers({ appId, tenantId, role: roles }, req.identity)
  })

  fastify.patch('/v1/users/:id/role', async (req) => {
    requireStaffOrAdmin(req)
    const { role } = roleBody.parse(req.body)
    return usersService.changeRole({ id: req.params.id, role }, req.identity)
  })

  fastify.delete('/v1/users/:id', async (req, reply) => {
    requireStaffOrAdmin(req)
    await usersService.revokeUser({ id: req.params.id }, req.identity)
    return reply.status(204).send()
  })
}
