// dojos.service — CRUD básico con guard de rol y validación.
// Contrato:
//   - listDojos: requiere tenantId (else ValidationError).
//   - createDojo / deleteDojo:
//       · identity.userId missing → ForbiddenError.
//       · role !== owner/admin → ForbiddenError "Only owner/admin can …".
//   - APP_ID está hardcoded a 'aikikan' en listDojos (no usa identity).
//   - deleteDojo retorna 404 si el repo.deleteById devuelve false.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: {
    NODE_ENV: 'test', LOG_LEVEL: 'error',
    DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost',
    PLATFORM_JWT_SECRET: 'test-secret-32-chars-xxxxxxxxxxxxxxx',
  },
}))
vi.mock('../lib/db.js', () => ({ pool: {}, withTenantTransaction: vi.fn() }))
vi.mock('../repositories/dojos.repository.js')

import { listDojos, createDojo, deleteDojo } from '../services/dojos.service.js'
import { withTenantTransaction } from '../lib/db.js'
import * as repo from '../repositories/dojos.repository.js'

const APP    = 'aikikan'
const TENANT = '22222222-2222-2222-2222-222222222222'

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn({}))
})

// ── listDojos ────────────────────────────────────────────────────────

describe('listDojos', () => {
  it('happy: scope = (APP_ID hardcoded "aikikan", tenantId param, sub=null)', async () => {
    repo.findAll.mockResolvedValue([{ id: 'd1' }, { id: 'd2' }])
    const r = await listDojos(TENANT)
    expect(withTenantTransaction).toHaveBeenCalledWith(
      expect.anything(), APP, TENANT, null, expect.any(Function),
    )
    expect(r).toHaveLength(2)
  })

  it('tenantId vacío → ValidationError 422', async () => {
    await expect(listDojos(null)).rejects.toMatchObject({ statusCode: 422 })
    await expect(listDojos(undefined)).rejects.toMatchObject({ statusCode: 422 })
    await expect(listDojos('')).rejects.toMatchObject({ statusCode: 422 })
    expect(repo.findAll).not.toHaveBeenCalled()
  })
})

// ── createDojo — role guard ──────────────────────────────────────────

describe('createDojo — role guard', () => {
  it.each([['user'], ['staff'], ['member'], [null], [undefined]])(
    'rol "%s" → ForbiddenError', async (role) => {
      await expect(createDojo(
        { userId: 'u1', appId: APP, tenantId: TENANT, role },
        { name: 'Honbu' },
      )).rejects.toMatchObject({ statusCode: 403 })
      expect(repo.insert).not.toHaveBeenCalled()
    },
  )

  it.each([['owner'], ['admin']])('rol "%s" → permitido', async (role) => {
    repo.insert.mockResolvedValue({ id: 'd1', name: 'Honbu' })
    const r = await createDojo(
      { userId: 'u1', appId: APP, tenantId: TENANT, role },
      { name: 'Honbu', address: 'Madrid' },
    )
    expect(r.id).toBe('d1')
    expect(repo.insert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      appId: APP, tenantId: TENANT, subTenantId: null,
      name: 'Honbu', address: 'Madrid',
    }))
  })

  it('identity sin userId → ForbiddenError', async () => {
    await expect(createDojo({ role: 'admin' }, { name: 'X' })).rejects.toMatchObject({ statusCode: 403 })
  })
})

// ── deleteDojo — role guard + 404 ────────────────────────────────────

describe('deleteDojo', () => {
  it('rol "user" → ForbiddenError', async () => {
    await expect(deleteDojo({ userId: 'u1', appId: APP, tenantId: TENANT, role: 'user' }, 'd1'))
      .rejects.toMatchObject({ statusCode: 403 })
  })

  it('happy: rol admin + dojo existe', async () => {
    repo.deleteById.mockResolvedValue(true)
    await expect(deleteDojo({ userId: 'u1', appId: APP, tenantId: TENANT, role: 'admin' }, 'd1'))
      .resolves.toBeUndefined()
    expect(repo.deleteById).toHaveBeenCalledWith(expect.anything(), 'd1')
  })

  it('dojo no existe (repo→false) → NotFoundError 404', async () => {
    repo.deleteById.mockResolvedValue(false)
    await expect(deleteDojo({ userId: 'u1', appId: APP, tenantId: TENANT, role: 'owner' }, 'ghost'))
      .rejects.toMatchObject({ statusCode: 404 })
  })

  it('identity sin userId → ForbiddenError', async () => {
    await expect(deleteDojo({ role: 'admin' }, 'd1')).rejects.toMatchObject({ statusCode: 403 })
  })
})
