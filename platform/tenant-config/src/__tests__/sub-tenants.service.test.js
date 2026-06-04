// sub-tenants.service — CRUD del segundo nivel de tenancy + eventos.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL_TENANTS: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../lib/db.js', () => ({ pool: {}, withTransaction: vi.fn() }))
vi.mock('../lib/redis.js', () => ({ publish: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../repositories/sub-tenants.repository.js')
vi.mock('../repositories/tenants.repository.js')
vi.mock('../repositories/audit.repository.js')

import {
  listSubTenants, getSubTenant, createSubTenant, updateSubTenant, deleteSubTenant,
} from '../services/sub-tenants.service.js'
import { withTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as subRepo from '../repositories/sub-tenants.repository.js'
import * as tenantsRepo from '../repositories/tenants.repository.js'
import * as auditRepo from '../repositories/audit.repository.js'
import { logger } from '../lib/logger.js'

const actor = { userId: 'u1', role: 'staff', ip: '1.2.3.4' }
const parent = { id: 't1', app_id: 'aikikan' }

beforeEach(() => {
  vi.clearAllMocks()
  withTransaction.mockImplementation(async (_p, fn) => fn({}))
  tenantsRepo.findById.mockResolvedValue(parent)
})

describe('listSubTenants', () => {
  it('valida padre y lista', async () => {
    subRepo.findByTenant.mockResolvedValue([{ id: 's1' }])
    expect(await listSubTenants('t1')).toEqual([{ id: 's1' }])
  })
  it('padre inexistente → 404 Tenant', async () => {
    tenantsRepo.findById.mockResolvedValue(null)
    await expect(listSubTenants('x')).rejects.toThrow(/Tenant/)
  })
})

describe('getSubTenant', () => {
  it('devuelve el sub-tenant', async () => {
    subRepo.findById.mockResolvedValue({ id: 's1' })
    expect(await getSubTenant('t1', 's1')).toEqual({ id: 's1' })
  })
  it('no existe → 404 SubTenant', async () => {
    subRepo.findById.mockResolvedValue(null)
    await expect(getSubTenant('t1', 'x')).rejects.toThrow(/SubTenant/)
  })
})

describe('createSubTenant', () => {
  it('hereda app_id del padre, audita y emite evento', async () => {
    subRepo.create.mockResolvedValue({ id: 's1', app_id: 'aikikan' })
    const r = await createSubTenant('t1', { displayName: 'Norte', slug: 'norte' }, actor)
    expect(r.id).toBe('s1')
    expect(subRepo.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ appId: 'aikikan', slug: 'norte' }))
    expect(auditRepo.insert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'SUB_TENANT_CREATED' }))
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'tenant.config.updated' }))
  })

  it('slug duplicado (23505) → ConflictError', async () => {
    withTransaction.mockImplementation(async () => { throw Object.assign(new Error(), { code: '23505' }) })
    await expect(createSubTenant('t1', { displayName: 'N', slug: 'norte' }, actor)).rejects.toThrow(/slug already exists/)
  })

  it('otro error → re-lanza', async () => {
    withTransaction.mockImplementation(async () => { throw new Error('boom') })
    await expect(createSubTenant('t1', { displayName: 'N', slug: 's' }, actor)).rejects.toThrow('boom')
  })

  it('fallo publish → best-effort (warn, no rompe)', async () => {
    subRepo.create.mockResolvedValue({ id: 's1', app_id: 'aikikan' })
    publish.mockRejectedValueOnce(new Error('redis down'))
    const r = await createSubTenant('t1', { displayName: 'N', slug: 's' }, actor)
    expect(r.id).toBe('s1')
    expect(logger.warn).toHaveBeenCalled()
  })
})

describe('updateSubTenant', () => {
  it('actualiza + audita + evento', async () => {
    subRepo.update.mockResolvedValue({ id: 's1', app_id: 'aikikan' })
    await updateSubTenant('t1', 's1', { status: 'suspended' }, actor)
    expect(auditRepo.insert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'SUB_TENANT_UPDATED' }))
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'tenant.config.updated' }))
  })
  it('no existe → 404', async () => {
    subRepo.update.mockResolvedValue(null)
    await expect(updateSubTenant('t1', 'x', { status: 'active' }, actor)).rejects.toThrow(/SubTenant/)
  })
  it('slug duplicado → ConflictError', async () => {
    withTransaction.mockImplementation(async () => { throw Object.assign(new Error(), { code: '23505' }) })
    await expect(updateSubTenant('t1', 's1', { slug: 'dup' }, actor)).rejects.toThrow(/slug already exists/)
  })
})

describe('deleteSubTenant', () => {
  it('borra + audita + evento', async () => {
    subRepo.remove.mockResolvedValue({ id: 's1' })
    const r = await deleteSubTenant('t1', 's1', actor)
    expect(r).toEqual({ id: 's1', deleted: true })
    expect(auditRepo.insert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'SUB_TENANT_DELETED' }))
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'tenant.config.updated' }))
  })
  it('no existe → 404', async () => {
    subRepo.remove.mockResolvedValue(null)
    await expect(deleteSubTenant('t1', 'x', actor)).rejects.toThrow(/SubTenant/)
  })
})
