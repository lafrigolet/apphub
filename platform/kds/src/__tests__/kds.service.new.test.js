// New KDS use-cases (priority items 1,3,7,8,9,10):
//  - station update / delete with ticket reassignment
//  - one-touch advance, per-item partial bump
//  - order grouping + aggregate status + mass bump
//  - auto-cancellation on order.cancelled / pos.bill.voided
//  - all-day totals + timing metrics passthrough
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../lib/db.js', () => ({ pool: { connect: vi.fn() }, withTenantTransaction: vi.fn() }))
vi.mock('../lib/redis.js', () => ({ publish: vi.fn() }))
vi.mock('../repositories/kds.repository.js')

import * as service from '../services/kds.service.js'
import { withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as repo from '../repositories/kds.repository.js'
import { ConflictError, NotFoundError } from '@apphub/platform-sdk/errors'

const APP = 'resto'
const TEN = '00000000-0000-0000-0000-000000000001'
const STATION = '22222222-2222-2222-2222-222222222222'
const ORDER = '33333333-3333-3333-3333-333333333333'
const TICKET = '11111111-1111-1111-1111-111111111111'
const ITEM = '44444444-4444-4444-4444-444444444444'
const ctx = { appId: APP, tenantId: TEN, subTenantId: null, userId: 'u1', role: 'kitchen' }

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn({}))
})

// ── station update / delete ────────────────────────────────────────────────
describe('updateStation', () => {
  it('returns the updated row', async () => {
    repo.updateStation.mockResolvedValue({ id: STATION, name: 'Fría' })
    const r = await service.updateStation(ctx, STATION, { name: 'Fría' })
    expect(r).toEqual({ id: STATION, name: 'Fría' })
    expect(repo.updateStation).toHaveBeenCalledWith({}, APP, TEN, STATION, { name: 'Fría' })
  })
  it('throws NotFoundError when missing', async () => {
    repo.updateStation.mockResolvedValue(null)
    await expect(service.updateStation(ctx, STATION, { name: 'x' })).rejects.toThrow(NotFoundError)
  })
})

describe('deleteStation', () => {
  it('reassigns tickets then deletes; returns reassigned ids', async () => {
    repo.reassignTicketsStation.mockResolvedValue(['t1', 't2'])
    repo.deleteStation.mockResolvedValue(true)
    const r = await service.deleteStation(ctx, STATION, { reassignTo: null })
    expect(repo.reassignTicketsStation).toHaveBeenCalledWith({}, APP, TEN, STATION, null)
    expect(r).toEqual({ deleted: true, reassignedTicketIds: ['t1', 't2'] })
  })
  it('throws NotFoundError when nothing deleted', async () => {
    repo.reassignTicketsStation.mockResolvedValue([])
    repo.deleteStation.mockResolvedValue(false)
    await expect(service.deleteStation(ctx, STATION)).rejects.toThrow(NotFoundError)
  })
})

// ── one-touch advance ───────────────────────────────────────────────────────
describe('advanceTicket', () => {
  it('fired → in_progress and emits acked', async () => {
    repo.findTicketById.mockResolvedValue({ id: TICKET, status: 'fired', order_id: ORDER, station_id: STATION, course: 'main' })
    repo.setTicketStatus.mockResolvedValue({ id: TICKET, status: 'in_progress' })
    await service.advanceTicket(ctx, TICKET)
    expect(repo.setTicketStatus).toHaveBeenCalledWith({}, APP, TEN, TICKET, 'in_progress', 'acked_at', null)
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'kds.ticket.acked' }))
  })
  it('ready → picked_up', async () => {
    repo.findTicketById.mockResolvedValue({ id: TICKET, status: 'ready', order_id: ORDER, station_id: STATION, course: 'main' })
    repo.setTicketStatus.mockResolvedValue({ id: TICKET, status: 'picked_up' })
    await service.advanceTicket(ctx, TICKET)
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'kds.ticket.picked_up' }))
  })
  it('terminal state → ConflictError', async () => {
    repo.findTicketById.mockResolvedValue({ id: TICKET, status: 'picked_up' })
    await expect(service.advanceTicket(ctx, TICKET)).rejects.toThrow(ConflictError)
  })
  it('missing → NotFoundError', async () => {
    repo.findTicketById.mockResolvedValue(null)
    await expect(service.advanceTicket(ctx, TICKET)).rejects.toThrow(NotFoundError)
  })
})

// ── per-item partial bump ────────────────────────────────────────────────────
describe('bumpItem', () => {
  it('fired → ready allowed', async () => {
    repo.findItemById.mockResolvedValue({ id: ITEM, status: 'fired' })
    repo.setItemStatus.mockResolvedValue({ id: ITEM, status: 'ready' })
    const r = await service.bumpItem(ctx, ITEM, 'ready')
    expect(r.status).toBe('ready')
    expect(repo.setItemStatus).toHaveBeenCalledWith({}, APP, TEN, ITEM, 'ready')
  })
  it('ready → in_progress rejected (no back-transition)', async () => {
    repo.findItemById.mockResolvedValue({ id: ITEM, status: 'ready' })
    await expect(service.bumpItem(ctx, ITEM, 'in_progress')).rejects.toThrow(ConflictError)
  })
  it('missing item → NotFoundError', async () => {
    repo.findItemById.mockResolvedValue(null)
    await expect(service.bumpItem(ctx, ITEM, 'ready')).rejects.toThrow(NotFoundError)
  })
})

// ── order grouping + aggregate status ────────────────────────────────────────
describe('listTicketsByOrder', () => {
  it('groups tickets with items and derives aggregate status', async () => {
    repo.listTicketsByOrder.mockResolvedValue([
      { id: 'a', status: 'ready', order_id: ORDER },
      { id: 'b', status: 'in_progress', order_id: ORDER },
    ])
    repo.findItemsByTicket.mockResolvedValue([])
    const r = await service.listTicketsByOrder(ctx, ORDER)
    expect(r.orderId).toBe(ORDER)
    expect(r.aggregateStatus).toBe('partial_ready')
    expect(r.tickets).toHaveLength(2)
  })
  it('all ready → all_ready; cancelled ignored', async () => {
    repo.listTicketsByOrder.mockResolvedValue([
      { id: 'a', status: 'ready' }, { id: 'b', status: 'ready' }, { id: 'c', status: 'cancelled' },
    ])
    repo.findItemsByTicket.mockResolvedValue([])
    const r = await service.listTicketsByOrder(ctx, ORDER)
    expect(r.aggregateStatus).toBe('all_ready')
  })
  it('only cancelled → cancelled', async () => {
    repo.listTicketsByOrder.mockResolvedValue([{ id: 'a', status: 'cancelled' }])
    repo.findItemsByTicket.mockResolvedValue([])
    const r = await service.listTicketsByOrder(ctx, ORDER)
    expect(r.aggregateStatus).toBe('cancelled')
  })
})

// ── mass bump by order ───────────────────────────────────────────────────────
describe('bumpOrderTickets', () => {
  it('only bumps tickets with a legal transition; skips the rest', async () => {
    repo.listTicketsByOrder.mockResolvedValue([
      { id: 'a', status: 'in_progress', order_id: ORDER, station_id: STATION, course: 'main' }, // → ready ok
      { id: 'b', status: 'picked_up',  order_id: ORDER, station_id: STATION, course: 'main' }, // skip
    ])
    repo.setTicketStatus.mockImplementation(async (_c, _a, _t, id) => ({ id, status: 'ready' }))
    const r = await service.bumpOrderTickets(ctx, ORDER, 'ready')
    expect(r.bumped).toBe(1)
    expect(repo.setTicketStatus).toHaveBeenCalledTimes(1)
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'kds.ticket.ready' }))
  })
  it('no tickets → NotFoundError', async () => {
    repo.listTicketsByOrder.mockResolvedValue([])
    await expect(service.bumpOrderTickets(ctx, ORDER, 'ready')).rejects.toThrow(NotFoundError)
  })
})

// ── auto-cancellation on order.cancelled / pos.bill.voided ───────────────────
describe('handleEvent — auto cancellation', () => {
  it('order.cancelled cancels open tickets and emits one cancelled event each', async () => {
    repo.cancelTicketsByOrder.mockResolvedValue([
      { id: 'a', station_id: STATION, course: 'main' },
      { id: 'b', station_id: null, course: 'drink' },
    ])
    await service.handleEvent({ type: 'order.cancelled', payload: { appId: APP, tenantId: TEN, orderId: ORDER } })
    expect(repo.cancelTicketsByOrder).toHaveBeenCalledWith({}, APP, TEN, ORDER, expect.stringContaining('order.cancelled'))
    expect(publish).toHaveBeenCalledTimes(2)
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'kds.ticket.cancelled' }))
  })
  it('pos.bill.voided routes to the same cancellation path', async () => {
    repo.cancelTicketsByOrder.mockResolvedValue([])
    await service.handleEvent({ type: 'pos.bill.voided', payload: { appId: APP, tenantId: TEN, orderId: ORDER } })
    expect(repo.cancelTicketsByOrder).toHaveBeenCalled()
  })
  it('ignores cancellation event without orderId', async () => {
    await service.handleEvent({ type: 'order.cancelled', payload: { appId: APP, tenantId: TEN } })
    expect(repo.cancelTicketsByOrder).not.toHaveBeenCalled()
  })
  it('uses provided reason when present', async () => {
    repo.cancelTicketsByOrder.mockResolvedValue([])
    await service.handleEvent({ type: 'order.cancelled', payload: { appId: APP, tenantId: TEN, orderId: ORDER, reason: 'customer left' } })
    expect(repo.cancelTicketsByOrder).toHaveBeenCalledWith({}, APP, TEN, ORDER, 'customer left')
  })
})

// ── aggregates passthrough ────────────────────────────────────────────────────
describe('allDay / metrics', () => {
  it('allDay delegates with stationId option', async () => {
    repo.allDayTotals.mockResolvedValue([{ sku: 'BURG', total: 12 }])
    const r = await service.allDay(ctx, { stationId: STATION })
    expect(repo.allDayTotals).toHaveBeenCalledWith({}, APP, TEN, { stationId: STATION })
    expect(r).toEqual([{ sku: 'BURG', total: 12 }])
  })
  it('metrics delegates with from/to window', async () => {
    repo.metrics.mockResolvedValue([{ station_id: STATION, avg_prep_secs: 300 }])
    await service.metrics(ctx, { from: '2026-01-01', to: '2026-02-01' })
    expect(repo.metrics).toHaveBeenCalledWith({}, APP, TEN, { from: '2026-01-01', to: '2026-02-01' })
  })
})
