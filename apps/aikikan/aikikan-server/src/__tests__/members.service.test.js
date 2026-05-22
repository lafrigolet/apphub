// members.service — perfiles del app_aikikan.
// Contrato:
//   - getMe/updateMe operan sobre identity.userId del JWT (nunca un userId del URL/body).
//   - Las funciones admin (listMembers, getMemberByUserId, updateMemberAdmin) requieren
//     rol owner/admin/staff/super_admin → 403 si role='user'.
//   - El alcance multi-tenant lo fuerza withTenantTransaction (RLS), no las funciones.
//   - getMemberByUserId con userId inexistente → 404.
//   - deleteMember (invocado desde event handler) NO requiere identity — usa app/tenant del event.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: {
    NODE_ENV: 'test', LOG_LEVEL: 'error',
    DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost',
    JWT_SECRET: 'test-secret-32-chars-xxxxxxxxxxxxxxx',
  },
}))
vi.mock('../lib/db.js', () => ({
  pool: { connect: vi.fn() },
  withTenantTransaction: vi.fn(),
}))
vi.mock('../repositories/members.repository.js')

import {
  getMe, updateMe, listMembers, getMemberByUserId, updateMemberAdmin, deleteMember,
} from '../services/members.service.js'
import { withTenantTransaction } from '../lib/db.js'
import * as repo from '../repositories/members.repository.js'

const userId   = '11111111-1111-1111-1111-111111111111'
const appId    = 'aikikan'
const tenantId = '22222222-2222-2222-2222-222222222222'

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn({}))
})

// ── identity guard ───────────────────────────────────────────────────

describe('identity guard (me endpoints)', () => {
  it('getMe sin userId → ForbiddenError 403', async () => {
    await expect(getMe({})).rejects.toMatchObject({ statusCode: 403 })
    await expect(getMe(null)).rejects.toMatchObject({ statusCode: 403 })
  })
  it('updateMe sin userId → ForbiddenError 403', async () => {
    await expect(updateMe({}, { dojoName: 'X' })).rejects.toMatchObject({ statusCode: 403 })
  })
})

// ── getMe / updateMe ────────────────────────────────────────────────

describe('getMe', () => {
  it('llama repo.findByUserId con el userId del JWT', async () => {
    repo.findByUserId.mockResolvedValue({ user_id: userId, dojo_name: 'Honbu' })
    const r = await getMe({ userId, appId, tenantId, role: 'user' })
    expect(repo.findByUserId).toHaveBeenCalledWith(expect.anything(), userId)
    expect(withTenantTransaction).toHaveBeenCalledWith(
      expect.anything(), appId, tenantId, null, expect.any(Function),
    )
    expect(r.dojo_name).toBe('Honbu')
  })

  it('retorna null si el perfil aún no existe (caso "primera carga")', async () => {
    repo.findByUserId.mockResolvedValue(null)
    const r = await getMe({ userId, appId, tenantId, role: 'user' })
    expect(r).toBeNull()
  })

  it('pasa subTenantId del JWT al RLS context', async () => {
    repo.findByUserId.mockResolvedValue(null)
    const subTenantId = '33333333-3333-3333-3333-333333333333'
    await getMe({ userId, appId, tenantId, subTenantId, role: 'user' })
    expect(withTenantTransaction).toHaveBeenCalledWith(
      expect.anything(), appId, tenantId, subTenantId, expect.any(Function),
    )
  })
})

describe('updateMe', () => {
  it('upsert con userId y appId/tenantId DEL JWT (no del body)', async () => {
    repo.upsertProfile.mockResolvedValue({ user_id: userId, dojo_name: 'Dojo1' })
    await updateMe(
      { userId, appId, tenantId, role: 'user' },
      { dojoName: 'Dojo1', notes: 'nota' },
    )
    expect(repo.upsertProfile).toHaveBeenCalledWith(expect.anything(), {
      userId, appId, tenantId, subTenantId: null,
      fields: { dojoName: 'Dojo1', notes: 'nota' },
    })
  })
})

// ── admin role guard ─────────────────────────────────────────────────

describe('admin role guard', () => {
  it.each([
    ['user'],
    ['member'],
    ['guest'],
    [null],
    [undefined],
  ])('rol "%s" → 403 en listMembers', async (role) => {
    await expect(listMembers({ userId, appId, tenantId, role })).rejects.toMatchObject({
      statusCode: 403,
    })
    expect(repo.findAll).not.toHaveBeenCalled()
  })

  it.each([['owner'], ['admin'], ['staff'], ['super_admin']])(
    'rol "%s" → permitido en listMembers',
    async (role) => {
      repo.findAll.mockResolvedValue([])
      await expect(listMembers({ userId, appId, tenantId, role })).resolves.toEqual([])
    },
  )

  it('admin endpoints sin identity.userId → 403', async () => {
    await expect(listMembers({ role: 'admin' })).rejects.toMatchObject({ statusCode: 403 })
    await expect(getMemberByUserId({ role: 'admin' }, userId)).rejects.toMatchObject({ statusCode: 403 })
    await expect(updateMemberAdmin({ role: 'admin' }, userId, {})).rejects.toMatchObject({ statusCode: 403 })
  })
})

// ── admin endpoints ──────────────────────────────────────────────────

describe('getMemberByUserId (admin)', () => {
  it('happy: retorna el row del miembro', async () => {
    repo.findByUserId.mockResolvedValue({ user_id: userId, dojo_name: 'Dojo X' })
    const r = await getMemberByUserId({ userId: 'admin-1', appId, tenantId, role: 'admin' }, userId)
    expect(r.user_id).toBe(userId)
  })
  it('userId inexistente → NotFoundError 404', async () => {
    repo.findByUserId.mockResolvedValue(null)
    await expect(
      getMemberByUserId({ userId: 'admin-1', appId, tenantId, role: 'admin' }, 'ghost'),
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('updateMemberAdmin (admin)', () => {
  it('upsert con el userId del PARAMETRO, no del identity', async () => {
    repo.upsertProfile.mockResolvedValue({ user_id: userId })
    await updateMemberAdmin(
      { userId: 'admin-1', appId, tenantId, role: 'admin' },
      userId,
      { aikidoGrade: '1 Dan' },
    )
    expect(repo.upsertProfile).toHaveBeenCalledWith(expect.anything(), {
      userId,
      appId, tenantId, subTenantId: null,
      fields: { aikidoGrade: '1 Dan' },
    })
  })
})

// ── deleteMember (event handler) ─────────────────────────────────────

describe('deleteMember (invocado por event handler user.revoked)', () => {
  it('NO requiere identity — usa app/tenant/user del event payload', async () => {
    repo.deleteByUserId.mockResolvedValue(true)
    await deleteMember({ appId, tenantId, subTenantId: null, userId })
    expect(repo.deleteByUserId).toHaveBeenCalledWith(expect.anything(), userId)
    expect(withTenantTransaction).toHaveBeenCalledWith(
      expect.anything(), appId, tenantId, null, expect.any(Function),
    )
  })
})
