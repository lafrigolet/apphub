import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('../lib/db.js', () => ({
  withStaffBypass: vi.fn(async (fn) => fn({ query: vi.fn() })),
  withTenantTransaction: vi.fn(),
  pool: {},
  configurePool: vi.fn(),
}))

vi.mock('../repositories/billing-facts.repository.js', () => ({ insertIfAbsent: vi.fn() }))
vi.mock('../repositories/settings.repository.js', () => ({
  getOrDefaultsExplicit: vi.fn(async () => ({ auto_issue_simplified: false, default_sale_tax_rate: 21 })),
}))
vi.mock('../services/receipts.service.js', () => ({
  issueReceiptCore:   vi.fn(),
  buildIssuedPayload: vi.fn((r) => ({ receiptId: r?.id })),
}))
vi.mock('../lib/redis.js', () => ({
  publishEvent: vi.fn(), configureRedis: vi.fn(), getRedis: vi.fn(),
}))

import { startPaymentsEventsHandler } from '../services/payments-events.handler.js'
import * as settingsRepo from '../repositories/settings.repository.js'
import * as receiptsService from '../services/receipts.service.js'
import { publishEvent } from '../lib/redis.js'
import * as factsRepo from '../repositories/billing-facts.repository.js'

const APP = 'tpv'
const TENANT = '60000000-0000-0000-0000-000000000001'

function makeRedisStub() {
  const handlers = {}
  const sub = { psubscribe: vi.fn((_p, cb) => cb?.(null)), on: vi.fn((evt, fn) => { handlers[evt] = fn }) }
  return { redis: { duplicate: () => sub }, emit: (e) => handlers.pmessage('*.events', 'platform.events', JSON.stringify(e)) }
}

function paid(source = 'tap_to_pay', overrides = {}) {
  return {
    type: 'payment.succeeded',
    payload: { appId: APP, tenantId: TENANT, providerTxId: 'pi_1', amountCents: 1210, currency: 'eur', status: 'succeeded', source, ...overrides },
  }
}

beforeEach(() => vi.clearAllMocks())

describe('payments-events.handler — payment.succeeded', () => {
  it('crea billing_fact con IVA incluido (21%) y base/tax correctos', async () => {
    factsRepo.insertIfAbsent.mockResolvedValue({ id: 'fact-1' })
    const { redis, emit } = makeRedisStub()
    startPaymentsEventsHandler({ redis })
    await emit(paid('tap_to_pay'))

    // 1210 IVA incl. 21% → base round(1210/1.21)=1000, tax=210
    expect(factsRepo.insertIfAbsent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      billId: 'pi_1', totalCents: 1210, subtotalCents: 1000, taxCents: 210,
      sessionId: null, attributed: false,
      payments: [expect.objectContaining({ method: 'card_present', amountCents: 1210 })],
    }))
  })

  it('source tpv_checkout → método card_online', async () => {
    factsRepo.insertIfAbsent.mockResolvedValue({ id: 'fact-2' })
    const { redis, emit } = makeRedisStub()
    startPaymentsEventsHandler({ redis })
    await emit(paid('tpv_checkout'))
    expect(factsRepo.insertIfAbsent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      payments: [expect.objectContaining({ method: 'card_online' })],
    }))
  })

  it('auto_issue → emite recibo y publica tpv.receipt.issued', async () => {
    settingsRepo.getOrDefaultsExplicit.mockResolvedValue({ auto_issue_simplified: true, default_sale_tax_rate: 21 })
    factsRepo.insertIfAbsent.mockResolvedValue({ id: 'fact-3' })
    receiptsService.issueReceiptCore.mockResolvedValue({ receipt: { id: 'r1' }, lines: [] })
    const { redis, emit } = makeRedisStub()
    startPaymentsEventsHandler({ redis })
    await emit(paid())
    expect(receiptsService.issueReceiptCore).toHaveBeenCalledWith(
      expect.anything(), { appId: APP, tenantId: TENANT, subTenantId: null }, expect.objectContaining({ type: 'simplified' }),
    )
    expect(publishEvent).toHaveBeenCalledWith('tpv.receipt.issued', expect.objectContaining({ receiptId: 'r1' }))
  })

  it('ignora payment.succeeded de otra fuente (online normal)', async () => {
    const { redis, emit } = makeRedisStub()
    startPaymentsEventsHandler({ redis })
    await emit(paid('online'))
    expect(factsRepo.insertIfAbsent).not.toHaveBeenCalled()
  })

  it('reentrega (fact ya existe) → no publica recibo', async () => {
    settingsRepo.getOrDefaultsExplicit.mockResolvedValue({ auto_issue_simplified: true, default_sale_tax_rate: 21 })
    factsRepo.insertIfAbsent.mockResolvedValue(null)
    const { redis, emit } = makeRedisStub()
    startPaymentsEventsHandler({ redis })
    await emit(paid())
    expect(receiptsService.issueReceiptCore).not.toHaveBeenCalled()
    expect(publishEvent).not.toHaveBeenCalled()
  })
})
