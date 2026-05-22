// Regla CLAUDE.md #6: "Split reversals are proportional — refund each
// Transfer by the same percentage as the original split, never a flat
// amount."
//
// Este suite cubre dos contratos:
//   (a) calculateProportionalRefunds (utils/split-engine.js) — la
//       función pura que distribuye el refund total entre los transfers.
//   (b) createRefund (services/payment.service.js) — el wrapper que
//       llama a Stripe refunds + Stripe transfers.createReversal para
//       cada transfer original con la proporción correcta.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── (a) Pure function — calculateProportionalRefunds ──────────────────

import { calculateProportionalRefunds } from '../utils/split-engine.js'

describe('calculateProportionalRefunds — distribución proporcional', () => {
  it('refund total (100%) reversa cada transfer 1:1', () => {
    const r = calculateProportionalRefunds(10000, 10000, [
      { transferId: 'tr_A', amount: 6000 },
      { transferId: 'tr_B', amount: 3000 },
      { transferId: 'tr_C', amount: 1000 },
    ])
    expect(r).toEqual([
      { transferId: 'tr_A', refundAmount: 6000 },
      { transferId: 'tr_B', refundAmount: 3000 },
      { transferId: 'tr_C', refundAmount: 1000 },
    ])
  })

  it('refund parcial (50%) reversa cada transfer al 50%', () => {
    const r = calculateProportionalRefunds(10000, 5000, [
      { transferId: 'tr_A', amount: 6000 },
      { transferId: 'tr_B', amount: 3000 },
      { transferId: 'tr_C', amount: 1000 },
    ])
    // ratio = 0.5 → total a revertir = round(10000 * 0.5) = 5000
    // Distribución proporcional manteniendo la suma exacta.
    expect(r.reduce((s, x) => s + x.refundAmount, 0)).toBe(5000)
    // Las proporciones tienen que respetar el ratio.
    expect(r[0].refundAmount).toBeCloseTo(3000, -1)
    expect(r[1].refundAmount).toBeCloseTo(1500, -1)
    expect(r[2].refundAmount).toBeCloseTo(500,  -1)
  })

  it('último transfer absorbe el residuo de redondeo (no se pierde un céntimo)', () => {
    // 100€ totales, 33% refund, 3 transfers iguales — la suma exacta del
    // refund debe coincidir con round(10000 * 0.33) = 3300.
    const r = calculateProportionalRefunds(10000, 3300, [
      { transferId: 'tr_A', amount: 3333 },
      { transferId: 'tr_B', amount: 3333 },
      { transferId: 'tr_C', amount: 3334 },
    ])
    expect(r.reduce((s, x) => s + x.refundAmount, 0)).toBe(3300)
  })

  it('rechaza con ValidationError si refundAmount > originalAmount', () => {
    expect(() =>
      calculateProportionalRefunds(1000, 1500, [{ transferId: 't', amount: 1000 }]),
    ).toThrow(/cannot exceed/i)
  })

  it('refund 0 devuelve [0, 0, 0] — NO flat amount, NO negativo', () => {
    const r = calculateProportionalRefunds(10000, 0, [
      { transferId: 'tr_A', amount: 6000 },
      { transferId: 'tr_B', amount: 4000 },
    ])
    expect(r.every((x) => x.refundAmount === 0)).toBe(true)
  })

  it('no hay flat-amount: cada transfer se reduce por el MISMO ratio (regla #6)', () => {
    // Con 30% refund, NO podemos revertir 1000 fijo a cada transfer.
    const r = calculateProportionalRefunds(10000, 3000, [
      { transferId: 'tr_A', amount: 8000 },   // grande
      { transferId: 'tr_B', amount: 2000 },   // pequeño
    ])
    // Cada transfer reducido al 30% (con tolerancia de redondeo +-1):
    expect(r[0].refundAmount).toBeGreaterThanOrEqual(2399)
    expect(r[0].refundAmount).toBeLessThanOrEqual(2401)
    expect(r[1].refundAmount).toBeGreaterThanOrEqual(599)
    expect(r[1].refundAmount).toBeLessThanOrEqual(601)
    // Si fuera flat (1500 cada uno), tr_B se quedaría negativo o tr_A bajo.
    expect(r[0].refundAmount).not.toBe(1500)
    expect(r[1].refundAmount).not.toBe(1500)
  })
})

// ── (b) createRefund integration — llamadas a Stripe ─────────────────

const { stripeMock, idempCheck, idempStore } = vi.hoisted(() => ({
  stripeMock: {
    transfers: {
      list:           vi.fn(),
      createReversal: vi.fn().mockResolvedValue({}),
    },
    refunds: {
      create: vi.fn(),
    },
  },
  idempCheck: vi.fn().mockResolvedValue(null),
  idempStore: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../lib/env.js', () => ({
  env: { SPLITPAY_STRIPE_SECRET_KEY: 'sk_test', SPLITPAY_STRIPE_WEBHOOK_SECRET: 'whsec' },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../lib/stripe.js', () => ({ stripe: stripeMock, getWebhookSecret: vi.fn() }))
vi.mock('../lib/db.js', () => ({
  pool: { connect: vi.fn().mockResolvedValue({ release: vi.fn() }) },
}))
vi.mock('../lib/redis.js', () => ({
  redis: {},
  checkIdempotency: idempCheck,
  storeIdempotency: idempStore,
}))
vi.mock('../repositories/payment.repository.js', () => ({
  findPaymentById: vi.fn(),
}))

import { createRefund } from '../services/payment.service.js'
import * as paymentRepo from '../repositories/payment.repository.js'

const ctx = { appId: 'aikikan', tenantId: '00000000-0000-0000-0000-000000000001', userId: 'u1' }

beforeEach(() => {
  vi.clearAllMocks()
  idempCheck.mockResolvedValue(null)
  paymentRepo.findPaymentById.mockResolvedValue({
    id: 'p1', stripePaymentIntentId: 'pi_test', amount: 10000, currency: 'EUR',
  })
  stripeMock.refunds.create.mockResolvedValue({ id: 're_test_1' })
  stripeMock.transfers.list.mockResolvedValue({ data: [] })
})

describe('createRefund — idempotencia (regla CLAUDE.md #3)', () => {
  it('si la idempotencyKey ya está cacheada, NO llama a Stripe (return cached)', async () => {
    idempCheck.mockResolvedValueOnce(JSON.stringify({ refundId: 're_cached' }))
    const r = await createRefund(ctx, { paymentId: 'p1', idempotencyKey: 'idem-abc' })
    expect(r).toEqual({ refundId: 're_cached' })
    expect(stripeMock.refunds.create).not.toHaveBeenCalled()
  })

  it('1ª ejecución: llama a Stripe y guarda en Redis con la misma idem key', async () => {
    await createRefund(ctx, { paymentId: 'p1', idempotencyKey: 'idem-1', reason: 'requested_by_customer' })
    expect(stripeMock.refunds.create).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: 'pi_test', amount: 10000 }),
      { idempotencyKey: 'ref_idem-1' },   // prefijo `ref_` para Stripe
    )
    expect(idempStore).toHaveBeenCalledWith('idem-1', { refundId: 're_test_1' })
  })
})

describe('createRefund — split reversals proporcionales (regla CLAUDE.md #6)', () => {
  it('para refund total (100%) reversa cada transfer 1:1', async () => {
    stripeMock.transfers.list.mockResolvedValueOnce({
      data: [
        { id: 'tr_A', amount: 6000 },
        { id: 'tr_B', amount: 4000 },
      ],
    })

    await createRefund(ctx, { paymentId: 'p1', idempotencyKey: 'idem-2' })

    expect(stripeMock.transfers.createReversal).toHaveBeenCalledTimes(2)
    expect(stripeMock.transfers.createReversal).toHaveBeenCalledWith(
      'tr_A', { amount: 6000 }, { idempotencyKey: 'rev_idem-2_tr_A' },
    )
    expect(stripeMock.transfers.createReversal).toHaveBeenCalledWith(
      'tr_B', { amount: 4000 }, { idempotencyKey: 'rev_idem-2_tr_B' },
    )
  })

  it('para refund parcial (50%) reversa CADA transfer al 50% (no flat)', async () => {
    stripeMock.transfers.list.mockResolvedValueOnce({
      data: [
        { id: 'tr_X', amount: 8000 },
        { id: 'tr_Y', amount: 2000 },
      ],
    })

    await createRefund(ctx, { paymentId: 'p1', amount: 5000, idempotencyKey: 'idem-3' })

    const callsByTransfer = Object.fromEntries(
      stripeMock.transfers.createReversal.mock.calls.map((c) => [c[0], c[1].amount]),
    )
    // 50% del original: tr_X (8000) → 4000, tr_Y (2000) → 1000.
    // El último absorbe el residuo de redondeo si lo hubiera; aquí cuadra exacto.
    expect(callsByTransfer.tr_X + callsByTransfer.tr_Y).toBe(5000)
    expect(callsByTransfer.tr_X).toBeCloseTo(4000, -1)
    expect(callsByTransfer.tr_Y).toBeCloseTo(1000, -1)
  })

  it('skip transfers con reverseAmount <= 0 (no llamada a Stripe innecesaria)', async () => {
    stripeMock.transfers.list.mockResolvedValueOnce({
      data: [{ id: 'tr_Z', amount: 10000 }],
    })
    // amount=0 → ratio=0 → reverseAmount=0
    await createRefund(ctx, { paymentId: 'p1', amount: 0, idempotencyKey: 'idem-4' })
    expect(stripeMock.transfers.createReversal).not.toHaveBeenCalled()
  })

  it('cada reversal lleva su propio idempotencyKey con prefijo rev_', async () => {
    stripeMock.transfers.list.mockResolvedValueOnce({
      data: [
        { id: 'tr_1', amount: 5000 },
        { id: 'tr_2', amount: 5000 },
      ],
    })
    await createRefund(ctx, { paymentId: 'p1', idempotencyKey: 'idem-5' })
    const idemKeys = stripeMock.transfers.createReversal.mock.calls.map((c) => c[2].idempotencyKey)
    expect(idemKeys).toEqual(['rev_idem-5_tr_1', 'rev_idem-5_tr_2'])
  })

  it('si un reversal falla, el error se loguea pero NO interrumpe los siguientes', async () => {
    stripeMock.transfers.list.mockResolvedValueOnce({
      data: [
        { id: 'tr_fail', amount: 5000 },
        { id: 'tr_ok',   amount: 5000 },
      ],
    })
    stripeMock.transfers.createReversal
      .mockRejectedValueOnce(new Error('tr_fail already reversed'))
      .mockResolvedValueOnce({})

    await createRefund(ctx, { paymentId: 'p1', idempotencyKey: 'idem-6' })
    expect(stripeMock.transfers.createReversal).toHaveBeenCalledTimes(2)
  })

  it('sin transfers (no Connect, payout directo) → solo Stripe refunds.create, no reversals', async () => {
    stripeMock.transfers.list.mockResolvedValueOnce({ data: [] })
    await createRefund(ctx, { paymentId: 'p1', idempotencyKey: 'idem-7' })
    expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1)
    expect(stripeMock.transfers.createReversal).not.toHaveBeenCalled()
  })
})
