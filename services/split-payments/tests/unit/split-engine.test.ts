import { describe, it, expect } from 'vitest'
import {
  calculateStripeFee,
  calculatePlatformFee,
  calculateRecipientAmounts,
  simulateSplit,
  calculateProportionalRefunds,
} from '../../src/utils/split-engine.js'
import type { SplitRule } from '../../src/types/index.js'
import { ValidationError } from '../../src/utils/errors.js'

// ── Fixtures ───────────────────────────────────────────────────────────────

function makeSplitRule(overrides: Partial<SplitRule> = {}): SplitRule {
  return {
    id: 'rule-1',
    tenantId: 'tenant-abc',
    subTenantId: null,
    name: 'Marketplace Standard',
    platformFeePercent: 15,
    recipients: [
      { accountId: 'acct_merchant', label: 'Merchant', percentage: 80 },
      { accountId: 'acct_affiliate', label: 'Affiliate', percentage: 5 },
    ],
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

// ── calculateStripeFee ─────────────────────────────────────────────────────

describe('calculateStripeFee', () => {
  it('calculates fee for a standard amount', () => {
    // 100 EUR = 10000 cents → 10000 * 0.029 + 30 = 290 + 30 = 320 cents
    expect(calculateStripeFee(10000)).toBe(320)
  })

  it('calculates fee for a small amount', () => {
    // 1 EUR = 100 cents → 100 * 0.029 + 30 = 2.9 + 30 = 33 (rounded)
    expect(calculateStripeFee(100)).toBe(33)
  })

  it('always rounds to integer cents', () => {
    const fee = calculateStripeFee(999)
    expect(Number.isInteger(fee)).toBe(true)
  })

  it('fee is always positive', () => {
    expect(calculateStripeFee(1)).toBeGreaterThan(0)
  })
})

// ── calculatePlatformFee ──────────────────────────────────────────────────

describe('calculatePlatformFee', () => {
  it('calculates 15% platform fee correctly', () => {
    // 10000 net * 0.15 = 1500
    expect(calculatePlatformFee(10000, 15)).toBe(1500)
  })

  it('calculates 0% platform fee', () => {
    expect(calculatePlatformFee(10000, 0)).toBe(0)
  })

  it('calculates 100% platform fee', () => {
    expect(calculatePlatformFee(10000, 100)).toBe(10000)
  })

  it('rounds fractional cents', () => {
    // 1000 * 0.333 = 333.3 → 333
    expect(calculatePlatformFee(1000, 33.3)).toBe(333)
  })

  it('always returns integer', () => {
    expect(Number.isInteger(calculatePlatformFee(9999, 15))).toBe(true)
  })
})

// ── calculateRecipientAmounts ─────────────────────────────────────────────

describe('calculateRecipientAmounts', () => {
  it('distributes amounts proportionally', () => {
    const rule = makeSplitRule()
    // net after platform fee = 8000
    const result = calculateRecipientAmounts(8000, rule)

    expect(result).toHaveLength(2)
    expect(result[0]!.accountId).toBe('acct_merchant')
    expect(result[1]!.accountId).toBe('acct_affiliate')
  })

  it('last recipient gets remainder to avoid rounding loss', () => {
    const rule = makeSplitRule({
      recipients: [
        { accountId: 'acct_a', label: 'A', percentage: 33 },
        { accountId: 'acct_b', label: 'B', percentage: 33 },
        { accountId: 'acct_c', label: 'C', percentage: 34 },
      ],
    })
    const results = calculateRecipientAmounts(1000, rule)
    const total = results.reduce((sum, r) => sum + r.amount, 0)
    expect(total).toBe(1000)
  })

  it('all amounts are non-negative integers', () => {
    const rule = makeSplitRule()
    const results = calculateRecipientAmounts(8500, rule)
    for (const r of results) {
      expect(r.amount).toBeGreaterThanOrEqual(0)
      expect(Number.isInteger(r.amount)).toBe(true)
    }
  })

  it('handles single recipient taking 100%', () => {
    const rule = makeSplitRule({
      platformFeePercent: 0,
      recipients: [{ accountId: 'acct_solo', label: 'Solo', percentage: 100 }],
    })
    const results = calculateRecipientAmounts(5000, rule)
    expect(results[0]!.amount).toBe(5000)
  })

  it('total distributed equals input amount', () => {
    const rule = makeSplitRule()
    const net = 8765
    const results = calculateRecipientAmounts(net, rule)
    const total = results.reduce((sum, r) => sum + r.amount, 0)
    expect(total).toBe(net)
  })
})

// ── simulateSplit ─────────────────────────────────────────────────────────

describe('simulateSplit', () => {
  it('returns correct simulation structure', () => {
    const rule = makeSplitRule()
    const sim = simulateSplit(10000, 'eur', rule)

    expect(sim).toMatchObject({
      grossAmount: 10000,
      currency: 'eur',
    })
    expect(sim.stripeFee).toBeGreaterThan(0)
    expect(sim.netAmount).toBe(10000 - sim.stripeFee)
    expect(sim.platformFee).toBeGreaterThan(0)
    expect(sim.recipients).toHaveLength(2)
  })

  it('gross = stripe fee + platform fee + all recipient amounts', () => {
    const rule = makeSplitRule()
    const sim = simulateSplit(10000, 'eur', rule)
    const recipientTotal = sim.recipients.reduce((s, r) => s + r.amount, 0)
    expect(sim.stripeFee + sim.platformFee + recipientTotal).toBe(sim.grossAmount)
  })

  it('throws ValidationError for zero amount', () => {
    const rule = makeSplitRule()
    expect(() => simulateSplit(0, 'eur', rule)).toThrow(ValidationError)
  })

  it('throws ValidationError for negative amount', () => {
    const rule = makeSplitRule()
    expect(() => simulateSplit(-100, 'eur', rule)).toThrow(ValidationError)
  })

  it('throws ValidationError when net amount after Stripe fee is negative', () => {
    const rule = makeSplitRule()
    // Amount too small — Stripe fixed fee (30) exceeds net
    expect(() => simulateSplit(10, 'eur', rule)).toThrow(ValidationError)
  })

  it('preserves currency in output', () => {
    const rule = makeSplitRule()
    expect(simulateSplit(10000, 'usd', rule).currency).toBe('usd')
  })

  it('handles 0% platform fee', () => {
    const rule = makeSplitRule({
      platformFeePercent: 0,
      recipients: [{ accountId: 'acct_merchant', label: 'Merchant', percentage: 100 }],
    })
    const sim = simulateSplit(10000, 'eur', rule)
    expect(sim.platformFee).toBe(0)
    expect(sim.recipients[0]!.amount).toBe(sim.netAmount)
  })

  it('all recipient amounts are positive integers', () => {
    const rule = makeSplitRule()
    const sim = simulateSplit(10000, 'eur', rule)
    for (const r of sim.recipients) {
      expect(r.amount).toBeGreaterThan(0)
      expect(Number.isInteger(r.amount)).toBe(true)
    }
  })
})

// ── calculateProportionalRefunds ──────────────────────────────────────────

describe('calculateProportionalRefunds', () => {
  const transfers = [
    { transferId: 'tr_merchant', amount: 8000 },
    { transferId: 'tr_affiliate', amount: 500 },
  ]

  it('calculates full refund proportionally', () => {
    const result = calculateProportionalRefunds(10000, 10000, transfers)
    // Full refund: each transfer reversed by 100%
    const merchantRefund = result.find((r) => r.transferId === 'tr_merchant')!
    const affiliateRefund = result.find((r) => r.transferId === 'tr_affiliate')!
    expect(merchantRefund.refundAmount).toBe(8000)
    expect(affiliateRefund.refundAmount).toBe(500)
  })

  it('calculates 50% partial refund proportionally', () => {
    const result = calculateProportionalRefunds(10000, 5000, transfers)
    const total = result.reduce((s, r) => s + r.refundAmount, 0)
    expect(total).toBe(5000)
  })

  it('last transfer absorbs rounding remainder', () => {
    // 3-way split that doesn't divide evenly
    const t = [
      { transferId: 'tr_1', amount: 3333 },
      { transferId: 'tr_2', amount: 3333 },
      { transferId: 'tr_3', amount: 3334 },
    ]
    const result = calculateProportionalRefunds(10000, 1000, t)
    const total = result.reduce((s, r) => s + r.refundAmount, 0)
    expect(total).toBe(1000)
  })

  it('never refunds more than original transfer amount', () => {
    const result = calculateProportionalRefunds(10000, 10000, transfers)
    for (const { transferId, refundAmount } of result) {
      const original = transfers.find((t) => t.transferId === transferId)!
      expect(refundAmount).toBeLessThanOrEqual(original.amount)
    }
  })

  it('throws ValidationError if refund exceeds original amount', () => {
    expect(() => calculateProportionalRefunds(10000, 10001, transfers)).toThrow(ValidationError)
  })

  it('all refund amounts are non-negative integers', () => {
    const result = calculateProportionalRefunds(10000, 3000, transfers)
    for (const r of result) {
      expect(r.refundAmount).toBeGreaterThanOrEqual(0)
      expect(Number.isInteger(r.refundAmount)).toBe(true)
    }
  })
})
