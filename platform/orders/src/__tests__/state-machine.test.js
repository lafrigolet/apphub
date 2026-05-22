// FSM de orders (regla CLAUDE.md — transitions controladas).
//
// Mapa autoritativo en orders.service.js#TRANSITIONS:
//   pending   → paid | cancelled
//   paid      → fulfilled | shipped | delivered | cancelled | refunded
//   fulfilled → shipped | delivered | refunded
//   shipped   → delivered | refunded
//   delivered → completed | refunded
//   completed → (terminal)
//   cancelled → (terminal)
//   refunded  → (terminal)

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
vi.mock('../repositories/orders.repository.js')

import * as service from '../services/orders.service.js'
import { withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as repo from '../repositories/orders.repository.js'

const ctx = { appId: 'aikikan', tenantId: '00000000-0000-0000-0000-000000000001', subTenantId: null, userId: 'u1', role: 'buyer' }
const ORDER_ID = '11111111-1111-1111-1111-111111111111'

function mockClient() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }
}

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(mockClient()))
  repo.findItemsByOrderId.mockResolvedValue([])
  repo.updateStatus.mockResolvedValue({ id: ORDER_ID })
  repo.recordStatusChange.mockResolvedValue(undefined)
})

// ── Transiciones felices (allowed) ───────────────────────────────────

const ALLOWED = [
  ['pending',   'paid'],
  ['pending',   'cancelled'],
  ['paid',      'fulfilled'],
  ['paid',      'shipped'],
  ['paid',      'delivered'],
  ['paid',      'cancelled'],
  ['paid',      'refunded'],
  ['fulfilled', 'shipped'],
  ['fulfilled', 'delivered'],
  ['fulfilled', 'refunded'],
  ['shipped',   'delivered'],
  ['shipped',   'refunded'],
  ['delivered', 'completed'],
  ['delivered', 'refunded'],
]

describe('transiciones permitidas', () => {
  for (const [from, to] of ALLOWED) {
    it(`${from} → ${to} ✓`, async () => {
      repo.findOrderById.mockResolvedValue({ id: ORDER_ID, status: from, buyer_user_id: 'u1', total_cents: 1000, currency: 'EUR' })
      await expect(service.changeStatus(ctx, ORDER_ID, to)).resolves.toBeDefined()
      expect(repo.updateStatus).toHaveBeenCalledWith(expect.anything(), ctx.appId, ctx.tenantId, ORDER_ID, to)
      expect(publish).toHaveBeenCalledWith(
        expect.objectContaining({ type: `order.${to}` }),
      )
    })
  }
})

// ── Transiciones prohibidas ──────────────────────────────────────────

const FORBIDDEN = [
  // Backwards / saltos imposibles
  ['paid',      'pending'],
  ['shipped',   'paid'],
  ['delivered', 'paid'],
  ['delivered', 'shipped'],
  ['cancelled', 'paid'],
  ['refunded',  'paid'],
  ['completed', 'refunded'],
  ['completed', 'shipped'],
  // Terminales no salen
  ['cancelled', 'shipped'],
  ['refunded',  'shipped'],
  // pending no puede ir directo a shipped/delivered (debe pasar por paid)
  ['pending',   'shipped'],
  ['pending',   'delivered'],
  ['pending',   'refunded'],
  ['pending',   'fulfilled'],
]

describe('transiciones prohibidas → 409 ConflictError', () => {
  for (const [from, to] of FORBIDDEN) {
    it(`${from} → ${to} ✗`, async () => {
      repo.findOrderById.mockResolvedValue({ id: ORDER_ID, status: from })
      await expect(service.changeStatus(ctx, ORDER_ID, to)).rejects.toMatchObject({ statusCode: 409 })
      expect(repo.updateStatus).not.toHaveBeenCalled()
      expect(publish).not.toHaveBeenCalled()
    })
  }
})

// ── Estados terminales (no salen NUNCA) ─────────────────────────────

describe('estados terminales bloqueados', () => {
  for (const terminal of ['cancelled', 'refunded', 'completed']) {
    it(`${terminal} es terminal: cualquier salida → 409`, async () => {
      repo.findOrderById.mockResolvedValue({ id: ORDER_ID, status: terminal })
      // Probamos transiciones a varios estados — todas deben fallar.
      for (const target of ['paid', 'shipped', 'delivered', 'refunded', 'completed']) {
        if (target === terminal) continue
        repo.updateStatus.mockClear()
        await expect(service.changeStatus(ctx, ORDER_ID, target)).rejects.toMatchObject({ statusCode: 409 })
        expect(repo.updateStatus).not.toHaveBeenCalled()
      }
    })
  }
})

describe('cancelOrder / refundOrder — atajos', () => {
  it('cancelOrder llama a changeStatus(..., "cancelled")', async () => {
    repo.findOrderById.mockResolvedValue({ id: ORDER_ID, status: 'paid', buyer_user_id: 'u1', total_cents: 100, currency: 'EUR' })
    await service.cancelOrder(ctx, ORDER_ID, 'cliente cambió de opinión')
    expect(repo.updateStatus).toHaveBeenCalledWith(expect.anything(), ctx.appId, ctx.tenantId, ORDER_ID, 'cancelled')
    expect(repo.recordStatusChange).toHaveBeenCalledWith(
      expect.anything(), ORDER_ID, ctx.appId, ctx.tenantId,
      'paid', 'cancelled', expect.any(Object), 'cliente cambió de opinión',
    )
  })

  it('refundOrder llama a changeStatus(..., "refunded")', async () => {
    repo.findOrderById.mockResolvedValue({ id: ORDER_ID, status: 'delivered', buyer_user_id: 'u1', total_cents: 100, currency: 'EUR' })
    await service.refundOrder(ctx, ORDER_ID, 'producto roto')
    expect(repo.updateStatus).toHaveBeenCalledWith(expect.anything(), ctx.appId, ctx.tenantId, ORDER_ID, 'refunded')
  })

  it('cancelOrder sobre order entregado → 409 (delivered no acepta cancelled)', async () => {
    repo.findOrderById.mockResolvedValue({ id: ORDER_ID, status: 'delivered' })
    await expect(service.cancelOrder(ctx, ORDER_ID)).rejects.toMatchObject({ statusCode: 409 })
  })
})

describe('order no existe', () => {
  it('changeStatus throws NotFoundError', async () => {
    repo.findOrderById.mockResolvedValue(null)
    await expect(service.changeStatus(ctx, 'no-existe', 'paid')).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('historial: cada transición guarda un record', () => {
  it('recordStatusChange recibe from + to + actor + reason', async () => {
    repo.findOrderById.mockResolvedValue({ id: ORDER_ID, status: 'paid', buyer_user_id: 'u1', total_cents: 100, currency: 'EUR' })
    await service.changeStatus(ctx, ORDER_ID, 'shipped', 'enviado por SEUR el 22/05')
    expect(repo.recordStatusChange).toHaveBeenCalledWith(
      expect.anything(),
      ORDER_ID,
      ctx.appId,
      ctx.tenantId,
      'paid',
      'shipped',
      { userId: 'u1', role: 'buyer' },
      'enviado por SEUR el 22/05',
    )
  })
})
