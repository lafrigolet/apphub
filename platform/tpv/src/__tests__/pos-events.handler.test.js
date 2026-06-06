import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// withStaffBypass pasa un client falso; los repos están mockeados.
vi.mock('../lib/db.js', () => ({
  withStaffBypass: vi.fn(async (fn) => fn({ query: vi.fn() })),
  withTenantTransaction: vi.fn(),
  pool: {},
  configurePool: vi.fn(),
}))

vi.mock('../repositories/billing-facts.repository.js', () => ({
  insertIfAbsent: vi.fn(),
  markCancelled:  vi.fn(),
}))
vi.mock('../repositories/devices.repository.js', () => ({
  findById: vi.fn(),
}))
vi.mock('../repositories/cash-sessions.repository.js', () => ({
  findOpenByDevice: vi.fn(),
}))
vi.mock('../repositories/cash-movements.repository.js', () => ({
  insert: vi.fn(),
}))
vi.mock('../repositories/settings.repository.js', () => ({
  getOrDefaultsExplicit: vi.fn(async () => ({ auto_issue_simplified: false })),
}))
vi.mock('../services/receipts.service.js', () => ({
  issueReceiptCore:   vi.fn(),
  buildIssuedPayload: vi.fn((r) => ({ receiptId: r?.id })),
}))
vi.mock('../lib/redis.js', () => ({
  publishEvent:   vi.fn(),
  configureRedis: vi.fn(),
  getRedis:       vi.fn(),
}))

import { startPosEventsHandler } from '../services/pos-events.handler.js'
import * as settingsRepo from '../repositories/settings.repository.js'
import * as receiptsService from '../services/receipts.service.js'
import { publishEvent } from '../lib/redis.js'
import * as factsRepo from '../repositories/billing-facts.repository.js'
import * as devicesRepo from '../repositories/devices.repository.js'
import * as sessionsRepo from '../repositories/cash-sessions.repository.js'
import * as movementsRepo from '../repositories/cash-movements.repository.js'

const APP = 'aikikan'
const TENANT = '30000000-0000-0000-0000-000000000001'
const DEVICE = '40000000-0000-0000-0000-000000000001'
const SESSION = '50000000-0000-0000-0000-000000000001'

function makeRedisStub() {
  const handlers = {}
  const sub = {
    psubscribe: vi.fn((_p, cb) => cb?.(null)),
    on: vi.fn((evt, fn) => { handlers[evt] = fn }),
  }
  const redis = { duplicate: () => sub }
  return { redis, emit: (event) => handlers.pmessage('*.events', 'platform.events', JSON.stringify(event)) }
}

function paidEvent(overrides = {}) {
  return {
    type: 'pos.bill.paid',
    payload: {
      appId: APP, tenantId: TENANT, subTenantId: null, billId: 'bill-1',
      totalCents: 5000, tipCents: 200, subtotalCents: 4364, taxCents: 436,
      currency: 'EUR',
      metadata: { deviceId: DEVICE },
      payments: [
        { method: 'cash', amountCents: 3000, tipCents: 200, externalRef: null },
        { method: 'card', amountCents: 2000, tipCents: 0, externalRef: 'pi_1' },
      ],
      items: [{ sku: 'KGI-1', name: 'Keikogi', qty: 1, unitPriceCents: 4364, course: 'other', modifiers: null }],
      ...overrides,
    },
  }
}

beforeEach(() => vi.clearAllMocks())

describe('pos-events.handler — pos.bill.paid', () => {
  it('crea billing_fact e imputa el cash (importe + propina) a la sesión abierta del device', async () => {
    devicesRepo.findById.mockResolvedValue({ id: DEVICE, app_id: APP, tenant_id: TENANT, active: true })
    sessionsRepo.findOpenByDevice.mockResolvedValue({ id: SESSION, app_id: APP, tenant_id: TENANT })
    factsRepo.insertIfAbsent.mockResolvedValue({ id: 'fact-1' })

    const { redis, emit } = makeRedisStub()
    startPosEventsHandler({ redis })
    await emit(paidEvent())

    expect(factsRepo.insertIfAbsent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      billId: 'bill-1', deviceId: DEVICE, sessionId: SESSION, attributed: true,
    }))
    expect(movementsRepo.insert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      kind: 'sale_cash', amountCents: 3200, sessionId: SESSION, source: 'event', billingFactId: 'fact-1',
    }))
  })

  it('sin deviceId → fact huérfano (session NULL) y sin movimiento', async () => {
    factsRepo.insertIfAbsent.mockResolvedValue({ id: 'fact-2' })

    const { redis, emit } = makeRedisStub()
    startPosEventsHandler({ redis })
    await emit(paidEvent({ metadata: {} }))

    expect(devicesRepo.findById).not.toHaveBeenCalled()
    expect(factsRepo.insertIfAbsent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      deviceId: null, sessionId: null, attributed: false,
    }))
    expect(movementsRepo.insert).not.toHaveBeenCalled()
  })

  it('device de OTRO tenant → se ignora (huérfano), nunca cruza tenants', async () => {
    devicesRepo.findById.mockResolvedValue({ id: DEVICE, app_id: 'split-pay', tenant_id: TENANT, active: true })
    factsRepo.insertIfAbsent.mockResolvedValue({ id: 'fact-3' })

    const { redis, emit } = makeRedisStub()
    startPosEventsHandler({ redis })
    await emit(paidEvent())

    expect(sessionsRepo.findOpenByDevice).not.toHaveBeenCalled()
    expect(factsRepo.insertIfAbsent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      deviceId: null, sessionId: null,
    }))
  })

  it('reentrega del evento (fact ya existe) → no duplica el movimiento', async () => {
    devicesRepo.findById.mockResolvedValue({ id: DEVICE, app_id: APP, tenant_id: TENANT, active: true })
    sessionsRepo.findOpenByDevice.mockResolvedValue({ id: SESSION, app_id: APP, tenant_id: TENANT })
    factsRepo.insertIfAbsent.mockResolvedValue(null) // ON CONFLICT DO NOTHING

    const { redis, emit } = makeRedisStub()
    startPosEventsHandler({ redis })
    await emit(paidEvent())

    expect(movementsRepo.insert).not.toHaveBeenCalled()
  })

  it('payload legado sin payments → se ignora', async () => {
    const { redis, emit } = makeRedisStub()
    startPosEventsHandler({ redis })
    await emit({ type: 'pos.bill.paid', payload: { appId: APP, tenantId: TENANT, billId: 'b', items: [] } })
    expect(factsRepo.insertIfAbsent).not.toHaveBeenCalled()
  })
})

describe('pos-events.handler — auto-issue', () => {
  it('con auto_issue_simplified emite recibo y publica tpv.receipt.issued tras commit', async () => {
    devicesRepo.findById.mockResolvedValue({ id: DEVICE, app_id: APP, tenant_id: TENANT, active: true })
    sessionsRepo.findOpenByDevice.mockResolvedValue({ id: SESSION, app_id: APP, tenant_id: TENANT })
    factsRepo.insertIfAbsent.mockResolvedValue({ id: 'fact-1' })
    settingsRepo.getOrDefaultsExplicit.mockResolvedValue({ auto_issue_simplified: true })
    receiptsService.issueReceiptCore.mockResolvedValue({ receipt: { id: 'r1' }, lines: [] })

    const { redis, emit } = makeRedisStub()
    startPosEventsHandler({ redis })
    await emit(paidEvent())

    expect(receiptsService.issueReceiptCore).toHaveBeenCalledWith(
      expect.anything(),
      { appId: APP, tenantId: TENANT, subTenantId: null },
      expect.objectContaining({ type: 'simplified' }),
    )
    expect(publishEvent).toHaveBeenCalledWith('tpv.receipt.issued', expect.objectContaining({ receiptId: 'r1' }))
  })

  it('si la emisión automática falla, el fact queda pending y no se publica nada', async () => {
    devicesRepo.findById.mockResolvedValue({ id: DEVICE, app_id: APP, tenant_id: TENANT, active: true })
    sessionsRepo.findOpenByDevice.mockResolvedValue({ id: SESSION, app_id: APP, tenant_id: TENANT })
    factsRepo.insertIfAbsent.mockResolvedValue({ id: 'fact-1' })
    settingsRepo.getOrDefaultsExplicit.mockResolvedValue({ auto_issue_simplified: true })
    receiptsService.issueReceiptCore.mockRejectedValue(new Error('issuer not configured'))

    const { redis, emit } = makeRedisStub()
    startPosEventsHandler({ redis })
    await emit(paidEvent())

    expect(publishEvent).not.toHaveBeenCalledWith('tpv.receipt.issued', expect.anything())
    // la imputación de efectivo sí se hizo
    expect(movementsRepo.insert).toHaveBeenCalled()
  })
})

describe('pos-events.handler — pos.bill.cancelled', () => {
  it('marca el fact pendiente como cancelled', async () => {
    const { redis, emit } = makeRedisStub()
    startPosEventsHandler({ redis })
    await emit({ type: 'pos.bill.cancelled', payload: { appId: APP, tenantId: TENANT, billId: 'bill-1' } })
    expect(factsRepo.markCancelled).toHaveBeenCalledWith(expect.anything(), APP, TENANT, 'bill-1')
  })
})
