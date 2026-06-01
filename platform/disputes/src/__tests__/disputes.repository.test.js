// disputes.repository — SQL shape de platform_disputes.*.
// Valida proyección de columnas, scoping (app_id + tenant_id), filtros
// opcionales, paginación y el stamping FSM de updateStatus.
import { describe, it, expect, vi } from 'vitest'
import * as repo from '../repositories/disputes.repository.js'

function mockClient(rows = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) }
}

const APP = 'aikikan'
const TEN = 't1'
const ID = 'd1'

describe('insert', () => {
  it('INSERT en platform_disputes.disputes con scoping + COALESCE status', async () => {
    const c = mockClient([{ id: ID }])
    const r = await repo.insert(c, APP, TEN, { orderId: 'o1', buyerUserId: 'b1', reason: 'not_received', description: 'desc', status: 'open' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_disputes\.disputes/)
    expect(sql).toMatch(/COALESCE\(\$7,'open'\)/)
    expect(params).toEqual([APP, TEN, 'o1', 'b1', 'not_received', 'desc', 'open'])
    expect(r).toEqual({ id: ID })
  })

  it('description/status ausentes → null', async () => {
    const c = mockClient([{ id: ID }])
    await repo.insert(c, APP, TEN, { orderId: 'o1', buyerUserId: 'b1', reason: 'x' })
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, 'o1', 'b1', 'x', null, null])
  })
})

describe('findById', () => {
  it('scopea por app_id + tenant_id + id; sin row → null', async () => {
    const c = mockClient([])
    expect(await repo.findById(c, APP, TEN, ID)).toBeNull()
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/WHERE app_id=\$1 AND tenant_id=\$2 AND id=\$3/)
    expect(params).toEqual([APP, TEN, ID])
  })

  it('devuelve la fila cuando existe', async () => {
    const c = mockClient([{ id: ID }])
    expect(await repo.findById(c, APP, TEN, ID)).toEqual({ id: ID })
  })
})

describe('findByOrderId', () => {
  it('scopea por order_id; sin row → null', async () => {
    const c = mockClient([])
    expect(await repo.findByOrderId(c, APP, TEN, 'o9')).toBeNull()
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/WHERE app_id=\$1 AND tenant_id=\$2 AND order_id=\$3/)
    expect(params).toEqual([APP, TEN, 'o9'])
  })
})

describe('listByTenant', () => {
  it('sin status → solo app_id+tenant_id; limit/offset por defecto', async () => {
    const c = mockClient([])
    await repo.listByTenant(c, APP, TEN)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).not.toMatch(/status = /)
    expect(sql).toMatch(/ORDER BY created_at DESC/)
    expect(params).toEqual([APP, TEN, 50, 0])
  })

  it('con status → añade filtro y limit/offset al final', async () => {
    const c = mockClient([])
    await repo.listByTenant(c, APP, TEN, { status: 'open', limit: 10, offset: 5 })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/status = \$3/)
    expect(params).toEqual([APP, TEN, 'open', 10, 5])
  })
})

describe('updateStatus — FSM stamping', () => {
  it('status base sin extras → solo SET status + updated_at', async () => {
    const c = mockClient([{ id: ID }])
    await repo.updateStatus(c, APP, TEN, ID, { status: 'investigating' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/SET status = \$4, updated_at = now\(\)/)
    expect(sql).not.toMatch(/resolution_amount_cents/)
    expect(sql).not.toMatch(/resolved_at/)
    expect(params).toEqual([APP, TEN, ID, 'investigating'])
  })

  it('resolución → stampa resolved_at, resolved_by + montos/notas', async () => {
    const c = mockClient([{ id: ID }])
    await repo.updateStatus(c, APP, TEN, ID, {
      status: 'resolved_buyer', resolutionAmountCents: 500, resolutionNotes: 'ok', resolvedByUserId: 'staff1',
    })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/resolution_amount_cents = \$5/)
    expect(sql).toMatch(/resolution_notes = \$6/)
    expect(sql).toMatch(/resolved_at = now\(\)/)
    expect(sql).toMatch(/resolved_by_user_id = \$7/)
    expect(params).toEqual([APP, TEN, ID, 'resolved_buyer', 500, 'ok', 'staff1'])
  })

  it('resolución sin resolvedByUserId → null', async () => {
    const c = mockClient([{ id: ID }])
    await repo.updateStatus(c, APP, TEN, ID, { status: 'escalated_chargeback' })
    const params = c.query.mock.calls[0][1]
    expect(params[params.length - 1]).toBeNull()
  })

  it('row inexistente → null', async () => {
    const c = mockClient([])
    expect(await repo.updateStatus(c, APP, TEN, 'ghost', { status: 'open' })).toBeNull()
  })
})

describe('insertMessage', () => {
  it('INSERT en dispute_messages serializando attachments a JSON', async () => {
    const c = mockClient([{ id: 'm1' }])
    await repo.insertMessage(c, APP, TEN, ID, 'u1', 'buyer', 'hola', [{ url: 'x' }])
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_disputes\.dispute_messages/)
    expect(params).toEqual([APP, TEN, ID, 'u1', 'buyer', 'hola', JSON.stringify([{ url: 'x' }])])
  })

  it('attachments por defecto → []', async () => {
    const c = mockClient([{ id: 'm1' }])
    await repo.insertMessage(c, APP, TEN, ID, 'u1', 'buyer', 'hola')
    expect(c.query.mock.calls[0][1][6]).toBe('[]')
  })
})

describe('listMessages', () => {
  it('SELECT ordenado ASC scopeado', async () => {
    const c = mockClient([{ id: 'm1' }])
    const r = await repo.listMessages(c, APP, TEN, ID)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/FROM platform_disputes\.dispute_messages/)
    expect(sql).toMatch(/ORDER BY created_at ASC/)
    expect(params).toEqual([APP, TEN, ID])
    expect(r).toEqual([{ id: 'm1' }])
  })
})

describe('insertEvidence', () => {
  it('INSERT en dispute_evidence con uploaded_by', async () => {
    const c = mockClient([{ id: 'e1' }])
    await repo.insertEvidence(c, APP, TEN, ID, 'photo', { url: 'x' }, 'u1')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_disputes\.dispute_evidence/)
    expect(params).toEqual([APP, TEN, ID, 'photo', { url: 'x' }, 'u1'])
  })

  it('uploadedBy ausente → null', async () => {
    const c = mockClient([{ id: 'e1' }])
    await repo.insertEvidence(c, APP, TEN, ID, 'photo', {})
    expect(c.query.mock.calls[0][1][5]).toBeNull()
  })
})

describe('listEvidence', () => {
  it('SELECT ordenado ASC scopeado', async () => {
    const c = mockClient([{ id: 'e1' }])
    await repo.listEvidence(c, APP, TEN, ID)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/FROM platform_disputes\.dispute_evidence/)
    expect(sql).toMatch(/ORDER BY created_at ASC/)
    expect(params).toEqual([APP, TEN, ID])
  })
})

describe('setStripeDisputeId', () => {
  it('UPDATE stripe_dispute_id scopeado; sin row → null', async () => {
    const c = mockClient([])
    expect(await repo.setStripeDisputeId(c, APP, TEN, ID, 'dp_1')).toBeNull()
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/SET stripe_dispute_id = \$4/)
    expect(params).toEqual([APP, TEN, ID, 'dp_1'])
  })

  it('devuelve la fila cuando existe', async () => {
    const c = mockClient([{ id: ID }])
    expect(await repo.setStripeDisputeId(c, APP, TEN, ID, 'dp_1')).toEqual({ id: ID })
  })
})

describe('markRefundRequested', () => {
  it('UPDATE con COALESCE idempotente; sin row → null', async () => {
    const c = mockClient([])
    expect(await repo.markRefundRequested(c, APP, TEN, ID)).toBeNull()
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/refund_requested_at = COALESCE\(refund_requested_at, now\(\)\)/)
    expect(params).toEqual([APP, TEN, ID])
  })
})

describe('markEvidenceSubmitted', () => {
  it('UPDATE evidence_submitted_at; sin row → null', async () => {
    const c = mockClient([])
    expect(await repo.markEvidenceSubmitted(c, APP, TEN, ID)).toBeNull()
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/SET evidence_submitted_at = now\(\)/)
    expect(params).toEqual([APP, TEN, ID])
  })

  it('devuelve la fila cuando existe', async () => {
    const c = mockClient([{ evidence_submitted_at: 'ts' }])
    expect(await repo.markEvidenceSubmitted(c, APP, TEN, ID)).toEqual({ evidence_submitted_at: 'ts' })
  })
})
