// kds — ticket FSM completo + edge cases del 'cancelled' (lo que kds.service.test
// no cubre todavía). El FSM canónico:
//   fired       → in_progress | cancelled
//   in_progress → ready | cancelled
//   ready       → picked_up | cancelled
//   picked_up   → ∅ (terminal)
//   cancelled   → ∅ (terminal)
//
// Todas las transiciones tipadas como 'cancelled' usan picked_up_at como columna
// de timestamp (no hay cancelled_at, lo cual es deliberado — la consola
// distingue por status, no por timestamp).

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
vi.mock('../repositories/kds.repository.js')

import { bumpTicket } from '../services/kds.service.js'
import { withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as repo from '../repositories/kds.repository.js'

const ctx = { appId: 'demo-restaurant', tenantId: 't1', subTenantId: null }

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn({}))
})

// Helper para forzar el estado actual del ticket.
function whenStatus(status) {
  repo.findTicketById.mockResolvedValue({
    id: 'tkt-1', status, order_id: 'ord-1', station_id: 'st-1', course: 'main',
  })
  repo.setTicketStatus.mockResolvedValue({ id: 'tkt-1', status })
}

// ── Transiciones VÁLIDAS — la matriz completa ────────────────────────

describe('FSM — transiciones válidas', () => {
  it.each([
    ['fired',       'in_progress', 'acked_at',     'kds.ticket.acked'],
    ['fired',       'cancelled',   'picked_up_at', 'kds.ticket.cancelled'],
    ['in_progress', 'ready',       'ready_at',     'kds.ticket.ready'],
    ['in_progress', 'cancelled',   'picked_up_at', 'kds.ticket.cancelled'],
    ['ready',       'picked_up',   'picked_up_at', 'kds.ticket.picked_up'],
    ['ready',       'cancelled',   'picked_up_at', 'kds.ticket.cancelled'],
  ])('%s → %s usa columna %s + emite %s', async (from, to, tsCol, eventType) => {
    whenStatus(from)
    await bumpTicket(ctx, 'tkt-1', to)
    expect(repo.setTicketStatus).toHaveBeenCalledWith(
      expect.anything(), ctx.appId, ctx.tenantId, 'tkt-1', to, tsCol,
    )
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: eventType }))
  })
})

// ── Transiciones INVÁLIDAS ───────────────────────────────────────────

describe('FSM — transiciones inválidas', () => {
  it.each([
    ['fired',       'ready'],         // skip in_progress
    ['fired',       'picked_up'],     // skip dos pasos
    ['in_progress', 'picked_up'],     // skip ready
    ['in_progress', 'fired'],         // back-transition
    ['ready',      'in_progress'],   // back-transition
    ['ready',      'fired'],         // back-transition
    ['picked_up', 'in_progress'],    // terminal
    ['picked_up', 'ready'],          // terminal
    ['picked_up', 'cancelled'],      // terminal (can't cancel after pickup)
    ['cancelled', 'in_progress'],    // terminal
    ['cancelled', 'ready'],          // terminal
  ])('%s → %s → ConflictError 409', async (from, to) => {
    whenStatus(from)
    await expect(bumpTicket(ctx, 'tkt-1', to)).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining(`cannot transition ticket from ${from} to ${to}`),
    })
    expect(repo.setTicketStatus).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
  })
})

// ── Self-transitions (idempotencia NO permitida; el FSM las rechaza) ─

describe('Self-transitions explícitas → 409 (no idempotente)', () => {
  it.each([['fired'], ['in_progress'], ['ready'], ['picked_up'], ['cancelled']])(
    '%s → %s mismo → 409',
    async (status) => {
      whenStatus(status)
      await expect(bumpTicket(ctx, 'tkt-1', status)).rejects.toMatchObject({ statusCode: 409 })
    },
  )
})

// ── Payload del evento ──────────────────────────────────────────────

describe('payload del evento publicado', () => {
  it('incluye ticketId, orderId, stationId, course', async () => {
    repo.findTicketById.mockResolvedValue({
      id: 'tkt-1', status: 'fired', order_id: 'ord-42', station_id: 'st-9', course: 'desserts',
    })
    repo.setTicketStatus.mockResolvedValue({ id: 'tkt-1', status: 'in_progress' })
    await bumpTicket(ctx, 'tkt-1', 'in_progress')
    expect(publish).toHaveBeenCalledWith({
      type: 'kds.ticket.acked',
      payload: {
        appId: ctx.appId, tenantId: ctx.tenantId,
        ticketId: 'tkt-1', orderId: 'ord-42', stationId: 'st-9', course: 'desserts',
      },
    })
  })
})
