// users.routes — delega en usersService; gate de staff/admin (requireStaffOrAdmin),
// validación zod, y status codes (200/204/403). app-guard stub setea req.identity
// según el Bearer token.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import { ZodError } from 'zod'

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('../services/users.service.js', () => ({
  getMe: vi.fn(),
  updateMe: vi.fn(),
  listUsers: vi.fn(),
  changeRole: vi.fn(),
  inviteUser: vi.fn(),
  getById: vi.fn(),
  updateUser: vi.fn(),
  revokeUser: vi.fn(),
  approveUser: vi.fn(),
  rejectUser: vi.fn(),
  resendInvitation: vi.fn(),
}))

vi.mock('../services/auth.service.js', () => ({
  listSessions: vi.fn(),
}))

import { usersRoutes } from '../routes/users.routes.js'
import * as usersService from '../services/users.service.js'
import * as authService from '../services/auth.service.js'
import { AppError } from '../utils/errors.js'

const TENANT = '22222222-2222-2222-2222-222222222222'
const UID    = '11111111-1111-1111-1111-111111111111'

function identityFromToken(token) {
  const role = token === 'staff-token' ? 'staff'
    : token === 'admin-token' ? 'admin'
    : 'user'
  return { userId: UID, appId: 'platform', tenantId: TENANT, role }
}

async function buildApp() {
  const app = Fastify({ logger: false, ignoreTrailingSlash: true })
  const zodCompiler = ({ schema }) => (data) => {
    if (schema?.safeParse) {
      const r = schema.safeParse(data)
      return r.success ? { value: r.data } : { error: r.error }
    }
    return { value: data }
  }
  app.setValidatorCompiler(zodCompiler)
  app.setSerializerCompiler(() => (d) => JSON.stringify(d))
  app.decorateRequest('identity', null)
  app.addHook('onRequest', async (req, reply) => {
    const auth = req.headers.authorization ?? ''
    if (!auth.startsWith('Bearer ')) {
      return reply.status(401).send({ error: { code: 'UNAUTHORIZED' } })
    }
    req.identity = identityFromToken(auth.slice(7))
  })
  await app.register(usersRoutes)
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError || err.code === 'FST_ERR_VALIDATION') {
      return reply.status(422).send({ error: { code: 'VALIDATION_ERROR' } })
    }
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
    }
    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: err.message } })
  })
  await app.ready()
  return app
}

let app
beforeEach(async () => { vi.clearAllMocks(); app = await buildApp() })
afterEach(async () => { await app.close() })

const staff = { Authorization: 'Bearer staff-token' }
const user  = { Authorization: 'Bearer user-token' }

describe('GET /v1/users/me', () => {
  it('devuelve el perfil propio del identity', async () => {
    usersService.getMe.mockResolvedValue({ id: UID })
    const res = await app.inject({ method: 'GET', url: '/v1/users/me', headers: user })
    expect(res.statusCode).toBe(200)
    expect(usersService.getMe).toHaveBeenCalledWith(expect.objectContaining({ userId: UID }))
  })

  it('sin Bearer → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/users/me' })
    expect(res.statusCode).toBe(401)
  })
})

describe('PATCH /v1/users/me', () => {
  it('actualiza displayName', async () => {
    usersService.updateMe.mockResolvedValue({ id: UID, display_name: 'New' })
    const res = await app.inject({
      method: 'PATCH', url: '/v1/users/me', headers: { ...user, 'Content-Type': 'application/json' },
      payload: { displayName: 'New' },
    })
    expect(res.statusCode).toBe(200)
    expect(usersService.updateMe).toHaveBeenCalledWith({ displayName: 'New' }, expect.anything())
  })
})

describe('GET /v1/users/me/sessions', () => {
  it('devuelve las sesiones activas del usuario autenticado', async () => {
    authService.listSessions.mockResolvedValue([{ tokenSuffix: 'abcd1234', ttlSeconds: 1000 }])
    const res = await app.inject({ method: 'GET', url: '/v1/users/me/sessions', headers: user })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual([{ tokenSuffix: 'abcd1234', ttlSeconds: 1000 }])
    expect(authService.listSessions).toHaveBeenCalledWith({ appId: 'platform', tenantId: TENANT, userId: UID })
  })

  it('401 sin Bearer', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/users/me/sessions' })
    expect(res.statusCode).toBe(401)
  })
})

describe('GET /v1/users — staff gate', () => {
  it('user normal → 403', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/users', headers: user })
    expect(res.statusCode).toBe(403)
    expect(usersService.listUsers).not.toHaveBeenCalled()
  })

  it('staff → lista; role csv → array', async () => {
    usersService.listUsers.mockResolvedValue([{ id: UID }])
    const res = await app.inject({
      method: 'GET',
      url: `/v1/users?appId=aikikan&tenantId=${TENANT}&role=admin,owner&pending=approval`,
      headers: staff,
    })
    expect(res.statusCode).toBe(200)
    expect(usersService.listUsers).toHaveBeenCalledWith(
      expect.objectContaining({ role: ['admin', 'owner'], pending: 'approval' }),
      expect.anything(),
    )
  })

  it('staff sin role → role undefined', async () => {
    usersService.listUsers.mockResolvedValue([])
    await app.inject({ method: 'GET', url: '/v1/users', headers: staff })
    expect(usersService.listUsers).toHaveBeenCalledWith(
      expect.objectContaining({ role: undefined }), expect.anything(),
    )
  })
})

describe('PATCH /v1/users/:id/role', () => {
  it('user → 403', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/v1/users/${UID}/role`, headers: { ...user, 'Content-Type': 'application/json' },
      payload: { role: 'admin' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('staff cambia role', async () => {
    usersService.changeRole.mockResolvedValue({ id: UID, role: 'admin' })
    const res = await app.inject({
      method: 'PATCH', url: `/v1/users/${UID}/role`, headers: { ...staff, 'Content-Type': 'application/json' },
      payload: { role: 'admin' },
    })
    expect(res.statusCode).toBe(200)
    expect(usersService.changeRole).toHaveBeenCalledWith({ id: UID, role: 'admin' }, expect.anything())
  })
})

describe('POST /v1/users/invite', () => {
  it('staff invita', async () => {
    usersService.inviteUser.mockResolvedValue({ userId: 'new' })
    const res = await app.inject({
      method: 'POST', url: '/v1/users/invite', headers: { ...staff, 'Content-Type': 'application/json' },
      payload: { appId: 'aikikan', tenantId: TENANT, email: 'a@x.com', role: 'user' },
    })
    expect(res.statusCode).toBe(200)
    expect(usersService.inviteUser).toHaveBeenCalled()
  })

  it('user → 403', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/users/invite', headers: { ...user, 'Content-Type': 'application/json' },
      payload: { appId: 'aikikan', tenantId: TENANT, email: 'a@x.com' },
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('GET /v1/users/:id', () => {
  it('staff lee user', async () => {
    usersService.getById.mockResolvedValue({ id: UID })
    const res = await app.inject({ method: 'GET', url: `/v1/users/${UID}`, headers: staff })
    expect(res.statusCode).toBe(200)
    expect(usersService.getById).toHaveBeenCalledWith(UID, expect.anything())
  })

  it('user → 403', async () => {
    const res = await app.inject({ method: 'GET', url: `/v1/users/${UID}`, headers: user })
    expect(res.statusCode).toBe(403)
  })
})

describe('PATCH /v1/users/:id', () => {
  it('staff actualiza', async () => {
    usersService.updateUser.mockResolvedValue({ id: UID })
    const res = await app.inject({
      method: 'PATCH', url: `/v1/users/${UID}`, headers: { ...staff, 'Content-Type': 'application/json' },
      payload: { displayName: 'New' },
    })
    expect(res.statusCode).toBe(200)
  })
})

describe('DELETE /v1/users/:id', () => {
  it('staff revoca → 204', async () => {
    usersService.revokeUser.mockResolvedValue()
    const res = await app.inject({ method: 'DELETE', url: `/v1/users/${UID}`, headers: staff })
    expect(res.statusCode).toBe(204)
    expect(usersService.revokeUser).toHaveBeenCalledWith({ id: UID }, expect.anything())
  })

  it('user → 403', async () => {
    const res = await app.inject({ method: 'DELETE', url: `/v1/users/${UID}`, headers: user })
    expect(res.statusCode).toBe(403)
  })
})

describe('POST /v1/users/:id/approve', () => {
  it('staff aprueba → data', async () => {
    usersService.approveUser.mockResolvedValue({ id: UID })
    const res = await app.inject({ method: 'POST', url: `/v1/users/${UID}/approve`, headers: staff })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.id).toBe(UID)
  })
})

describe('POST /v1/users/:id/reject', () => {
  it('staff rechaza → 204; body opcional', async () => {
    usersService.rejectUser.mockResolvedValue()
    const res = await app.inject({
      method: 'POST', url: `/v1/users/${UID}/reject`, headers: { ...staff, 'Content-Type': 'application/json' },
      payload: { reason: 'spam' },
    })
    expect(res.statusCode).toBe(204)
    expect(usersService.rejectUser).toHaveBeenCalledWith(UID, expect.anything(), { reason: 'spam' })
  })

  it('sin body → 204', async () => {
    usersService.rejectUser.mockResolvedValue()
    const res = await app.inject({ method: 'POST', url: `/v1/users/${UID}/reject`, headers: staff })
    expect(res.statusCode).toBe(204)
  })
})

describe('POST /v1/users/:id/resend-invitation', () => {
  it('staff reenvía → 204', async () => {
    usersService.resendInvitation.mockResolvedValue()
    const res = await app.inject({ method: 'POST', url: `/v1/users/${UID}/resend-invitation`, headers: staff })
    expect(res.statusCode).toBe(204)
    expect(usersService.resendInvitation).toHaveBeenCalledWith(UID, expect.anything())
  })

  it('user → 403', async () => {
    const res = await app.inject({ method: 'POST', url: `/v1/users/${UID}/resend-invitation`, headers: user })
    expect(res.statusCode).toBe(403)
  })
})

// La rama `req.body ?? {}` del handler de reject es inalcanzable por HTTP
// (fastify nunca entrega body=undefined al handler). La cubrimos invocando
// el handler directamente con un recorder de rutas.
describe('reject handler — req.body undefined (?? {})', () => {
  async function captureRoutes() {
    const routes = []
    const fakeFastify = {
      get:   (p, o, h) => routes.push({ m: 'get',   p, h: h ?? o }),
      post:  (p, o, h) => routes.push({ m: 'post',  p, h: h ?? o }),
      patch:  (p, o, h) => routes.push({ m: 'patch',  p, h: h ?? o }),
      put:    (p, o, h) => routes.push({ m: 'put',    p, h: h ?? o }),
      delete: (p, o, h) => routes.push({ m: 'delete', p, h: h ?? o }),
    }
    await usersRoutes(fakeFastify)
    return routes
  }

  it('POST /v1/users/:id/reject con req.body undefined → parse({}) → rejectUser', async () => {
    usersService.rejectUser.mockResolvedValue()
    const routes = await captureRoutes()
    const reject = routes.find((r) => r.m === 'post' && r.p === '/v1/users/:id/reject')
    const reply = { status: () => ({ send: () => {} }) }
    await reject.h(
      { params: { id: UID }, body: undefined, identity: { userId: UID, role: 'staff' } },
      reply,
    )
    expect(usersService.rejectUser).toHaveBeenCalledWith(UID, expect.anything(), {})
  })
})
