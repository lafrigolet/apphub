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

  it('listResources delegates with opts', async () => {
    repo.listByTenant.mockResolvedValue([{ id: RES_ID }])
    const out = await service.listResources(ctx, { kind: 'room', onlyActive: true })
    expect(repo.listByTenant).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, { kind: 'room', onlyActive: true })
    expect(out).toEqual([{ id: RES_ID }])
  })

  it('listResourcesForService delegates', async () => {
    repo.listForService.mockResolvedValue([])
    await service.listResourcesForService(ctx, SVC_ID)
    expect(repo.listForService).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, SVC_ID)
  })
})

describe('updateResource / setResourceActive', () => {
  it('updateResource delegates and returns row', async () => {
    repo.update.mockResolvedValue({ id: RES_ID, display_name: 'New' })
    const out = await service.updateResource(ctx, RES_ID, { displayName: 'New' })
    expect(repo.update).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, RES_ID, { displayName: 'New' })
    expect(out.display_name).toBe('New')
  })

  it('updateResource throws NotFoundError when missing', async () => {
    repo.update.mockResolvedValue(null)
    await expect(service.updateResource(ctx, RES_ID, { displayName: 'X' })).rejects.toThrow(NotFoundError)
  })

  it('setResourceActive publishes schedule_changed', async () => {
    repo.setActive.mockResolvedValue({ id: RES_ID, is_active: false })
    await service.setResourceActive(ctx, RES_ID, false)
    expect(repo.setActive).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, RES_ID, false)
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'resource.schedule_changed',
      payload: expect.objectContaining({ resourceId: RES_ID, reason: 'deactivated' }),
    }))
  })

  it('setResourceActive throws NotFoundError when missing', async () => {
    repo.setActive.mockResolvedValue(null)
    await expect(service.setResourceActive(ctx, RES_ID, true)).rejects.toThrow(NotFoundError)
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
  it('setWorkHour delegates and publishes schedule_changed', async () => {
    repo.insertWorkHours.mockResolvedValue({ id: 'wh1', resource_id: RES_ID })
    await service.setWorkHour(ctx, { resourceId: RES_ID, dayOfWeek: 1, startMinute: 540, endMinute: 1080 })
    expect(repo.insertWorkHours).toHaveBeenCalledWith(
      expect.anything(), APP_ID, TENANT_ID,
      expect.objectContaining({ resourceId: RES_ID, dayOfWeek: 1 }),
    )
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'resource.schedule_changed',
      payload: expect.objectContaining({ resourceId: RES_ID, reason: 'work_hours.created' }),
    }))
  })

  it('updateWorkHour delegates and publishes', async () => {
    repo.updateWorkHours.mockResolvedValue({ id: 'wh1', resource_id: RES_ID })
    await service.updateWorkHour(ctx, 'wh1', { startMinute: 600 })
    expect(repo.updateWorkHours).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, 'wh1', { startMinute: 600 })
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'resource.schedule_changed',
      payload: expect.objectContaining({ reason: 'work_hours.updated' }),
    }))
  })

  it('updateWorkHour throws NotFoundError when missing', async () => {
    repo.updateWorkHours.mockResolvedValue(null)
    await expect(service.updateWorkHour(ctx, 'wh1', { startMinute: 600 })).rejects.toThrow(NotFoundError)
  })

  it('listWorkHours delegates', async () => {
    repo.listWorkHours.mockResolvedValue([{ id: 'wh1' }])
    const out = await service.listWorkHours(ctx, RES_ID)
    expect(repo.listWorkHours).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, RES_ID)
    expect(out).toEqual([{ id: 'wh1' }])
  })

  it('deleteWorkHour resolves when row deleted and publishes schedule_changed', async () => {
    repo.findWorkHourById.mockResolvedValue({ id: 'wh1', resource_id: RES_ID })
    repo.deleteWorkHours.mockResolvedValue(true)
    await expect(service.deleteWorkHour(ctx, 'wh1')).resolves.toBeUndefined()
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'resource.schedule_changed',
      payload: expect.objectContaining({ resourceId: RES_ID, reason: 'work_hours.deleted' }),
    }))
  })

  it('deleteWorkHour throws NotFoundError when missing', async () => {
    repo.findWorkHourById.mockResolvedValue(null)
    await expect(service.deleteWorkHour(ctx, 'wh1')).rejects.toThrow(NotFoundError)
  })
})

describe('exceptions', () => {
  it('createException publishes resource.unavailable and schedule_changed', async () => {
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
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'resource.schedule_changed',
      payload: expect.objectContaining({ resourceId: RES_ID, reason: 'exception.created' }),
    }))
  })

  it('updateException delegates and publishes schedule_changed', async () => {
    repo.updateException.mockResolvedValue({ id: 'e1', resource_id: RES_ID })
    await service.updateException(ctx, 'e1', { reason: 'updated' })
    expect(repo.updateException).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, 'e1', { reason: 'updated' })
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'resource.schedule_changed',
      payload: expect.objectContaining({ reason: 'exception.updated' }),
    }))
  })

  it('updateException throws NotFoundError when missing', async () => {
    repo.updateException.mockResolvedValue(null)
    await expect(service.updateException(ctx, 'e1', { reason: 'x' })).rejects.toThrow(NotFoundError)
  })

  it('deleteException resolves and publishes when present', async () => {
    repo.findExceptionById.mockResolvedValue({ id: 'e1', resource_id: RES_ID })
    repo.deleteException.mockResolvedValue(true)
    await expect(service.deleteException(ctx, 'e1')).resolves.toBeUndefined()
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'resource.schedule_changed',
      payload: expect.objectContaining({ reason: 'exception.deleted' }),
    }))
  })

  it('deleteException throws NotFoundError when missing', async () => {
    repo.findExceptionById.mockResolvedValue(null)
    await expect(service.deleteException(ctx, 'e1')).rejects.toThrow(NotFoundError)
  })

  it('createTenantHolidays bulk-inserts and publishes per affected resource', async () => {
    repo.insertExceptionForTenant.mockResolvedValue([
      { id: 'e1', resource_id: 'r-a', starts_at: 'S', ends_at: 'E', kind: 'holiday' },
      { id: 'e2', resource_id: 'r-b', starts_at: 'S', ends_at: 'E', kind: 'holiday' },
    ])
    const out = await service.createTenantHolidays(ctx, {
      startsAt: 'S', endsAt: 'E', reason: 'Xmas',
    })
    expect(repo.insertExceptionForTenant).toHaveBeenCalledWith(
      expect.anything(), APP_ID, TENANT_ID,
      expect.objectContaining({ startsAt: 'S', endsAt: 'E', kind: 'holiday' }),
      expect.objectContaining({ kind: undefined, subTenantId: undefined }),
    )
    expect(out.created).toBe(2)
    // 2 resources × (unavailable + schedule_changed) = 4 publishes
    expect(publish).toHaveBeenCalledTimes(4)
  })

  it('createTenantHolidays honors exceptionKind and filters', async () => {
    repo.insertExceptionForTenant.mockResolvedValue([])
    await service.createTenantHolidays(ctx, {
      startsAt: 'S', endsAt: 'E', exceptionKind: 'training', kind: 'practitioner', subTenantId: 'st1',
    })
    expect(repo.insertExceptionForTenant).toHaveBeenCalledWith(
      expect.anything(), APP_ID, TENANT_ID,
      expect.objectContaining({ kind: 'training' }),
      { kind: 'practitioner', subTenantId: 'st1' },
    )
  })

  it('listExceptions passes options through', async () => {
    repo.listExceptions.mockResolvedValue([])
    await service.listExceptions(ctx, RES_ID, { from: '2026-01-01T00:00:00Z' })
    expect(repo.listExceptions).toHaveBeenCalledWith(
      expect.anything(), APP_ID, TENANT_ID, RES_ID, { from: '2026-01-01T00:00:00Z' },
    )
  })
})
