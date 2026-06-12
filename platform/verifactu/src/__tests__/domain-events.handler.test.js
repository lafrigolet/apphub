import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('@apphub/platform-sdk/redis', () => ({ publish: vi.fn() }))
vi.mock('../lib/qr.js', () => ({ generarQrDataUri: vi.fn(async () => 'data:image/png;base64,QR') }))
vi.mock('../services/verifactu.service.js', () => ({ crearRegistro: vi.fn() }))

import { startDomainEventsHandler } from '../services/domain-events.handler.js'
import { crearRegistro } from '../services/verifactu.service.js'
import { publish } from '@apphub/platform-sdk/redis'

const TENANT = '60000000-0000-0000-0000-000000000001'

function makeRedisStub() {
  const handlers = {}
  const sub = { psubscribe: vi.fn((_p, cb) => cb?.(null)), on: vi.fn((evt, fn) => { handlers[evt] = fn }), duplicate: vi.fn() }
  sub.duplicate.mockReturnValue(sub)
  return { redis: sub, emit: (e) => handlers.pmessage('*.events', 'platform.events', JSON.stringify(e)) }
}

beforeEach(() => vi.clearAllMocks())

describe('domain-events.handler', () => {
  it('order.completed → crearRegistro alta (orders) + publica verifactu.registro.created', async () => {
    crearRegistro.mockResolvedValue({ serie: 'A/7', huella: 'H7', qrUrl: 'https://cotejo/x' })
    const { redis, emit } = makeRedisStub()
    startDomainEventsHandler({ redis })
    await emit({ type: 'order.completed', payload: { appId: 'shop', tenantId: TENANT, orderId: 'o1', totalCents: 12100, taxCents: 2100, completedAt: '2027-03-01T12:00:00Z' } })

    expect(crearRegistro).toHaveBeenCalledWith(
      { appId: 'shop', tenantId: TENANT, subTenantId: null },
      expect.objectContaining({ origen: 'orders', orderId: 'o1', tipoFactura: 'F1', importeTotal: '121.00', cuotaTotal: '21.00' }),
    )
    expect(publish).toHaveBeenCalledWith(redis, 'platform', expect.objectContaining({
      type: 'verifactu.registro.created',
      payload: expect.objectContaining({ orderId: 'o1', numSerie: 'A/7', huella: 'H7' }),
    }))
  })

  it('donation.created → crearRegistro alta (donations)', async () => {
    crearRegistro.mockResolvedValue({ serie: 'A/8', huella: 'H8', qrUrl: null })
    const { redis, emit } = makeRedisStub()
    startDomainEventsHandler({ redis })
    await emit({ type: 'donation.created', payload: { appId: 'ong', tenantId: TENANT, donationId: 'd1', amountCents: 5000 } })

    expect(crearRegistro).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT }),
      expect.objectContaining({ origen: 'donations', donationId: 'd1', importeTotal: '50.00' }),
    )
  })

  it('no consume pos.bill.closed (cobertura vía cadena TPV)', async () => {
    const { redis, emit } = makeRedisStub()
    startDomainEventsHandler({ redis })
    await emit({ type: 'pos.bill.closed', payload: { appId: 'rest', tenantId: TENANT, billId: 'b1' } })
    expect(crearRegistro).not.toHaveBeenCalled()
  })

  it('reentrega (índice único de dedupe) → ignora sin propagar error', async () => {
    const dup = Object.assign(new Error('duplicate key'), { code: '23505', constraint: 'uq_vf_registros_order' })
    crearRegistro.mockRejectedValue(dup)
    const { redis, emit } = makeRedisStub()
    startDomainEventsHandler({ redis })
    await emit({ type: 'order.completed', payload: { appId: 'shop', tenantId: TENANT, orderId: 'o1', totalCents: 100 } })
    expect(publish).not.toHaveBeenCalled() // no llegó a publicar created
  })
})
