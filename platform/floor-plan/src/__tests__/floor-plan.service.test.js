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
  it('combines tables and emits table.combined', async () => {
    const others = ['44444444-4444-4444-4444-444444444444']
    repo.combineTables.mockResolvedValue({ id: TABLE_ID, combined_with: others })
    await service.combineTables(ctx, TABLE_ID, others)
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'table.combined',
      payload: expect.objectContaining({ primaryTableId: TABLE_ID, combinedWith: others }),
    }))
  })

  it('throws NotFoundError when primary table missing', async () => {
    repo.combineTables.mockResolvedValue(null)
    await expect(service.combineTables(ctx, TABLE_ID, ['x'])).rejects.toThrow(NotFoundError)
  })
})
