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

const profileBody = z.object({
  displayName: z.string().min(1).max(128).optional(),
})

const inviteBody = z.object({
  appId:       z.string().min(1),
  tenantId:    z.string().uuid(),
  email:       z.string().email(),
  role:        z.string().min(1).max(32).optional(),
  displayName: z.string().min(1).max(128).optional(),
})

const idParams = z.object({ id: z.string().uuid() })

const STAFF_ROLES = new Set(['staff', 'super_admin', 'admin', 'owner'])

function requireStaffOrAdmin(req) {
  if (!STAFF_ROLES.has(req.identity?.role)) {
    throw new ForbiddenError('Requires staff or admin role')
  }
}

export async function usersRoutes(fastify) {
  // Perfil propio: cualquier usuario autenticado puede leer/editar su
  // propia ficha. La identidad sale del JWT, no de la URL — así no se
  // puede pedir el perfil de otro user pasando un id distinto. Se
  // monta antes que `/:id` para que el router elija la ruta exacta.
  fastify.get('/v1/users/me', async (req) => {
    return usersService.getMe(req.identity)
  })

  fastify.patch('/v1/users/me', async (req) => {
    const body = profileBody.parse(req.body)
    return usersService.updateMe(body, req.identity)
  })

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

  // Invitación atómica: crea el user + emite el evento del magic-link.
  // Se monta antes de `/:id` para que el router elija /invite como ruta
  // exacta cuando llega ese path.
  fastify.post('/v1/users/invite', async (req) => {
    requireStaffOrAdmin(req)
    const body = inviteBody.parse(req.body)
    return usersService.inviteUser(body, req.identity)
  })

  fastify.get('/v1/users/:id', async (req) => {
    requireStaffOrAdmin(req)
    const { id } = idParams.parse(req.params)
    return usersService.getById(id, req.identity)
  })

  fastify.patch('/v1/users/:id', async (req) => {
    requireStaffOrAdmin(req)
    const { id } = idParams.parse(req.params)
    const body = profileBody.parse(req.body)
    return usersService.updateUser(id, body, req.identity)
  })

  fastify.delete('/v1/users/:id', async (req, reply) => {
    requireStaffOrAdmin(req)
    await usersService.revokeUser({ id: req.params.id }, req.identity)
    return reply.status(204).send()
  })
}
