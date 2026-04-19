import { z } from 'zod'
import * as authService from '../services/auth.service.js'

const registerBody = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(['alumno', 'instructor', 'admin']).default('alumno'),
})

const loginBody = z.object({
  email: z.string().email(),
  password: z.string(),
})

const refreshBody = z.object({
  userId: z.string().uuid(),
  refreshToken: z.string().uuid(),
})

const forgotBody = z.object({
  email: z.string().email(),
})

const resetBody = z.object({
  token: z.string().uuid(),
  newPassword: z.string().min(8),
})

export async function authRoutes(fastify) {
  fastify.post('/register', { schema: { body: registerBody } }, async (req, reply) => {
    const user = await authService.register(req.body)
    return reply.status(201).send({ data: user })
  })

  fastify.post('/login', { schema: { body: loginBody } }, async (req, reply) => {
    const result = await authService.login(req.body)
    return reply.send({ data: result })
  })

  fastify.post('/refresh', { schema: { body: refreshBody } }, async (req, reply) => {
    const result = await authService.refresh(req.body)
    return reply.send({ data: result })
  })

  fastify.post('/forgot-password', { schema: { body: forgotBody } }, async (req, reply) => {
    await authService.forgotPassword(req.body)
    return reply.send({ data: { message: 'If that email exists, a reset link has been sent' } })
  })

  fastify.post('/reset-password', { schema: { body: resetBody } }, async (req, reply) => {
    await authService.resetPassword(req.body)
    return reply.send({ data: { message: 'Password reset successfully' } })
  })
}

export async function internalRoutes(fastify) {
  fastify.get('/validate', async (req, reply) => {
    const authHeader = req.headers.authorization
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token) return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Missing token' } })
    const result = await authService.validateToken(token)
    if (!result.valid) return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Invalid token' } })
    return reply.send({ data: result })
  })
}
