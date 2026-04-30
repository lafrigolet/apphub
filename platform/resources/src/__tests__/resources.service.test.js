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
vi.mock('../repositories/resources.repository.js')

import * as service from '../services/resources.service.js'
import { withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as repo from '../repositories/resources.repository.js'
import { NotFoundError } from '@apphub/platform-sdk/errors'

const APP_ID    = 'yoga-studio'
const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const RES_ID    = '11111111-1111-1111-1111-111111111111'
const SVC_ID    = '22222222-2222-2222-2222-222222222222'

const ctx = { appId: APP_ID, tenantId: TENANT_ID, subTenantId: null, userId: 'u1', role: 'admin' }

function mockClient() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }
}

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(mockClient()))
})

describe('resources CRUD', () => {
  it('createResource scopes', async () => {
    repo.insert.mockResolvedValue({ id: RES_ID })
    await service.createResource(ctx, { kind: 'practitioner', displayName: 'Dr. Ana' })
    expect(repo.insert).toHaveBeenCalledWith(
      expect.anything(), APP_ID, TENANT_ID,
      expect.objectContaining({ kind: 'practitioner', displayName: 'Dr. Ana' }),
    )
  })

  it('getResource returns resource with services and workHours', async () => {
    repo.findById.mockResolvedValue({ id: RES_ID })
    repo.listServicesFor.mockResolvedValue([SVC_ID])
    repo.listWorkHours.mockResolvedValue([{ day_of_week: 1 }])
    const r = await service.getResource(ctx, RES_ID)
    expect(r.services).toEqual([SVC_ID])
    expect(r.workHours).toHaveLength(1)
  })

  it('getResource throws NotFoundError when missing', async () => {
    repo.findById.mockResolvedValue(null)
    await expect(service.getResource(ctx, RES_ID)).rejects.toThrow(NotFoundError)
  })

  it('listResourcesForService delegates', async () => {
    repo.listForService.mockResolvedValue([])
    await service.listResourcesForService(ctx, SVC_ID)
    expect(repo.listForService).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, SVC_ID)
  })
})

describe('attach / detach service', () => {
  it('attaches service', async () => {
    repo.attachService.mockResolvedValue()
    await service.attachService(ctx, RES_ID, SVC_ID)
    expect(repo.attachService).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, RES_ID, SVC_ID)
  })

  it('detaches service', async () => {
    repo.detachService.mockResolvedValue()
    await service.detachService(ctx, RES_ID, SVC_ID)
    expect(repo.detachService).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, RES_ID, SVC_ID)
  })
})

describe('work hours', () => {
  it('setWorkHour delegates', async () => {
    repo.insertWorkHours.mockResolvedValue({ id: 'wh1' })
    await service.setWorkHour(ctx, { resourceId: RES_ID, dayOfWeek: 1, startMinute: 540, endMinute: 1080 })
    expect(repo.insertWorkHours).toHaveBeenCalledWith(
      expect.anything(), APP_ID, TENANT_ID,
      expect.objectContaining({ resourceId: RES_ID, dayOfWeek: 1 }),
    )
  })

  it('deleteWorkHour throws NotFoundError when missing', async () => {
    repo.deleteWorkHours.mockResolvedValue(false)
    await expect(service.deleteWorkHour(ctx, 'wh1')).rejects.toThrow(NotFoundError)
  })
})

describe('exceptions', () => {
  it('createException publishes resource.unavailable', async () => {
    repo.insertException.mockResolvedValue({
      id: 'e1', resource_id: RES_ID,
      starts_at: '2026-05-01T08:00:00Z', ends_at: '2026-05-08T08:00:00Z', kind: 'vacation',
    })
    await service.createException(ctx, {
      resourceId: RES_ID, startsAt: '2026-05-01T08:00:00Z', endsAt: '2026-05-08T08:00:00Z', kind: 'vacation',
    })
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'resource.unavailable',
      payload: expect.objectContaining({ resourceId: RES_ID, kind: 'vacation' }),
    }))
  })

  it('listExceptions passes options through', async () => {
    repo.listExceptions.mockResolvedValue([])
    await service.listExceptions(ctx, RES_ID, { from: '2026-01-01T00:00:00Z' })
    expect(repo.listExceptions).toHaveBeenCalledWith(
      expect.anything(), APP_ID, TENANT_ID, RES_ID, { from: '2026-01-01T00:00:00Z' },
    )
  })
})
