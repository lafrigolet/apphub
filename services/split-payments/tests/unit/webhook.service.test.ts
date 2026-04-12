import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/lib/db.js', () => ({
  pool: { connect: vi.fn() },
  withTenant: vi.fn(),
}))

vi.mock('../../src/lib/stripe.js', () => ({
  stripe: {
    webhooks: { constructEvent: vi.fn() },
    accounts: { retrieve: vi.fn() },
    transfers: { list: vi.fn() },
  },
}))

vi.mock('../../src/repositories/payment.repository.js', () => ({
  updatePaymentStatus: vi.fn(),
  findPaymentByStripeId: vi.fn(),
}))

vi.mock('../../src/repositories/connect-account.repository.js', () => ({
  updateConnectAccountStatus: vi.fn(),
}))

vi.mock('../../src/services/payment.service.js', () => ({
  createAdditionalTransfers: vi.fn(),
}))

vi.mock('../../src/services/connect-account.service.js', () => ({
  syncAccountFromStripe: vi.fn(),
}))

import { handleWebhookEvent } from '../../src/services/webhook.service.js'
import * as paymentRepo from '../../src/repositories/payment.repository.js'
import * as accountService from '../../src/services/connect-account.service.js'
import * as paymentService from '../../src/services/payment.service.js'
import * as db from '../../src/lib/db.js'
import type Stripe from 'stripe'

const mockClient = { query: vi.fn(), release: vi.fn() }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(db.pool.connect).mockResolvedValue(mockClient as never)
  mockClient.query.mockResolvedValue({ rows: [], rowCount: 1 })
})

function makeEvent(type: string, data: object): Stripe.Event {
  return {
    id: 'evt_test_123',
    type,
    data: { object: data },
    object: 'event',
    api_version: '2024-06-20',
    created: 1234567890,
    livemode: false,
    pending_webhooks: 0,
    request: null,
  } as Stripe.Event
}

describe('handleWebhookEvent', () => {
  describe('payment_intent.succeeded', () => {
    it('updates payment status to succeeded', async () => {
      vi.mocked(paymentService.createAdditionalTransfers).mockResolvedValue(undefined)

      await handleWebhookEvent(
        makeEvent('payment_intent.succeeded', {
          id: 'pi_test_123',
          latest_charge: 'ch_test_456',
          status: 'succeeded',
        }),
      )

      expect(paymentRepo.updatePaymentStatus).toHaveBeenCalledWith(
        expect.anything(),
        'pi_test_123',
        'succeeded',
      )
    })

    it('triggers additional transfers when charge id is present', async () => {
      vi.mocked(paymentService.createAdditionalTransfers).mockResolvedValue(undefined)

      await handleWebhookEvent(
        makeEvent('payment_intent.succeeded', {
          id: 'pi_test_123',
          latest_charge: 'ch_test_456',
        }),
      )

      expect(paymentService.createAdditionalTransfers).toHaveBeenCalledWith(
        'pi_test_123',
        'ch_test_456',
      )
    })
  })

  describe('payment_intent.payment_failed', () => {
    it('updates payment status to failed', async () => {
      await handleWebhookEvent(
        makeEvent('payment_intent.payment_failed', { id: 'pi_fail_123' }),
      )

      expect(paymentRepo.updatePaymentStatus).toHaveBeenCalledWith(
        expect.anything(),
        'pi_fail_123',
        'failed',
      )
    })
  })

  describe('payment_intent.canceled', () => {
    it('updates payment status to canceled', async () => {
      await handleWebhookEvent(
        makeEvent('payment_intent.canceled', { id: 'pi_canceled_123' }),
      )

      expect(paymentRepo.updatePaymentStatus).toHaveBeenCalledWith(
        expect.anything(),
        'pi_canceled_123',
        'canceled',
      )
    })
  })

  describe('account.updated', () => {
    it('calls syncAccountFromStripe', async () => {
      vi.mocked(accountService.syncAccountFromStripe).mockResolvedValue(undefined)

      await handleWebhookEvent(
        makeEvent('account.updated', { id: 'acct_test_abc' }),
      )

      expect(accountService.syncAccountFromStripe).toHaveBeenCalledWith('acct_test_abc')
    })
  })

  describe('charge.dispute.created', () => {
    it('inserts dispute record into DB', async () => {
      await handleWebhookEvent(
        makeEvent('charge.dispute.created', {
          id: 'dp_test_1',
          charge: 'ch_test_1',
          amount: 5000,
          currency: 'eur',
          reason: 'fraudulent',
          status: 'needs_response',
          evidence_details: { due_by: 1234567890 },
        }),
      )

      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO payments.disputes'),
        expect.arrayContaining(['dp_test_1', 'ch_test_1', 5000]),
      )
    })
  })

  describe('unhandled event types', () => {
    it('does not throw for unknown event types', async () => {
      await expect(
        handleWebhookEvent(makeEvent('customer.created', { id: 'cus_test' })),
      ).resolves.not.toThrow()
    })
  })
})
