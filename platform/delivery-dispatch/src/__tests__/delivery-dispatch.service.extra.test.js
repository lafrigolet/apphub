// Cobertura adicional del service: list passthroughs (zones/riders/deliveries)
// que el test principal no ejercita.
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
vi.mock('../lib/redis.js', () => ({ publish: vi.fn() }))
vi.mock('../repositories/delivery-dispatch.repository.js')

import * as service from '../services/delivery-dispatch.service.js'
import { withTenantTransaction } from '../lib/db.js'
import * as repo from '../repositories/delivery-dispatch.repository.js'

const APP = 'aikikan'
const TEN = '00000000-0000-0000-0000-000000000001'
const ctx = { appId: APP, tenantId: TEN, subTenantId: null, userId: 'u1', role: 'dispatcher' }

function mockClient() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }
}

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(mockClient()))
})

describe('list passthroughs', () => {
  it('listZones scopea al tenant', async () => {
    repo.listZones.mockResolvedValue([{ id: 'z1' }])
    const r = await service.listZones(ctx)
    expect(repo.listZones).toHaveBeenCalledWith(expect.anything(), APP, TEN)
    expect(r).toEqual([{ id: 'z1' }])
  })

  it('listRiders pasa opts', async () => {
    repo.listRiders.mockResolvedValue([])
    await service.listRiders(ctx, { status: 'available' })
    expect(repo.listRiders).toHaveBeenCalledWith(expect.anything(), APP, TEN, { status: 'available' })
  })

  it('listDeliveries pasa opts', async () => {
    repo.listDeliveries.mockResolvedValue([])
    await service.listDeliveries(ctx, { status: 'pending' })
    expect(repo.listDeliveries).toHaveBeenCalledWith(expect.anything(), APP, TEN, { status: 'pending' })
  })
})
