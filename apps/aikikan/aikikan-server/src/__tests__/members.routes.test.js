// members.routes — wiring HTTP → service.
// Contrato:
//   - GET    /v1/aikikan/members/me      → service.getMe(req.identity)
//   - PATCH  /v1/aikikan/members/me      → updateBody.parse(req.body) → service.updateMe
//   - GET    /v1/aikikan/members         → service.listMembers
//   - GET    /v1/aikikan/members/:userId → service.getMemberByUserId
//   - PATCH  /v1/aikikan/members/:userId → updateBody.parse + service.updateMemberAdmin
//   - Body validation: memberSince debe ser YYYY-MM-DD; dojoName max 128 chars.
//   - me route: si service devuelve null, responde {empty:true, user_id,...} desde JWT.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../lib/env.js', () => ({
  env: {
    NODE_ENV: 'test', LOG_LEVEL: 'error',
    DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost',
    PLATFORM_JWT_SECRET: 'test-secret-32-chars-xxxxxxxxxxxxxxx',
  },
}))
vi.mock('../lib/db.js', () => ({ pool: {}, withTenantTransaction: vi.fn() }))
vi.mock('../services/members.service.js')
import * as service from '../services/members.service.js'
import { membersRoutes } from '../routes/members.routes.js'

const identity = {
  userId: '11111111-1111-1111-1111-111111111111',
  appId: 'aikikan',
  tenantId: '22222222-2222-2222-2222-222222222222',
  subTenantId: null,
  role: 'user',
  email: 'a@b.com',
}

async function buildApp(role = 'user') {
  const app = Fastify({ logger: false })
  // Inyecta identity como hook simple (en lugar de appGuard).
  app.addHook('onRequest', async (req) => { req.identity = { ...identity, role } })
  await app.register(membersRoutes)
  return app
}

beforeEach(() => vi.clearAllMocks())

// ── GET /me ──────────────────────────────────────────────────────────

describe('GET /v1/aikikan/members/me', () => {
  it('200 + perfil cuando existe', async () => {
    service.getMe.mockResolvedValue({ user_id: identity.userId, dojo_name: 'Honbu' })
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/v1/aikikan/members/me' })
    expect(res.statusCode).toBe(200)
    expect(res.json().dojo_name).toBe('Honbu')
    expect(service.getMe).toHaveBeenCalledWith(expect.objectContaining({ userId: identity.userId }))
  })

  it('200 + shell vacío con flag empty:true cuando no hay perfil', async () => {
    service.getMe.mockResolvedValue(null)
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/v1/aikikan/members/me' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      user_id: identity.userId,
      app_id: identity.appId,
      tenant_id: identity.tenantId,
      empty: true,
    })
  })
})

// ── PATCH /me ────────────────────────────────────────────────────────

describe('PATCH /v1/aikikan/members/me', () => {
  it('happy: parsea body y llama updateMe', async () => {
    service.updateMe.mockResolvedValue({ user_id: identity.userId, dojo_name: 'X' })
    const app = await buildApp()
    const res = await app.inject({
      method: 'PATCH', url: '/v1/aikikan/members/me',
      payload: { dojoName: 'X', aikidoGrade: '2 Dan' },
    })
    expect(res.statusCode).toBe(200)
    expect(service.updateMe).toHaveBeenCalledWith(
      expect.objectContaining({ userId: identity.userId }),
      { dojoName: 'X', aikidoGrade: '2 Dan' },
    )
  })

  it('body vacío = touch: igual llama updateMe con {}', async () => {
    service.updateMe.mockResolvedValue({ user_id: identity.userId })
    const app = await buildApp()
    const res = await app.inject({ method: 'PATCH', url: '/v1/aikikan/members/me', payload: {} })
    expect(res.statusCode).toBe(200)
    expect(service.updateMe).toHaveBeenCalledWith(expect.anything(), {})
  })

  it('memberSince con formato malo (no YYYY-MM-DD) → 500 zod throw', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'PATCH', url: '/v1/aikikan/members/me',
      payload: { memberSince: '2026/05/22' },
    })
    expect(res.statusCode).toBe(500)
    expect(service.updateMe).not.toHaveBeenCalled()
  })

  it('dojoName > 128 chars → rechazo (no llega al service)', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'PATCH', url: '/v1/aikikan/members/me',
      payload: { dojoName: 'x'.repeat(200) },
    })
    expect(res.statusCode).toBe(500)
    expect(service.updateMe).not.toHaveBeenCalled()
  })
})

// ── Admin endpoints (delegan el guard de rol al service) ────────────

describe('GET /v1/aikikan/members (admin)', () => {
  it('delega a listMembers', async () => {
    service.listMembers.mockResolvedValue([{ user_id: 'u1' }, { user_id: 'u2' }])
    const app = await buildApp('admin')
    const res = await app.inject({ method: 'GET', url: '/v1/aikikan/members' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveLength(2)
  })

  it('si service lanza 403 (rol "user"), 403 se propaga', async () => {
    service.listMembers.mockRejectedValue(Object.assign(new Error('forbidden'), { statusCode: 403 }))
    const app = await buildApp('user')
    const res = await app.inject({ method: 'GET', url: '/v1/aikikan/members' })
    expect(res.statusCode).toBe(403)
  })
})

describe('GET /v1/aikikan/members/:userId (admin)', () => {
  it('valida userId UUID + llama getMemberByUserId', async () => {
    service.getMemberByUserId.mockResolvedValue({ user_id: '11111111-1111-1111-1111-111111111111' })
    const app = await buildApp('admin')
    const res = await app.inject({
      method: 'GET',
      url: '/v1/aikikan/members/11111111-1111-1111-1111-111111111111',
    })
    expect(res.statusCode).toBe(200)
  })

  it('userId no-UUID → 500 zod throw', async () => {
    const app = await buildApp('admin')
    const res = await app.inject({ method: 'GET', url: '/v1/aikikan/members/not-a-uuid' })
    expect(res.statusCode).toBe(500)
    expect(service.getMemberByUserId).not.toHaveBeenCalled()
  })

  it('service 404 → 404', async () => {
    service.getMemberByUserId.mockRejectedValue(Object.assign(new Error('not found'), { statusCode: 404 }))
    const app = await buildApp('admin')
    const res = await app.inject({
      method: 'GET',
      url: '/v1/aikikan/members/11111111-1111-1111-1111-111111111111',
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('PATCH /v1/aikikan/members/:userId (admin)', () => {
  it('parsea userId y body, llama updateMemberAdmin', async () => {
    service.updateMemberAdmin.mockResolvedValue({ user_id: '11111111-1111-1111-1111-111111111111' })
    const app = await buildApp('admin')
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/aikikan/members/11111111-1111-1111-1111-111111111111',
      payload: { aikidoGrade: '3 Dan' },
    })
    expect(res.statusCode).toBe(200)
    expect(service.updateMemberAdmin).toHaveBeenCalledWith(
      expect.anything(),
      '11111111-1111-1111-1111-111111111111',
      { aikidoGrade: '3 Dan' },
    )
  })
})
