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
vi.mock('../repositories/kds.repository.js')

import * as service from '../services/kds.service.js'
import { withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as repo from '../repositories/kds.repository.js'
import { ConflictError, NotFoundError } from '@apphub/platform-sdk/errors'

const APP_ID    = 'yoga-studio'
const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const TICKET_ID = '11111111-1111-1111-1111-111111111111'
const STATION   = '22222222-2222-2222-2222-222222222222'
const ORDER_ID  = '33333333-3333-3333-3333-333333333333'

const ctx = { appId: APP_ID, tenantId: TENANT_ID, subTenantId: null, userId: 'u1', role: 'kitchen' }

function mockClient() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }
}

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(mockClient()))
})

// ── stations ────────────────────────────────────────────────────────────
describe('stations', () => {
  it('createStation injects tenant scope', async () => {
    repo.insertStation.mockResolvedValue({ id: STATION })
    await service.createStation(ctx, { name: 'Caliente', routesCourses: ['main','starter'] })
    expect(repo.insertStation).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      appId: APP_ID, tenantId: TENANT_ID, name: 'Caliente', routesCourses: ['main','starter'],
    }))
  })

  it('listStations delegates to repository', async () => {
    repo.listStations.mockResolvedValue([{ id: STATION }])
    const result = await service.listStations(ctx)
    expect(result).toHaveLength(1)
  })
})

// ── tickets list / get ──────────────────────────────────────────────────
describe('tickets list / get', () => {
  it('listTickets returns tickets with their items', async () => {
    repo.listTickets.mockResolvedValue([{ id: TICKET_ID }])
    repo.findItemsByTicket.mockResolvedValue([{ id: 'i1', sku: 'X' }])
    const result = await service.listTickets(ctx, { status: 'fired' })
    expect(result).toEqual([{ id: TICKET_ID, items: [{ id: 'i1', sku: 'X' }] }])
  })

  it('getTicket throws NotFoundError when missing', async () => {
    repo.findTicketById.mockResolvedValue(null)
    await expect(service.getTicket(ctx, TICKET_ID)).rejects.toThrow(NotFoundError)
  })
})

// ── bumpTicket FSM ──────────────────────────────────────────────────────
describe('bumpTicket FSM', () => {
  it('fired → in_progress: stamps acked_at and emits kds.ticket.acked', async () => {
    repo.findTicketById.mockResolvedValue({ id: TICKET_ID, status: 'fired', order_id: ORDER_ID, station_id: STATION, course: 'main' })
    repo.setTicketStatus.mockResolvedValue({ id: TICKET_ID, status: 'in_progress' })
    await service.bumpTicket(ctx, TICKET_ID, 'in_progress')
    expect(repo.setTicketStatus).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, TICKET_ID, 'in_progress', 'acked_at', null)
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'kds.ticket.acked' }))
  })

  it('in_progress → ready: emits kds.ticket.ready', async () => {
    repo.findTicketById.mockResolvedValue({ id: TICKET_ID, status: 'in_progress', order_id: ORDER_ID, station_id: STATION, course: 'main' })
    repo.setTicketStatus.mockResolvedValue({ id: TICKET_ID, status: 'ready' })
    await service.bumpTicket(ctx, TICKET_ID, 'ready')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'kds.ticket.ready' }))
  })

  it('ready → picked_up: emits kds.ticket.picked_up', async () => {
    repo.findTicketById.mockResolvedValue({ id: TICKET_ID, status: 'ready', order_id: ORDER_ID, station_id: STATION, course: 'main' })
    repo.setTicketStatus.mockResolvedValue({ id: TICKET_ID, status: 'picked_up' })
    await service.bumpTicket(ctx, TICKET_ID, 'picked_up')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'kds.ticket.picked_up' }))
  })

  it('rejects invalid transition fired → ready', async () => {
    repo.findTicketById.mockResolvedValue({ id: TICKET_ID, status: 'fired' })
    await expect(service.bumpTicket(ctx, TICKET_ID, 'ready')).rejects.toThrow(ConflictError)
  })

  it('throws NotFoundError when ticket missing', async () => {
    repo.findTicketById.mockResolvedValue(null)
    await expect(service.bumpTicket(ctx, TICKET_ID, 'in_progress')).rejects.toThrow(NotFoundError)
  })
})

// ── handleEvent: order.paid → fire tickets ──────────────────────────────
describe('handleEvent — fireTicketsForOrder', () => {
  it('fires one ticket per course, routing to the matching station', async () => {
    const station = { id: STATION, name: 'Caliente' }
    repo.findStationByCourse.mockImplementation((_c, _a, _t, course) => Promise.resolve(course === 'main' ? station : null))
    repo.insertTicket.mockImplementation(async (_c, t) => ({ id: 'tk-' + t.course, station_id: t.stationId, ...t }))
    repo.insertTicketItem.mockResolvedValue()

    await service.handleEvent({
      type: 'order.paid',
      payload: {
        appId: APP_ID, tenantId: TENANT_ID, orderId: ORDER_ID, tableCode: '5',
        items: [
          { sku: 'BURG', name: 'Burger', qty: 1, course: 'main' },
          { sku: 'COKE', name: 'Coke',   qty: 2, course: 'drink' },
          { sku: 'BURG-2', name: 'Burger 2', qty: 1, course: 'main' },
        ],
      },
    })

    // 2 calls — one per distinct course
    expect(repo.insertTicket).toHaveBeenCalledTimes(2)
    // 3 items total
    expect(repo.insertTicketItem).toHaveBeenCalledTimes(3)
    // main station found, drink station unknown → null
    const calls = repo.insertTicket.mock.calls
    const mainCall = calls.find(([, t]) => t.course === 'main')
    expect(mainCall[1].stationId).toBe(STATION)
    const drinkCall = calls.find(([, t]) => t.course === 'drink')
    expect(drinkCall[1].stationId).toBeNull()

    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'kds.ticket.fired' }))
  })

  it('does nothing for unrelated event types', async () => {
    await service.handleEvent({ type: 'order.created', payload: { appId: APP_ID, tenantId: TENANT_ID, items: [] } })
    expect(repo.insertTicket).not.toHaveBeenCalled()
  })

  it('does nothing for empty payload', async () => {
    await service.handleEvent({ type: 'order.paid', payload: {} })
    expect(repo.insertTicket).not.toHaveBeenCalled()
  })

  it('treats pos.bill.paid the same as order.paid', async () => {
    repo.findStationByCourse.mockResolvedValue(null)
    repo.insertTicket.mockResolvedValue({ id: 'tk1', station_id: null })
    repo.insertTicketItem.mockResolvedValue()
    await service.handleEvent({
      type: 'pos.bill.paid',
      payload: {
        appId: APP_ID, tenantId: TENANT_ID, orderId: ORDER_ID,
        items: [{ sku: 'X', name: 'X', qty: 1, course: 'main' }],
      },
    })
    expect(repo.insertTicket).toHaveBeenCalledTimes(1)
  })

  it('falls back to course=main for items without explicit course', async () => {
    repo.findStationByCourse.mockResolvedValue(null)
    repo.insertTicket.mockResolvedValue({ id: 'tk1', station_id: null })
    repo.insertTicketItem.mockResolvedValue()
    await service.handleEvent({
      type: 'order.paid',
      payload: {
        appId: APP_ID, tenantId: TENANT_ID, orderId: ORDER_ID,
        items: [{ sku: 'X', name: 'X', qty: 1 }],
      },
    })
    expect(repo.insertTicket).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ course: 'main' }))
  })

  it('swallows downstream errors gracefully', async () => {
    repo.findStationByCourse.mockRejectedValue(new Error('boom'))
    await expect(service.handleEvent({
      type: 'order.paid',
      payload: { appId: APP_ID, tenantId: TENANT_ID, orderId: ORDER_ID, items: [{ sku: 'X', name: 'X', qty: 1, course: 'main' }] },
    })).resolves.toBeUndefined()
  })
})
