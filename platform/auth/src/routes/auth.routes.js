import { z } from 'zod'
import * as authService from '../services/auth.service.js'

const registerBody = z.object({
  appId:      z.string().min(1),
  tenantId:   z.string().uuid(),
  subTenantId: z.string().uuid().optional(),
  email:      z.string().email(),
  password:   z.string().min(8),
  role:       z.string().default('user'),
})

const loginBody = z.object({
  appId:    z.string().min(1).optional(),
  tenantId: z.string().uuid().optional(),
  email:    z.string().email(),
  password: z.string(),
})

const refreshBody = z.object({
  appId:        z.string().min(1),
  tenantId:     z.string().uuid(),
  userId:       z.string().uuid(),
  refreshToken: z.string().uuid(),
})

const forgotBody = z.object({
  appId:    z.string().min(1),
  tenantId: z.string().uuid(),
  email:    z.string().email(),
})

const resetBody = z.object({
  token:       z.string().uuid(),
  newPassword: z.string().min(8),
})

const activateBody = z.object({
  token:    z.string().min(16),
  password: z.string().min(8),
})

const internalCreateOwnerBody = z.object({
  appId:       z.string().min(1),
  tenantId:    z.string().uuid(),
  email:       z.string().email(),
  displayName: z.string().min(1).max(128),
  ttlDays:     z.number().int().min(1).max(30).optional(),
})

const internalReissueBody = z.object({
  userId:  z.string().uuid(),
  ttlDays: z.number().int().min(1).max(30).optional(),
})

export async function authRoutes(fastify) {
  fastify.post('/register', { schema: { body: registerBody }, config: { public: true } }, async (req, reply) => {
    const user = await authService.register(req.body)
    return reply.status(201).send({ data: user })
  })

  fastify.post('/login', { schema: { body: loginBody }, config: { public: true } }, async (req, reply) => {
    const result = await authService.login(req.body)
    return reply.send({ data: result })
  })

  fastify.post('/refresh', { schema: { body: refreshBody }, config: { public: true } }, async (req, reply) => {
    const result = await authService.refresh(req.body)
    return reply.send({ data: result })
  })

  fastify.post('/forgot-password', { schema: { body: forgotBody }, config: { public: true } }, async (req, reply) => {
    await authService.forgotPassword(req.body)
    return reply.send({ data: { message: 'If that email exists, a reset link has been sent' } })
  })

  fastify.post('/reset-password', { schema: { body: resetBody }, config: { public: true } }, async (req, reply) => {
    await authService.resetPassword(req.body)
    return reply.send({ data: { message: 'Password reset successfully' } })
  })

  // Magic-link landing — el owner llega aquí desde el email de bootstrap.
  // Consume el token, fija contraseña y devuelve un par (access, refresh)
  // listos para usar como cualquier login normal.
  fastify.post('/activate', { schema: { body: activateBody }, config: { public: true } }, async (req, reply) => {
    const result = await authService.activate(req.body)
    return reply.send({ data: result })
  })
}

export async function internalRoutes(fastify) {
  fastify.get('/validate', { config: { public: true } }, async (req, reply) => {
    const authHeader = req.headers.authorization
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token) return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Missing token' } })
    try {
      const identity = authService.validateToken(token)
      return reply.send({ data: identity })
    } catch {
      return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Invalid token' } })
    }
  })

  // Internal: invoca tenant-config tras crear app+tenant. Crea el usuario
  // owner con password_hash NULL y un activation_token, devuelve el plano
  // del token. Caller responsibility: enviar el email con el magic-link.
  fastify.post('/auth/owners', { schema: { body: internalCreateOwnerBody }, config: { public: true } }, async (req, reply) => {
    const result = await authService.createOwnerWithActivation(req.body)
    return reply.status(201).send({ data: result })
  })

  // Internal: reemite un activation_token tras invalidar los activos.
  fastify.post('/auth/owners/reissue', { schema: { body: internalReissueBody }, config: { public: true } }, async (req, reply) => {
    const result = await authService.reissueActivationForOwner(req.body)
    return reply.send({ data: result })
  })

  // Internal: estado del owner (passwordSet, activated). Lo consume el
  // GET /v1/tenants/:id/bootstrap derivado.
  fastify.get('/auth/owners/state', { config: { public: true } }, async (req) => {
    const tenantId = req.query?.tenantId
    if (!tenantId) return { data: null }
    const owner = await authService.getOwnerState({ tenantId })
    return { data: owner }
  })

  // Internal: hard-delete del owner pendiente (parte del revoke de bootstrap).
  // Falla con 409 si el owner ya activó. Idempotente: si no hay owner devuelve 0.
  fastify.delete('/auth/owners', { config: { public: true } }, async (req) => {
    const tenantId = req.query?.tenantId
    if (!tenantId) return { data: { deleted: 0 } }
    const result = await authService.deletePendingOwner({ tenantId })
    return { data: result }
  })

  // Internal: cuenta admins en un tenant — paso "admins" del checklist.
  fastify.get('/auth/admins/count', { config: { public: true } }, async (req) => {
    const tenantId = req.query?.tenantId
    if (!tenantId) return { data: 0 }
    const count = await authService.countAdmins({ tenantId })
    return { data: count }
  })
}
