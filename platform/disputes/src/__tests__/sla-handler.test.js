// disputes.service — submitEvidenceToStripe + handleSlaBreached + handleEvent.
// Las funciones de CRUD básico están cubiertas en disputes.service.test.js;
// este test apunta a los caminos que NO están testeados.
//
// Contrato submitEvidenceToStripe:
//   - Requiere rol staff/super_admin → ForbiddenError si user/vendor.
//   - 404 si dispute no existe.
//   - 403 si stripe_dispute_id ausente (no se puede subir sin link a Stripe).
//   - Marca evidencia como submitted + emite 'dispute.evidence.submit'.
//
// Contrato handleSlaBreached:
//   - Sólo procesa payloads con appId+tenantId+disputeId.
//   - dispute no existe → no-op.
//   - dispute.status != 'open' → no-op (no re-escala investigating/resolved/etc).
//   - dispute open → status="investigating" (nudge para el staff).
//   - Errores se loguean pero NO propagan.
//
// Contrato handleEvent (splitpay.chargeback.created):
//   - Solo procesa cuando hay orderId.
//   - dispute matching → status="escalated_chargeback" + setStripeDisputeId.
//   - dispute no existe para ese order → no-op.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../lib/db.js', () => ({ pool: {}, withTenantTransaction: vi.fn() }))
vi.mock('../lib/redis.js', () => ({ publish: vi.fn() }))
vi.mock('../repositories/disputes.repository.js')

import {
  submitEvidenceToStripe, handleEvent, handleSlaBreached,
} from '../services/disputes.service.js'
import { withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as repo from '../repositories/disputes.repository.js'

const ctx = (overrides = {}) => ({
  appId: 'shop', tenantId: 't1', subTenantId: null,
  userId: 'staff-1', role: 'staff', ...overrides,
})
const DISPUTE = 'disp-1'

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn({}))
})

// ── submitEvidenceToStripe ──────────────────────────────────────────

describe('submitEvidenceToStripe — guards', () => {
  it.each([['user'], ['vendor'], ['buyer']])(
    'rol "%s" → ForbiddenError "only staff"',
    async (role) => {
      await expect(submitEvidenceToStripe(ctx({ role }), DISPUTE))
        .rejects.toMatchObject({ statusCode: 403, message: expect.stringContaining('staff') })
      expect(repo.markEvidenceSubmitted).not.toHaveBeenCalled()
    },
  )

  it('dispute no existe → NotFoundError 404', async () => {
    repo.findById.mockResolvedValue(null)
    await expect(submitEvidenceToStripe(ctx(), DISPUTE)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('dispute SIN stripe_dispute_id → ForbiddenError ("no stripe_dispute_id")', async () => {
    repo.findById.mockResolvedValue({ id: DISPUTE, stripe_dispute_id: null })
    await expect(submitEvidenceToStripe(ctx(), DISPUTE)).rejects.toMatchObject({
      statusCode: 403, message: expect.stringContaining('stripe_dispute_id'),
    })
    expect(repo.markEvidenceSubmitted).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
  })

  it('happy: staff submit → markSubmitted + publish dispute.evidence.submit', async () => {
    repo.findById.mockResolvedValue({ id: DISPUTE, stripe_dispute_id: 'dp_xyz' })
    repo.listEvidence.mockResolvedValue([
      { kind: 'tracking', data: { trackingNumber: '1Z' } },
      { kind: 'note',     data: { text: 'shipped' } },
    ])
    const r = await submitEvidenceToStripe(ctx(), DISPUTE)
    expect(repo.markEvidenceSubmitted).toHaveBeenCalledWith(expect.anything(), 'shop', 't1', DISPUTE)
    expect(publish).toHaveBeenCalledWith({
      type: 'dispute.evidence.submit',
      payload: {
        appId: 'shop', tenantId: 't1',
        disputeId: DISPUTE, stripeDisputeId: 'dp_xyz',
        evidence: [
          { kind: 'tracking', data: { trackingNumber: '1Z' } },
          { kind: 'note',     data: { text: 'shipped' } },
        ],
        submittedByUserId: 'staff-1',
      },
    })
    expect(r).toEqual({ ok: true, items: 2 })
  })

  it('super_admin también puede submit', async () => {
    repo.findById.mockResolvedValue({ id: DISPUTE, stripe_dispute_id: 'dp_xyz' })
    repo.listEvidence.mockResolvedValue([])
    await submitEvidenceToStripe(ctx({ role: 'super_admin' }), DISPUTE)
    expect(repo.markEvidenceSubmitted).toHaveBeenCalled()
  })
})

// ── handleSlaBreached ───────────────────────────────────────────────

describe('handleSlaBreached', () => {
  it('payload sin appId/tenantId/disputeId → no-op', async () => {
    await handleSlaBreached({ payload: { foo: 1 } })
    expect(repo.findById).not.toHaveBeenCalled()
  })

  it('dispute no existe → no-op', async () => {
    repo.findById.mockResolvedValue(null)
    await handleSlaBreached({
      payload: { appId: 'a', tenantId: 't', disputeId: DISPUTE },
    })
    expect(repo.updateStatus).not.toHaveBeenCalled()
  })

  it('dispute.status="investigating" (ya escalado) → no re-escala', async () => {
    repo.findById.mockResolvedValue({ id: DISPUTE, status: 'investigating' })
    await handleSlaBreached({
      payload: { appId: 'a', tenantId: 't', disputeId: DISPUTE },
    })
    expect(repo.updateStatus).not.toHaveBeenCalled()
  })

  it('dispute.status="resolved" → no-op', async () => {
    repo.findById.mockResolvedValue({ id: DISPUTE, status: 'resolved' })
    await handleSlaBreached({
      payload: { appId: 'a', tenantId: 't', disputeId: DISPUTE },
    })
    expect(repo.updateStatus).not.toHaveBeenCalled()
  })

  it('dispute.status="open" → nudge a "investigating"', async () => {
    repo.findById.mockResolvedValue({ id: DISPUTE, status: 'open' })
    await handleSlaBreached({
      payload: { appId: 'a', tenantId: 't', disputeId: DISPUTE },
    })
    expect(repo.updateStatus).toHaveBeenCalledWith(
      expect.anything(), 'a', 't', DISPUTE, { status: 'investigating' },
    )
  })

  it('error en DB no propaga (resilient consumer)', async () => {
    withTenantTransaction.mockRejectedValueOnce(new Error('boom'))
    await expect(handleSlaBreached({
      payload: { appId: 'a', tenantId: 't', disputeId: DISPUTE },
    })).resolves.toBeUndefined()
  })
})

// ── handleEvent (chargeback) ────────────────────────────────────────

describe('handleEvent splitpay.chargeback.created', () => {
  it('ignora eventos != splitpay.chargeback.created', async () => {
    await handleEvent({ type: 'order.paid', payload: { orderId: 'o1' } })
    expect(repo.findByOrderId).not.toHaveBeenCalled()
  })

  it('sin orderId → no-op', async () => {
    await handleEvent({ type: 'splitpay.chargeback.created', payload: { appId: 'a' } })
    expect(repo.findByOrderId).not.toHaveBeenCalled()
  })

  it('dispute no existe para ese order → no-op', async () => {
    repo.findByOrderId.mockResolvedValue(null)
    await handleEvent({
      type: 'splitpay.chargeback.created',
      payload: { appId: 'a', tenantId: 't', orderId: 'o1', stripeDisputeId: 'dp_xyz' },
    })
    expect(repo.updateStatus).not.toHaveBeenCalled()
    expect(repo.setStripeDisputeId).not.toHaveBeenCalled()
  })

  it('dispute matching → status="escalated_chargeback" + setStripeDisputeId', async () => {
    repo.findByOrderId.mockResolvedValue({ id: DISPUTE })
    await handleEvent({
      type: 'splitpay.chargeback.created',
      payload: { appId: 'a', tenantId: 't', orderId: 'o1', stripeDisputeId: 'dp_xyz' },
    })
    expect(repo.updateStatus).toHaveBeenCalledWith(
      expect.anything(), 'a', 't', DISPUTE, { status: 'escalated_chargeback' },
    )
    expect(repo.setStripeDisputeId).toHaveBeenCalledWith(
      expect.anything(), 'a', 't', DISPUTE, 'dp_xyz',
    )
  })

  it('SIN stripeDisputeId en payload → solo cambia status (no setStripeDisputeId)', async () => {
    repo.findByOrderId.mockResolvedValue({ id: DISPUTE })
    await handleEvent({
      type: 'splitpay.chargeback.created',
      payload: { appId: 'a', tenantId: 't', orderId: 'o1' },
    })
    expect(repo.updateStatus).toHaveBeenCalled()
    expect(repo.setStripeDisputeId).not.toHaveBeenCalled()
  })

  it('error en DB se loguea pero NO propaga', async () => {
    withTenantTransaction.mockRejectedValueOnce(new Error('boom'))
    await expect(handleEvent({
      type: 'splitpay.chargeback.created',
      payload: { appId: 'a', tenantId: 't', orderId: 'o1' },
    })).resolves.toBeUndefined()
  })
})
