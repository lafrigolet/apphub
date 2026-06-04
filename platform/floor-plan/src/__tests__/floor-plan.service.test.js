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

vi.mock('../repositories/floor-plan.repository.js')

import * as service from '../services/floor-plan.service.js'
import { withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as repo from '../repositories/floor-plan.repository.js'
import { ConflictError, NotFoundError } from '@apphub/platform-sdk/errors'

const APP_ID    = 'yoga-studio'
const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const TABLE_ID  = '11111111-1111-1111-1111-111111111111'
const SECTION   = '22222222-2222-2222-2222-222222222222'
const RES_ID    = '33333333-3333-3333-3333-333333333333'

const ctx = { appId: APP_ID, tenantId: TENANT_ID, subTenantId: null, userId: 'u1', role: 'host' }

function mockClient() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }
}

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(mockClient()))
})

// ── sections / tables CRUD ─────────────────────────────────────────────────
describe('sections / tables', () => {
  it('createSection injects tenant scope', async () => {
    repo.insertSection.mockResolvedValue({ id: SECTION })
    await service.createSection(ctx, { name: 'Terraza', isOutdoor: true })
    expect(repo.insertSection).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      appId: APP_ID, tenantId: TENANT_ID, isOutdoor: true,
    }))
  })

  it('listSections delegates to repository', async () => {
    repo.listSections.mockResolvedValue([{ id: SECTION }])
    const result = await service.listSections(ctx)
    expect(result).toHaveLength(1)
  })

  it('createTable injects tenant scope', async () => {
    repo.insertTable.mockResolvedValue({ id: TABLE_ID, code: 'T1' })
    await service.createTable(ctx, { sectionId: SECTION, code: 'T1', capacity: 4 })
    expect(repo.insertTable).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      appId: APP_ID, tenantId: TENANT_ID, code: 'T1', capacity: 4,
    }))
  })

  it('updateSection throws NotFoundError when missing', async () => {
    repo.updateSection.mockResolvedValue(null)
    await expect(service.updateSection(ctx, SECTION, { name: 'X' })).rejects.toThrow(NotFoundError)
  })

  it('deleteSection refuses when tables remain', async () => {
    repo.countTablesInSection.mockResolvedValue(3)
    await expect(service.deleteSection(ctx, SECTION)).rejects.toThrow(ConflictError)
    expect(repo.deleteSection).not.toHaveBeenCalled()
  })

  it('deleteSection deletes when empty', async () => {
    repo.countTablesInSection.mockResolvedValue(0)
    repo.deleteSection.mockResolvedValue({ id: SECTION })
    expect(await service.deleteSection(ctx, SECTION)).toEqual({ id: SECTION })
  })

  it('updateTable throws NotFoundError when missing', async () => {
    repo.updateTable.mockResolvedValue(null)
    await expect(service.updateTable(ctx, TABLE_ID, { capacity: 6 })).rejects.toThrow(NotFoundError)
  })

  it('deleteTable refuses when occupied', async () => {
    repo.findTableById.mockResolvedValue({ id: TABLE_ID, status: 'occupied', combined_with: [] })
    await expect(service.deleteTable(ctx, TABLE_ID)).rejects.toThrow(ConflictError)
    expect(repo.deleteTable).not.toHaveBeenCalled()
  })

  it('deleteTable refuses when combined', async () => {
    repo.findTableById.mockResolvedValue({ id: TABLE_ID, status: 'free', combined_with: ['x'] })
    await expect(service.deleteTable(ctx, TABLE_ID)).rejects.toThrow(ConflictError)
  })

  it('deleteTable removes a free table', async () => {
    repo.findTableById.mockResolvedValue({ id: TABLE_ID, status: 'free', combined_with: [] })
    repo.deleteTable.mockResolvedValue({ id: TABLE_ID })
    expect(await service.deleteTable(ctx, TABLE_ID)).toEqual({ id: TABLE_ID })
  })

  it('listTableEvents throws NotFoundError when table missing', async () => {
    repo.findTableById.mockResolvedValue(null)
    await expect(service.listTableEvents(ctx, TABLE_ID)).rejects.toThrow(NotFoundError)
  })

  it('listTableEvents delegates with filters when table exists', async () => {
    repo.findTableById.mockResolvedValue({ id: TABLE_ID })
    repo.listTableEvents.mockResolvedValue([{ id: 'e1' }])
    const out = await service.listTableEvents(ctx, TABLE_ID, { toStatus: 'occupied', limit: 10 })
    expect(out).toEqual([{ id: 'e1' }])
    expect(repo.listTableEvents).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, TABLE_ID, { toStatus: 'occupied', limit: 10 })
  })

  it('occupancy delegates snapshot', async () => {
    repo.occupancySnapshot.mockResolvedValue({ total_capacity: 40, seated_guests: 12 })
    expect(await service.occupancy(ctx, { sectionId: SECTION })).toEqual({ total_capacity: 40, seated_guests: 12 })
    expect(repo.occupancySnapshot).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, { sectionId: SECTION })
  })

  it('getTable throws NotFoundError when missing', async () => {
    repo.findTableById.mockResolvedValue(null)
    await expect(service.getTable(ctx, TABLE_ID)).rejects.toThrow(NotFoundError)
  })

  it('listTables passes filters through', async () => {
    repo.listTables.mockResolvedValue([])
    await service.listTables(ctx, { sectionId: SECTION, status: 'free' })
    expect(repo.listTables).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, { sectionId: SECTION, status: 'free' })
  })
})

// ── changeTableStatus FSM ──────────────────────────────────────────────────
describe('changeTableStatus FSM', () => {
  it('allows free → reserved', async () => {
    repo.findTableById.mockResolvedValue({ id: TABLE_ID, status: 'free' })
    repo.setTableStatus.mockResolvedValue({ id: TABLE_ID, status: 'reserved' })
    repo.recordTableEvent.mockResolvedValue()

    await service.changeTableStatus(ctx, TABLE_ID, 'reserved', { reservationId: RES_ID, partySize: 2 })

    expect(repo.setTableStatus).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, TABLE_ID, 'reserved')
    expect(repo.recordTableEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      fromStatus: 'free', toStatus: 'reserved', reservationId: RES_ID, partySize: 2,
    }))
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'table.reserved',
      payload: expect.objectContaining({ tableId: TABLE_ID, fromStatus: 'free' }),
    }))
  })

  it('emits table.seated when transitioning to occupied', async () => {
    repo.findTableById.mockResolvedValue({ id: TABLE_ID, status: 'reserved' })
    repo.setTableStatus.mockResolvedValue({ id: TABLE_ID, status: 'occupied' })
    await service.changeTableStatus(ctx, TABLE_ID, 'occupied')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'table.seated' }))
  })

  it('emits table.cleared when transitioning to free', async () => {
    repo.findTableById.mockResolvedValue({ id: TABLE_ID, status: 'dirty' })
    repo.setTableStatus.mockResolvedValue({ id: TABLE_ID, status: 'free' })
    await service.changeTableStatus(ctx, TABLE_ID, 'free')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'table.cleared' }))
  })

  it('rejects invalid transition free → dirty', async () => {
    repo.findTableById.mockResolvedValue({ id: TABLE_ID, status: 'free' })
    await expect(service.changeTableStatus(ctx, TABLE_ID, 'dirty')).rejects.toThrow(ConflictError)
    expect(repo.setTableStatus).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
  })

  it('throws NotFoundError if table does not exist', async () => {
    repo.findTableById.mockResolvedValue(null)
    await expect(service.changeTableStatus(ctx, TABLE_ID, 'reserved')).rejects.toThrow(NotFoundError)
  })
})

// ── combineTables ──────────────────────────────────────────────────────────
describe('combineTables', () => {
  const OTHER = '44444444-4444-4444-4444-444444444444'
  it('combines tables and emits table.combined', async () => {
    const others = [OTHER]
    repo.findTableById.mockResolvedValue({ id: TABLE_ID, status: 'free', capacity: 4, combined_with: [] })
    repo.findTablesByIds.mockResolvedValue([{ id: OTHER, code: 'T2', status: 'free', capacity: 2, combined_with: [] }])
    repo.combineTables.mockResolvedValue({ id: TABLE_ID, combined_with: others })
    repo.setTableStatus.mockResolvedValue({})
    await service.combineTables(ctx, TABLE_ID, others)
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'table.combined',
      payload: expect.objectContaining({ primaryTableId: TABLE_ID, combinedWith: others, totalCapacity: 6 }),
    }))
  })

  it('throws NotFoundError when primary table missing', async () => {
    repo.findTableById.mockResolvedValue(null)
    await expect(service.combineTables(ctx, TABLE_ID, [OTHER])).rejects.toThrow(NotFoundError)
  })
})

// ── handleEvent (reservations + POS sync) ──────────────────────────────────
describe('handleEvent', () => {
  const ev = (type, payload) => ({ type, payload: { appId: APP_ID, tenantId: TENANT_ID, tableId: TABLE_ID, ...payload } })

  it('reservation.confirmed → table free→reserved + table.reserved event', async () => {
    repo.findTableById.mockResolvedValue({ id: TABLE_ID, status: 'free' })
    repo.setTableStatus.mockResolvedValue({})
    await service.handleEvent(ev('reservation.confirmed', { reservationId: RES_ID, partySize: 2 }))
    expect(repo.setTableStatus).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, TABLE_ID, 'reserved')
    expect(repo.recordTableEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      fromStatus: 'free', toStatus: 'reserved', reservationId: RES_ID, partySize: 2,
    }))
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'table.reserved' }))
  })

  it('pos.bill.opened on reserved → occupied (table.seated)', async () => {
    repo.findTableById.mockResolvedValue({ id: TABLE_ID, status: 'reserved' })
    repo.setTableStatus.mockResolvedValue({})
    await service.handleEvent(ev('pos.bill.opened', {}))
    expect(repo.setTableStatus).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, TABLE_ID, 'occupied')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'table.seated' }))
  })

  it('pos.bill.paid → occupied→dirty', async () => {
    repo.findTableById.mockResolvedValue({ id: TABLE_ID, status: 'occupied' })
    repo.setTableStatus.mockResolvedValue({})
    await service.handleEvent(ev('pos.bill.paid', {}))
    expect(repo.setTableStatus).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, TABLE_ID, 'dirty')
  })

  it('skips when transition not allowed (FSM)', async () => {
    repo.findTableById.mockResolvedValue({ id: TABLE_ID, status: 'dirty' })
    await service.handleEvent(ev('pos.bill.opened', {}))
    expect(repo.setTableStatus).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
  })

  it('idempotent when already in target state', async () => {
    repo.findTableById.mockResolvedValue({ id: TABLE_ID, status: 'reserved' })
    await service.handleEvent(ev('reservation.confirmed', {}))
    expect(repo.setTableStatus).not.toHaveBeenCalled()
  })

  it('ignores events without tableId', async () => {
    await service.handleEvent({ type: 'reservation.confirmed', payload: { appId: APP_ID, tenantId: TENANT_ID } })
    expect(repo.findTableById).not.toHaveBeenCalled()
  })

  it('ignores unmapped event types', async () => {
    await service.handleEvent(ev('reservation.created', {}))
    expect(repo.findTableById).not.toHaveBeenCalled()
  })

  it('skips when table not found', async () => {
    repo.findTableById.mockResolvedValue(null)
    await service.handleEvent(ev('reservation.confirmed', {}))
    expect(repo.setTableStatus).not.toHaveBeenCalled()
  })
})
