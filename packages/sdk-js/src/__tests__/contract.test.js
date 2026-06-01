// @splitpay/sdk-js contract (3.2 · P1) — los payloads que el SDK ENVÍA deben
// satisfacer los schemas zod que el backend (platform/splitpay) valida en la
// entrada. Aquí espejamos esos schemas (fuente de verdad:
// platform/splitpay/src/schemas/index.js) y verificamos que cada método del
// SDK produce un body que los schemas aceptan. Si el SDK cambia el shape de
// una request y deja de cumplir el contrato del backend, este test cae.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'
import { createSplitPayClient } from '../index.ts'

// ── Espejo de platform/splitpay/src/schemas/index.js ───────────────────
const SplitRecipientSchema = z.object({
  accountId: z.string().startsWith('acct_'),
  percentage: z.number().min(0).max(100),
  label: z.string().min(1).max(100),
})
const CreateSplitRuleSchema = z.object({
  name: z.string().min(1).max(100),
  platformFeePercent: z.number().min(0).max(100),
  recipients: z.array(SplitRecipientSchema).min(1),
}).refine(
  (d) => Math.abs(d.recipients.reduce((s, r) => s + r.percentage, 0) + d.platformFeePercent - 100) < 0.01,
  { message: 'percentages must sum to 100' },
)
const CreatePaymentIntentSchema = z.object({
  amount: z.number().int().positive(),
  currency: z.string().length(3).toLowerCase(),
  splitRuleId: z.string().uuid(),
  merchantAccountId: z.string().startsWith('acct_'),
  idempotencyKey: z.string().min(1).max(255),
  metadata: z.record(z.string()).optional(),
  returnUrl: z.string().url().optional(),
})
// Refund: en el SDK paymentId viaja en la URL; el body lleva el resto.
const CreateRefundBodySchema = z.object({
  amount: z.number().int().positive().optional(),
  reason: z.enum(['duplicate', 'fraudulent', 'requested_by_customer']).optional(),
  idempotencyKey: z.string().min(1).max(255),
})
const CreateConnectAccountSchema = z.object({
  email: z.string().email(),
  businessType: z.enum(['individual', 'company', 'non_profit']).default('company'),
  country: z.string().length(2).toUpperCase(),
  returnUrl: z.string().url(),
  refreshUrl: z.string().url(),
})

// Captura el body de la última request del SDK.
let lastBody
function mockFetch() {
  global.fetch = vi.fn(async (_url, init) => {
    lastBody = init?.body ? JSON.parse(init.body) : null
    return { ok: true, json: async () => ({ data: {} }) }
  })
}
const client = () => createSplitPayClient({ baseUrl: 'http://api.test', getToken: () => 't' })

beforeEach(() => { lastBody = undefined; mockFetch() })

describe('contract — el body del SDK satisface el schema del backend', () => {
  it('splitRules.create → CreateSplitRuleSchema', async () => {
    await client().splitRules.create({
      name: 'Reparto estándar',
      platformFeePercent: 10,
      recipients: [{ accountId: 'acct_123', percentage: 90, label: 'Vendedor' }],
    })
    expect(CreateSplitRuleSchema.safeParse(lastBody).success).toBe(true)
  })

  it('payments.create → CreatePaymentIntentSchema', async () => {
    await client().payments.create({
      amount: 1500,
      currency: 'eur',
      splitRuleId: '11111111-1111-1111-1111-111111111111',
      merchantAccountId: 'acct_999',
      idempotencyKey: 'idem-1',
      metadata: { orderId: 'o1' },
    })
    expect(CreatePaymentIntentSchema.safeParse(lastBody).success).toBe(true)
  })

  it('payments.refund → CreateRefundBodySchema (paymentId va en la URL)', async () => {
    await client().payments.refund('22222222-2222-2222-2222-222222222222', {
      amount: 500, reason: 'requested_by_customer', idempotencyKey: 'idem-r',
    })
    expect(CreateRefundBodySchema.safeParse(lastBody).success).toBe(true)
  })

  it('connectAccounts.create → CreateConnectAccountSchema', async () => {
    await client().connectAccounts.create({
      email: 'merchant@x.com',
      country: 'ES',
      returnUrl: 'https://x.com/ok',
      refreshUrl: 'https://x.com/retry',
    })
    expect(CreateConnectAccountSchema.safeParse(lastBody).success).toBe(true)
  })

  it('un body inválido (suma de % ≠ 100) sería rechazado por el schema — guardrail del contrato', async () => {
    await client().splitRules.create({
      name: 'malo', platformFeePercent: 10,
      recipients: [{ accountId: 'acct_1', percentage: 50, label: 'X' }], // 10+50 ≠ 100
    })
    expect(CreateSplitRuleSchema.safeParse(lastBody).success).toBe(false)
  })
})
