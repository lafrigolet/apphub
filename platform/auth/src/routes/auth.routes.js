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

const guestBody = z.object({
  appId:       z.string().min(1),
  tenantId:    z.string().uuid(),
  subTenantId: z.string().uuid().nullable().optional(),
  guestUserId: z.string().uuid().nullable().optional(),
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
  // El token de reset es ahora un secreto opaco (32 bytes base64url). Se
  // acepta cualquier string no trivial; las filas legacy (UUID) siguen
  // siendo válidas durante su TTL de 1h restante.
  token:       z.string().min(16),
  newPassword: z.string().min(8),
})

const logoutBody = z.object({
  refreshToken: z.string().uuid(),
})

// Rate-limits por ruta para endpoints públicos sensibles. El plugin global
// (@fastify/rate-limit) ya está registrado en platform-core; aquí sólo
// declaramos el override por ruta.
const TIGHT_LIMIT  = { max: 10, timeWindow: '1 minute' }   // login, magic-link, forgot
const MEDIUM_LIMIT = { max: 20, timeWindow: '1 minute' }   // register, request-membership, reset, activate

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

const requestMembershipBody = z.object({
  appId:       z.string().min(1),
  tenantId:    z.string().uuid(),
  email:       z.string().email(),
  displayName: z.string().min(1).max(128).optional(),
  notes:       z.string().max(2048).optional(),
})

const requestMagicLinkBody = z.object({
  appId:    z.string().min(1).optional(),
  tenantId: z.string().uuid().optional(),
  email:    z.string().email(),
})

const loginMagicLinkBody = z.object({
  token: z.string().min(16),
})

// Extrae IP y User-Agent de la request para auditoría. Respeta el primer
// hop de X-Forwarded-For si NGINX lo añade (platform-core corre detrás).
function clientMeta(req) {
  const xff = req.headers['x-forwarded-for']
  const ip = (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim() || req.ip || null
  const userAgent = req.headers['user-agent'] || null
  return { ip, userAgent }
}

export async function authRoutes(fastify) {
  fastify.post('/register', { schema: { body: registerBody, tags: ['auth'], summary: 'Register a new user (email + password)' }, config: { public: true, rateLimit: MEDIUM_LIMIT } }, async (req, reply) => {
    const user = await authService.register(req.body)
    return reply.status(201).send({ data: user })
  })

  // Ruta 1 (Solicitar Alta) — el visitante envía email + nombre, queda
  // pending_approval en DB hasta que un admin del tenant le apruebe.
  fastify.post('/request-membership', { schema: { body: requestMembershipBody, tags: ['auth'], summary: 'Request membership in a tenant requiring approval' }, config: { public: true, rateLimit: MEDIUM_LIMIT } }, async (req, reply) => {
    const result = await authService.requestMembership(req.body)
    return reply.status(201).send({ data: result })
  })

  // Magic-link passwordless (A8) — el user pide acceso sin contraseña.
  // Silencioso ante emails desconocidos; el email llega vía notifications.
  fastify.post('/request-magic-link', { schema: { body: requestMagicLinkBody, tags: ['auth'], summary: 'Request a passwordless magic-link by email' }, config: { public: true, rateLimit: TIGHT_LIMIT } }, async (req, reply) => {
    await authService.requestMagicLink(req.body)
    return reply.send({ data: { message: 'Si ese email existe, te hemos enviado un enlace de acceso.' } })
  })

  // Consume el magic-link y devuelve access + refresh tokens como un
  // login normal. El front lo llama con el `token` extraído del query
  // string del email.
  fastify.post('/login-with-magic-link', { schema: { body: loginMagicLinkBody, tags: ['auth'], summary: 'Consume a magic-link token and return tokens' }, config: { public: true, rateLimit: TIGHT_LIMIT } }, async (req, reply) => {
    const result = await authService.loginWithMagicLink(req.body)
    return reply.send({ data: result })
  })

  fastify.post('/login', { schema: { body: loginBody, tags: ['auth'], summary: 'Login with email + password' }, config: { public: true, rateLimit: TIGHT_LIMIT } }, async (req, reply) => {
    const result = await authService.login({ ...req.body, ...clientMeta(req) })
    return reply.send({ data: result })
  })

  // Sesión de invitado: visitantes anónimos de una landing obtienen un JWT
  // role='guest' para usar la cesta (platform/basket) y crear pedidos sin login.
  fastify.post('/guest', { schema: { body: guestBody, tags: ['auth'], summary: 'Mint a guest session token for anonymous storefront visitors' }, config: { public: true, rateLimit: MEDIUM_LIMIT } }, async (req, reply) => {
    const result = authService.guestSession(req.body)
    return reply.send({ data: result })
  })

  fastify.post('/refresh', { schema: { body: refreshBody, tags: ['auth'], summary: 'Rotate refresh token, issue new access token' }, config: { public: true, rateLimit: MEDIUM_LIMIT } }, async (req, reply) => {
    const result = await authService.refresh(req.body)
    return reply.send({ data: result })
  })

  // Logout explícito (recomendación #2): invalida el refresh token indicado
  // del usuario autenticado. Ruta protegida — la identidad sale del JWT.
  fastify.post('/logout', { schema: { body: logoutBody, tags: ['auth'], summary: 'Invalidate a specific refresh token (current session)' } }, async (req, reply) => {
    const result = await authService.logout({
      appId:    req.identity.appId,
      tenantId: req.identity.tenantId,
      userId:   req.identity.userId,
      refreshToken: req.body.refreshToken,
      ...clientMeta(req),
    })
    return reply.send({ data: result })
  })

  // Logout global: cierra todas las sesiones del usuario autenticado.
  fastify.post('/logout-all', { schema: { tags: ['auth'], summary: 'Invalidate all refresh tokens (all sessions)' } }, async (req, reply) => {
    const result = await authService.logoutAll({
      appId:    req.identity.appId,
      tenantId: req.identity.tenantId,
      userId:   req.identity.userId,
      ...clientMeta(req),
    })
    return reply.send({ data: result })
  })

  fastify.post('/forgot-password', { schema: { body: forgotBody, tags: ['auth'], summary: 'Request a password reset link' }, config: { public: true, rateLimit: TIGHT_LIMIT } }, async (req, reply) => {
    await authService.forgotPassword(req.body)
    return reply.send({ data: { message: 'If that email exists, a reset link has been sent' } })
  })

  fastify.post('/reset-password', { schema: { body: resetBody, tags: ['auth'], summary: 'Reset password using a reset token' }, config: { public: true, rateLimit: MEDIUM_LIMIT } }, async (req, reply) => {
    await authService.resetPassword(req.body)
    return reply.send({ data: { message: 'Password reset successfully' } })
  })

  // Magic-link landing — el owner llega aquí desde el email de bootstrap.
  // Consume el token, fija contraseña y devuelve un par (access, refresh)
  // listos para usar como cualquier login normal.
  fastify.post('/activate', { schema: { body: activateBody, tags: ['auth'], summary: 'Activate owner account, set password, return tokens' }, config: { public: true, rateLimit: MEDIUM_LIMIT } }, async (req, reply) => {
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
