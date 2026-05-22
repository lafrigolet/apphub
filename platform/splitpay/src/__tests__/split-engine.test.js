// split-engine — funciones puras de cálculo del split + Stripe fee.
// Foco crítico porque el dinero se reparte aquí.
//
// Contrato:
//   - STRIPE_FEE = 2.9% + 30c (round).
//   - calculatePlatformFee = round(netAmount * pct/100). NO floating-point drift.
//   - calculateRecipientAmounts:
//       · Recipients prev al último: round(net * pct/100).
//       · Último: remainder (net - distribuido). No se pierde un céntimo.
//   - simulateSplit:
//       · grossAmount <= 0 → ValidationError.
//       · netAmount <= 0 después de Stripe fee → ValidationError.
//       · Estructura: { grossAmount, currency, stripeFee, netAmount, platformFee, recipients }.

import { describe, it, expect } from 'vitest'
import {
  calculateStripeFee, calculatePlatformFee, calculateRecipientAmounts,
  simulateSplit, calculateProportionalRefunds,
} from '../utils/split-engine.js'

// ── Stripe fee ──────────────────────────────────────────────────────

describe('calculateStripeFee', () => {
  it('5000c (50€) → round(5000*0.029) + 30 = 145+30 = 175', () => {
    expect(calculateStripeFee(5000)).toBe(175)
  })

  it('100c (1€) → round(2.9) + 30 = 3+30 = 33', () => {
    expect(calculateStripeFee(100)).toBe(33)
  })

  it('0 → 30 (solo el fixed)', () => {
    expect(calculateStripeFee(0)).toBe(30)
  })

  it('grandes montos no overflow (1M cents)', () => {
    // 1000000 * 0.029 = 29000 + 30 = 29030
    expect(calculateStripeFee(1_000_000)).toBe(29030)
  })

  it('round half-even/away: 51c (0.029 * 51 = 1.479 → round 1)', () => {
    expect(calculateStripeFee(51)).toBe(31)        // 1 + 30
  })
})

// ── platformFee ────────────────────────────────────────────────────

describe('calculatePlatformFee', () => {
  it('netAmount=10000, fee=10% → 1000', () => {
    expect(calculatePlatformFee(10000, 10)).toBe(1000)
  })

  it('netAmount=10000, fee=0% → 0', () => {
    expect(calculatePlatformFee(10000, 0)).toBe(0)
  })

  it('netAmount=10000, fee=100% → 10000', () => {
    expect(calculatePlatformFee(10000, 100)).toBe(10000)
  })

  it('round: 100c, 33.33% → round(33.33) = 33', () => {
    expect(calculatePlatformFee(100, 33.33)).toBe(33)
  })
})

// ── recipientAmounts ───────────────────────────────────────────────

describe('calculateRecipientAmounts — sin floating drift', () => {
  it('1 recipient (100%) → todo el net', () => {
    const r = calculateRecipientAmounts(10000, {
      recipients: [{ accountId: 'a1', label: 'A', percentage: 100 }],
    })
    expect(r).toEqual([{ accountId: 'a1', label: 'A', percentage: 100, amount: 10000 }])
  })

  it('2 recipients 50/50 sin remainder → 5000 + 5000', () => {
    const r = calculateRecipientAmounts(10000, {
      recipients: [
        { accountId: 'a1', label: 'A', percentage: 50 },
        { accountId: 'a2', label: 'B', percentage: 50 },
      ],
    })
    expect(r.map((x) => x.amount)).toEqual([5000, 5000])
  })

  it('3 recipients 33/33/34 → last absorbe remainder (no pérdida de céntimos)', () => {
    const r = calculateRecipientAmounts(10000, {
      recipients: [
        { accountId: 'a1', label: 'A', percentage: 33 },
        { accountId: 'a2', label: 'B', percentage: 33 },
        { accountId: 'a3', label: 'C', percentage: 34 },
      ],
    })
    const sum = r.reduce((s, x) => s + x.amount, 0)
    expect(sum).toBe(10000)                       // SIEMPRE suma a net
  })

  it('3 recipients 33.33/33.33/33.34 (suma=100) → last absorbe', () => {
    const r = calculateRecipientAmounts(100, {
      recipients: [
        { accountId: 'a1', label: 'A', percentage: 33.33 },
        { accountId: 'a2', label: 'B', percentage: 33.33 },
        { accountId: 'a3', label: 'C', percentage: 33.34 },
      ],
    })
    // round(100 * 0.3333) = 33, round = 33, último = 34
    const sum = r.reduce((s, x) => s + x.amount, 0)
    expect(sum).toBe(100)
    expect(r[2].amount).toBe(34)
  })

  it('preserve accountId + label + percentage + amount', () => {
    const r = calculateRecipientAmounts(1000, {
      recipients: [{ accountId: 'acct_xyz', label: 'Merchant A', percentage: 100 }],
    })
    expect(r[0]).toMatchObject({
      accountId: 'acct_xyz', label: 'Merchant A', percentage: 100, amount: 1000,
    })
  })
})

// ── simulateSplit ──────────────────────────────────────────────────

describe('simulateSplit', () => {
  it('grossAmount <= 0 → ValidationError "must be greater than zero"', () => {
    expect(() => simulateSplit(0, 'eur', { platformFeePercent: 10, recipients: [] }))
      .toThrow(/greater than zero/)
    expect(() => simulateSplit(-100, 'eur', { platformFeePercent: 10, recipients: [] }))
      .toThrow(/greater than zero/)
  })

  it('amount tan pequeño que netAmount < 0 → ValidationError', () => {
    // 30c gross - 30c+0.87c fixed = ~ -1 negative
    expect(() => simulateSplit(20, 'eur', {
      platformFeePercent: 10,
      recipients: [{ accountId: 'a', label: 'A', percentage: 100 }],
    })).toThrow(/net amount.*negative/)
  })

  it('happy 50€: gross=5000, stripeFee=175, net=4825, platformFee=10%, sum exact', () => {
    const r = simulateSplit(5000, 'eur', {
      platformFeePercent: 10,
      recipients: [{ accountId: 'a1', label: 'Merchant', percentage: 100 }],
    })
    expect(r.grossAmount).toBe(5000)
    expect(r.currency).toBe('eur')
    expect(r.stripeFee).toBe(175)
    expect(r.netAmount).toBe(4825)
    expect(r.platformFee).toBe(483)                       // round(482.5) = 483
    expect(r.recipients[0].amount).toBe(4825 - 483)       // 4342
    // Suma exacta: stripeFee + platformFee + amount = gross
    expect(r.stripeFee + r.platformFee + r.recipients[0].amount).toBe(5000)
  })

  it('platformFee=0 → todo el net va al recipient', () => {
    const r = simulateSplit(5000, 'eur', {
      platformFeePercent: 0,
      recipients: [{ accountId: 'a', label: 'A', percentage: 100 }],
    })
    expect(r.platformFee).toBe(0)
    expect(r.recipients[0].amount).toBe(r.netAmount)
  })
})

// ── calculateProportionalRefunds (regla CLAUDE.md #6) ──────────────

describe('calculateProportionalRefunds — proporcional (no flat)', () => {
  it('refund total (100%) reversa cada transfer 1:1', () => {
    const r = calculateProportionalRefunds(10000, 10000, [
      { transferId: 't1', amount: 6000 },
      { transferId: 't2', amount: 4000 },
    ])
    expect(r).toEqual([
      { transferId: 't1', refundAmount: 6000 },
      { transferId: 't2', refundAmount: 4000 },
    ])
  })

  it('refund parcial (50%) reversa cada transfer al 50% (NO flat amount)', () => {
    const r = calculateProportionalRefunds(10000, 5000, [
      { transferId: 't1', amount: 6000 },
      { transferId: 't2', amount: 4000 },
    ])
    const total = r.reduce((s, x) => s + x.refundAmount, 0)
    expect(total).toBe(5000)
    // El ratio se mantiene: t1 ≈ 60%, t2 ≈ 40% del refund.
    expect(r[0].refundAmount).toBeGreaterThan(r[1].refundAmount)
  })

  it('último transfer absorbe el residuo de redondeo (no se pierde un céntimo)', () => {
    // 333 / 1000 = 0.333, 3 transfers de 1000 cada uno con refund 333 → 333+333+334=1000
    const r = calculateProportionalRefunds(3000, 1000, [
      { transferId: 't1', amount: 1000 },
      { transferId: 't2', amount: 1000 },
      { transferId: 't3', amount: 1000 },
    ])
    const total = r.reduce((s, x) => s + x.refundAmount, 0)
    expect(total).toBe(1000)
  })

  it('refundAmount > originalAmount → ValidationError', () => {
    expect(() => calculateProportionalRefunds(5000, 10000, [{ transferId: 't1', amount: 5000 }]))
      .toThrow(/cannot exceed/)
  })

  it('refund 0 → todos los amounts 0', () => {
    const r = calculateProportionalRefunds(10000, 0, [
      { transferId: 't1', amount: 6000 },
      { transferId: 't2', amount: 4000 },
    ])
    expect(r.every((x) => x.refundAmount === 0)).toBe(true)
  })

  it('Math.min cap: refundAmount NUNCA excede el transfer.amount original', () => {
    // Caso edge: ratio que produciría > transfer.amount.
    const r = calculateProportionalRefunds(100, 100, [
      { transferId: 't1', amount: 100 },
    ])
    expect(r[0].refundAmount).toBe(100)
  })
})
