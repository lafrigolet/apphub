import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../lib/db.js', () => ({
  pool: { connect: vi.fn() },
  withTenantTransaction: vi.fn(),
}))
vi.mock('../lib/redis.js', () => ({
  publish: vi.fn(),
}))
vi.mock('../repositories/services.repository.js')

import * as service from '../services/services.service.js'
import { withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as repo from '../repositories/services.repository.js'
import { ConflictError, NotFoundError } from '@apphub/platform-sdk/errors'

const APP_ID    = 'yoga-studio'
const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const SVC_ID    = '11111111-1111-1111-1111-111111111111'

const ctx = { appId: APP_ID, tenantId: TENANT_ID, subTenantId: null, userId: 'u1', role: 'admin' }

function mockClient() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }
}

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(mockClient()))
})

describe('createService', () => {
  it('persists, scopes, publishes service.published', async () => {
    repo.insert.mockResolvedValue({ id: SVC_ID, code: 'CONS', modality: 'in_person' })
    await service.createService(ctx, { code: 'CONS', name: 'Consultation', durationMinutes: 30 })
    expect(repo.insert).toHaveBeenCalledWith(
      expect.anything(), APP_ID, TENANT_ID,
      expect.objectContaining({ code: 'CONS', durationMinutes: 30 }),
    )
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'service.published',
      payload: expect.objectContaining({ serviceId: SVC_ID, code: 'CONS' }),
    }))
  })

  it('translates 23505 unique-violation into ConflictError', async () => {
    const dup = Object.assign(new Error('dup'), { code: '23505' })
    repo.insert.mockRejectedValue(dup)
    await expect(service.createService(ctx, { code: 'X', name: 'X', durationMinutes: 30 }))
      .rejects.toThrow(ConflictError)
  })

  it('rethrows non-conflict errors', async () => {
    repo.insert.mockRejectedValue(new Error('boom'))
    await expect(service.createService(ctx, { code: 'X', name: 'X', durationMinutes: 30 }))
      .rejects.toThrow('boom')
  })
})

describe('getService / listServices', () => {
  it('getService throws NotFoundError when missing', async () => {
    repo.findById.mockResolvedValue(null)
    await expect(service.getService(ctx, SVC_ID)).rejects.toThrow(NotFoundError)
  })

  it('getService returns service when present', async () => {
    repo.findById.mockResolvedValue({ id: SVC_ID })
    const r = await service.getService(ctx, SVC_ID)
    expect(r.id).toBe(SVC_ID)
  })

  it('listServices delegates with options', async () => {
    repo.listByTenant.mockResolvedValue([])
    await service.listServices(ctx, { onlyActive: true, category: 'consult' })
    expect(repo.listByTenant).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, { onlyActive: true, category: 'consult' })
  })
})

describe('updateService', () => {
  it('updates and returns', async () => {
    repo.update.mockResolvedValue({ id: SVC_ID, name: 'Updated' })
    const r = await service.updateService(ctx, SVC_ID, { name: 'Updated' })
    expect(r.name).toBe('Updated')
  })

  it('throws NotFoundError when missing', async () => {
    repo.update.mockResolvedValue(null)
    await expect(service.updateService(ctx, SVC_ID, { name: 'X' })).rejects.toThrow(NotFoundError)
  })
})

describe('deactivateService', () => {
  it('deactivates and publishes service.deprecated', async () => {
    repo.deactivate.mockResolvedValue({ id: SVC_ID, code: 'CONS' })
    await service.deactivateService(ctx, SVC_ID)
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'service.deprecated',
      payload: expect.objectContaining({ serviceId: SVC_ID, code: 'CONS' }),
    }))
  })

  it('throws NotFoundError when missing', async () => {
    repo.deactivate.mockResolvedValue(null)
    await expect(service.deactivateService(ctx, SVC_ID)).rejects.toThrow(NotFoundError)
  })
})

describe('categories', () => {
  it('createCategory injects tenant scope', async () => {
    repo.insertCategory.mockResolvedValue({ id: 'c1' })
    await service.createCategory(ctx, { name: 'Mains' })
    expect(repo.insertCategory).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, { name: 'Mains' })
  })

  it('listCategories delegates', async () => {
    repo.listCategories.mockResolvedValue([])
    await service.listCategories(ctx)
    expect(repo.listCategories).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID)
  })
})
