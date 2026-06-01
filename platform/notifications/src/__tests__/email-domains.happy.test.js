// email-domains.service — happy-paths de getForTenant / listForTenant /
// updateDefaultsForTenant / suspendForTenant (complementa el test de 404s).
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
vi.mock('../repositories/email-domains.repository.js')
vi.mock('../repositories/config.repository.js', () => ({ getValue: vi.fn().mockResolvedValue(null) }))
vi.mock('../services/resend-domains.service.js', () => ({
  createBrandedDomain: vi.fn(), validateBrandedDomain: vi.fn(), deleteBrandedDomain: vi.fn(),
}))

import { listForTenant, getForTenant, updateDefaultsForTenant, suspendForTenant } from '../services/email-domains.service.js'
import { withTenantTransaction } from '../lib/db.js'
import * as repo from '../repositories/email-domains.repository.js'

const ctx = { appId: 'aikikan', tenantId: 't1', subTenantId: null }

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn({}))
})

it('listForTenant devuelve la lista', async () => {
  repo.listForTenant.mockResolvedValue([{ id: 'd1' }])
  expect(await listForTenant(ctx)).toEqual([{ id: 'd1' }])
})

it('getForTenant devuelve el dominio existente', async () => {
  repo.findById.mockResolvedValue({ id: 'd1' })
  expect(await getForTenant(ctx, 'd1')).toEqual({ id: 'd1' })
})

it('updateDefaultsForTenant actualiza cuando existe', async () => {
  repo.findById.mockResolvedValue({ id: 'd1' })
  repo.updateDefaults.mockResolvedValue({ id: 'd1', default_from_name: 'X' })
  const r = await updateDefaultsForTenant(ctx, 'd1', { defaultFromName: 'X' })
  expect(r.default_from_name).toBe('X')
  expect(repo.updateDefaults).toHaveBeenCalledWith(expect.anything(), 'd1', { defaultFromName: 'X' })
})

it('suspendForTenant suspende cuando existe', async () => {
  repo.findById.mockResolvedValue({ id: 'd1' })
  repo.suspend.mockResolvedValue({ id: 'd1', status: 'suspended' })
  const r = await suspendForTenant(ctx, 'd1', 'abuse')
  expect(r.status).toBe('suspended')
  expect(repo.suspend).toHaveBeenCalledWith(expect.anything(), 'd1', 'abuse')
})
