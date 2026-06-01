// Cobertura complementaria: rama de re-throw en addVariant cuando el INSERT
// falla con un error que NO es la violación de unicidad 23505.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../lib/db.js', () => ({ pool: {}, withTenantTransaction: vi.fn() }))
vi.mock('../lib/redis.js', () => ({ publish: vi.fn() }))
vi.mock('../repositories/inventory.repository.js')

import { addVariant } from '../services/inventory.service.js'
import { withTenantTransaction } from '../lib/db.js'
import * as repo from '../repositories/inventory.repository.js'

const ctx = { appId: 'shop', tenantId: 't1', subTenantId: null, userId: 'u1', role: 'admin' }

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn({}))
})

it('re-lanza errores del INSERT que no son 23505', async () => {
  repo.findBySku.mockResolvedValue({ sku: 'PARENT', parent_sku: null })
  repo.findByParentAndOptions.mockResolvedValue(null)
  const err = new Error('connection lost'); err.code = '08006'
  repo.upsert.mockRejectedValueOnce(err)
  await expect(addVariant(ctx, 'PARENT', { sku: 'P-M', optionValues: { size: 'M' } }))
    .rejects.toThrow('connection lost')
})
