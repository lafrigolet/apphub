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
}
