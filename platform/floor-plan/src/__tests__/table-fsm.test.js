// floor-plan.service.changeTableStatus + combineTables.
// Contrato:
//   - FSM canónico:
//       free        → reserved | occupied | out_of_service
//       reserved    → occupied | free | out_of_service
//       occupied    → dirty | free | out_of_service
//       dirty       → free | out_of_service
//       out_of_service → free (única salida — el camarero la "reactiva")
//   - Self-transitions explícitas (free→free, occupied→occupied, …) NO permitidas → 409.
//   - Cualquier transición inválida → ConflictError 409.
//   - Cada cambio:
//       · INSERT en repo.recordTableEvent con actorUserId + fromStatus + toStatus + meta.
//       · publish event 'table.<rename>' donde rename: occupied→seated, free→cleared.
//   - combineTables: NotFoundError si primaryId no existe; emite 'table.combined'.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../lib/db.js', () => ({ pool: {}, withTenantTransaction: vi.fn() }))
vi.mock('../lib/redis.js', () => ({ publish: vi.fn() }))
vi.mock('../repositories/floor-plan.repository.js')

import { changeTableStatus, combineTables } from '../services/floor-plan.service.js'
import { withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as repo from '../repositories/floor-plan.repository.js'

const ctx = {
  appId: 'demo-restaurant', tenantId: 't1', subTenantId: null, userId: 'staff-1',
}

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn({}))
})

function whenStatus(status) {
  repo.findTableById.mockResolvedValue({ id: 'tbl-1', status })
  repo.setTableStatus.mockResolvedValue({ id: 'tbl-1', status })
}

// ── Transitions VÁLIDAS ────────────────────────────────────────────

describe('FSM — transiciones válidas', () => {
  it.each([
    ['free',        'reserved',       'table.reserved'],
    ['free',        'occupied',       'table.seated'],
    ['free',        'out_of_service', 'table.out_of_service'],
    ['reserved',    'occupied',       'table.seated'],
    ['reserved',    'free',           'table.cleared'],
    ['reserved',    'out_of_service', 'table.out_of_service'],
    ['occupied',    'dirty',          'table.dirty'],
    ['occupied',    'free',           'table.cleared'],
    ['occupied',    'out_of_service', 'table.out_of_service'],
    ['dirty',       'free',           'table.cleared'],
    ['dirty',       'out_of_service', 'table.out_of_service'],
    ['out_of_service', 'free',        'table.cleared'],
  ])('%s → %s emite %s', async (from, to, eventType) => {
    whenStatus(from)
    await changeTableStatus(ctx, 'tbl-1', to)
    expect(repo.setTableStatus).toHaveBeenCalledWith(
      expect.anything(), ctx.appId, ctx.tenantId, 'tbl-1', to,
    )
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: eventType }))
  })
})

// ── Transitions INVÁLIDAS (incluyendo self) ─────────────────────────

describe('FSM — transiciones inválidas', () => {
  it.each([
    ['free',           'dirty'],         // skip occupied
    ['reserved',       'dirty'],         // skip occupied
    ['dirty',          'occupied'],      // dirty no se puede ocupar sin limpiar
    ['dirty',          'reserved'],
    ['out_of_service', 'reserved'],
    ['out_of_service', 'occupied'],
    ['out_of_service', 'dirty'],
    // self-transitions
    ['free',           'free'],
    ['occupied',       'occupied'],
    ['reserved',       'reserved'],
    ['dirty',          'dirty'],
  ])('%s → %s → 409', async (from, to) => {
    whenStatus(from)
    await expect(changeTableStatus(ctx, 'tbl-1', to)).rejects.toMatchObject({ statusCode: 409 })
    expect(repo.setTableStatus).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
  })
})

// ── 404 ─────────────────────────────────────────────────────────────

describe('errores', () => {
  it('table inexistente → NotFoundError 404', async () => {
    repo.findTableById.mockResolvedValue(null)
    await expect(changeTableStatus(ctx, 'ghost', 'reserved')).rejects.toMatchObject({ statusCode: 404 })
  })
})

// ── Audit row + meta ─────────────────────────────────────────────────

describe('audit', () => {
  it('cada cambio inserta una row en table_events con actorUserId + meta', async () => {
    whenStatus('free')
    await changeTableStatus(ctx, 'tbl-1', 'occupied', { reservationId: 'r1', partySize: 4 })
    expect(repo.recordTableEvent).toHaveBeenCalledWith(expect.anything(), {
      appId: ctx.appId, tenantId: ctx.tenantId, tableId: 'tbl-1',
      fromStatus: 'free', toStatus: 'occupied',
      reservationId: 'r1', partySize: 4, actorUserId: ctx.userId,
    })
  })

  it('meta vacío → reservationId y partySize undefined (no se materializan)', async () => {
    whenStatus('free')
    await changeTableStatus(ctx, 'tbl-1', 'occupied')
    const call = repo.recordTableEvent.mock.calls[0][1]
    expect(call.reservationId).toBeUndefined()
    expect(call.partySize).toBeUndefined()
  })
})

// ── combineTables ───────────────────────────────────────────────────

describe('combineTables', () => {
  it('happy: emite table.combined con primaryId + combinedWith', async () => {
    repo.combineTables.mockResolvedValue({ id: 'tbl-1', combined_with: ['tbl-2', 'tbl-3'] })
    await combineTables(ctx, 'tbl-1', ['tbl-2', 'tbl-3'])
    expect(publish).toHaveBeenCalledWith({
      type: 'table.combined',
      payload: {
        appId: ctx.appId, tenantId: ctx.tenantId,
        primaryTableId: 'tbl-1', combinedWith: ['tbl-2', 'tbl-3'],
      },
    })
  })

  it('primary no existe → NotFoundError', async () => {
    repo.combineTables.mockResolvedValue(null)
    await expect(combineTables(ctx, 'ghost', ['x'])).rejects.toMatchObject({ statusCode: 404 })
    expect(publish).not.toHaveBeenCalled()
  })
})
