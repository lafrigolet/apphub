// Cobertura adicional del service: rama de auto-refund en resolve,
// submitEvidenceToStripe (todas las guardas) y handleSlaBreached.
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
vi.mock('../repositories/disputes.repository.js')

import * as service from '../services/disputes.service.js'
import { withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as repo from '../repositories/disputes.repository.js'
import { ForbiddenError, NotFoundError } from '@apphub/platform-sdk/errors'

const APP = 'aikikan'
const TEN = '00000000-0000-0000-0000-000000000001'
const ID  = '11111111-1111-1111-1111-111111111111'
const ORD = '22222222-2222-2222-2222-222222222222'

const staffCtx = { appId: APP, tenantId: TEN, subTenantId: null, userId: 'staff1', role: 'staff' }
const buyerCtx = { appId: APP, tenantId: TEN, subTenantId: null, userId: 'b1', role: 'buyer' }

function mockClient() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }
}

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(mockClient()))
})

describe('resolve — auto-refund branch', () => {
  it('primera transición a resolved_buyer con monto>0 → publica refund.requested', async () => {
    repo.findById.mockResolvedValue({ id: ID, status: 'open' })
    repo.updateStatus.mockResolvedValue({ id: ID, order_id: ORD, status: 'resolved_buyer', resolution_amount_cents: 500, stripe_dispute_id: 'dp_1' })
    repo.markRefundRequested.mockResolvedValue({})
    await service.resolve(staffCtx, ID, { status: 'resolved_buyer', resolutionAmountCents: 500 })
    expect(repo.markRefundRequested).toHaveBeenCalledWith(expect.anything(), APP, TEN, ID)
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'dispute.refund.requested',
      payload: expect.objectContaining({ disputeId: ID, orderId: ORD, amountCents: 500, stripeDisputeId: 'dp_1' }),
    }))
  })

  it('ya estaba resolved_buyer → no re-dispara refund (idempotente)', async () => {
    repo.findById.mockResolvedValue({ id: ID, status: 'resolved_buyer' })
    repo.updateStatus.mockResolvedValue({ id: ID, order_id: ORD, status: 'resolved_buyer', resolution_amount_cents: 500 })
    await service.resolve(staffCtx, ID, { status: 'resolved_buyer', resolutionAmountCents: 500 })
    expect(repo.markRefundRequested).not.toHaveBeenCalled()
  })

  it('resolved_buyer con monto 0 → no dispara refund', async () => {
    repo.findById.mockResolvedValue({ id: ID, status: 'open' })
    repo.updateStatus.mockResolvedValue({ id: ID, order_id: ORD, status: 'resolved_buyer', resolution_amount_cents: 0 })
    await service.resolve(staffCtx, ID, { status: 'resolved_buyer' })
    expect(repo.markRefundRequested).not.toHaveBeenCalled()
  })
})

describe('submitEvidenceToStripe', () => {
  it('rechaza a no-staff', async () => {
    await expect(service.submitEvidenceToStripe(buyerCtx, ID)).rejects.toThrow(ForbiddenError)
  })

  it('NotFound cuando el dispute no existe', async () => {
    repo.findById.mockResolvedValue(null)
    await expect(service.submitEvidenceToStripe(staffCtx, ID)).rejects.toThrow(NotFoundError)
  })

  it('Forbidden cuando no hay stripe_dispute_id', async () => {
    repo.findById.mockResolvedValue({ id: ID, stripe_dispute_id: null })
    await expect(service.submitEvidenceToStripe(staffCtx, ID)).rejects.toThrow(ForbiddenError)
  })

  it('publica evidence.submit y marca submitted', async () => {
    repo.findById.mockResolvedValue({ id: ID, stripe_dispute_id: 'dp_1' })
    repo.listEvidence.mockResolvedValue([{ kind: 'photo', data: { url: 'x' } }])
    repo.markEvidenceSubmitted.mockResolvedValue({})
    const r = await service.submitEvidenceToStripe(staffCtx, ID)
    expect(r).toEqual({ ok: true, items: 1 })
    expect(repo.markEvidenceSubmitted).toHaveBeenCalledWith(expect.anything(), APP, TEN, ID)
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'dispute.evidence.submit',
      payload: expect.objectContaining({ stripeDisputeId: 'dp_1', evidence: [{ kind: 'photo', data: { url: 'x' } }] }),
    }))
  })
})

describe('handleSlaBreached', () => {
  it('ignora payload incompleto', async () => {
    await service.handleSlaBreached({ payload: { appId: APP } })
    expect(withTenantTransaction).not.toHaveBeenCalled()
  })

  it('mueve open → investigating', async () => {
    repo.findById.mockResolvedValue({ id: ID, status: 'open' })
    repo.updateStatus.mockResolvedValue({ id: ID })
    await service.handleSlaBreached({ payload: { appId: APP, tenantId: TEN, disputeId: ID } })
    expect(repo.updateStatus).toHaveBeenCalledWith(expect.anything(), APP, TEN, ID, { status: 'investigating' })
  })

  it('no toca disputes que no están open', async () => {
    repo.findById.mockResolvedValue({ id: ID, status: 'investigating' })
    await service.handleSlaBreached({ payload: { appId: APP, tenantId: TEN, disputeId: ID } })
    expect(repo.updateStatus).not.toHaveBeenCalled()
  })

  it('dispute inexistente → no-op', async () => {
    repo.findById.mockResolvedValue(null)
    await service.handleSlaBreached({ payload: { appId: APP, tenantId: TEN, disputeId: ID } })
    expect(repo.updateStatus).not.toHaveBeenCalled()
  })

  it('swallows errores', async () => {
    repo.findById.mockRejectedValue(new Error('boom'))
    await expect(service.handleSlaBreached({ payload: { appId: APP, tenantId: TEN, disputeId: ID } })).resolves.toBeUndefined()
  })
})

describe('handleEvent — setStripeDisputeId branch', () => {
  it('persiste stripe_dispute_id cuando viene en el payload', async () => {
    repo.findByOrderId.mockResolvedValue({ id: ID })
    repo.updateStatus.mockResolvedValue({ id: ID })
    repo.setStripeDisputeId.mockResolvedValue({})
    await service.handleEvent({
      type: 'splitpay.chargeback.created',
      payload: { appId: APP, tenantId: TEN, orderId: ORD, stripeDisputeId: 'dp_9' },
    })
    expect(repo.setStripeDisputeId).toHaveBeenCalledWith(expect.anything(), APP, TEN, ID, 'dp_9')
  })

  it('ignora chargeback sin orderId', async () => {
    await service.handleEvent({ type: 'splitpay.chargeback.created', payload: { appId: APP, tenantId: TEN } })
    expect(repo.findByOrderId).not.toHaveBeenCalled()
  })
})

describe('postMessage — attachments default branch', () => {
  it('sin attachments → pasa [] al repo', async () => {
    repo.findById.mockResolvedValue({ id: ID, buyer_user_id: 'b1' })
    repo.insertMessage.mockResolvedValue({ id: 'm1' })
    await service.postMessage(buyerCtx, ID, 'hola')
    expect(repo.insertMessage).toHaveBeenCalledWith(expect.anything(), APP, TEN, ID, 'b1', 'buyer', 'hola', [])
  })
})
