// lead-notifications — al crear un lead se publica `lead.created` en
// `platform.events` (lo consume notifications para alertar al equipo) (1.8 · P2).
// Contrato:
//   - tras INSERT, publish 'lead.created' con el shape del payload.
//   - publish DESPUÉS de soltar el client (fila ya persistida).
//   - fallo en publish NO propaga (el lead se devuelve igual).
//   - sin redis configurado → no-op (no revienta).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { poolConnectMock, client, insertMock, redisMock } = vi.hoisted(() => {
  const client = { release: vi.fn() }
  return {
    client,
    poolConnectMock: vi.fn(async () => client),
    insertMock: vi.fn(),
    redisMock: { publish: vi.fn().mockResolvedValue(1) },
  }
})

vi.mock('../lib/db.js', () => ({ pool: { connect: poolConnectMock }, configurePool: vi.fn() }))
vi.mock('../lib/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('../repositories/leads.repository.js', () => ({ insert: insertMock }))
vi.mock('../lib/redis.js', () => ({ getRedis: vi.fn(() => redisMock), configureRedis: vi.fn() }))

import { create } from '../services/leads.service.js'
import { logger } from '../lib/logger.js'

const lead = { contactName: 'Ana', email: 'ana@x.com', businessName: 'Tienda Ana', industry: 'shop', source: 'landing/contacto' }

beforeEach(() => {
  vi.clearAllMocks()
  insertMock.mockResolvedValue({ id: 'lead-1', status: 'new' })
  redisMock.publish.mockResolvedValue(1)
})

describe('leads.create — evento lead.created', () => {
  it('publica lead.created en platform.events con el payload esperado', async () => {
    await create(lead)
    expect(redisMock.publish).toHaveBeenCalledTimes(1)
    const [channel, raw] = redisMock.publish.mock.calls[0]
    expect(channel).toBe('platform.events')
    const evt = JSON.parse(raw)
    expect(evt.type).toBe('lead.created')
    expect(evt.payload).toMatchObject({
      leadId: 'lead-1', email: 'ana@x.com', contactName: 'Ana',
      businessName: 'Tienda Ana', industry: 'shop', source: 'landing/contacto',
    })
  })

  it('publica DESPUÉS de soltar el client (release antes del publish)', async () => {
    const order = []
    client.release.mockImplementation(() => order.push('release'))
    redisMock.publish.mockImplementation(async () => { order.push('publish'); return 1 })
    await create(lead)
    expect(order).toEqual(['release', 'publish'])
  })

  it('fallo en publish NO propaga; el lead se devuelve igual', async () => {
    redisMock.publish.mockRejectedValue(new Error('redis down'))
    const out = await create(lead)
    expect(out).toEqual({ id: 'lead-1', status: 'new' })
    expect(logger.error).toHaveBeenCalled()
  })

  it('campos opcionales ausentes → null en el payload', async () => {
    await create({ contactName: 'Bob', email: 'bob@x.com' })
    const evt = JSON.parse(redisMock.publish.mock.calls[0][1])
    expect(evt.payload).toMatchObject({ businessName: null, industry: null, source: null })
  })
})

describe('sin redis configurado', () => {
  it('no intenta publicar (no-op) y devuelve el lead', async () => {
    const redisMod = await import('../lib/redis.js')
    redisMod.getRedis.mockReturnValueOnce(null)
    const out = await create(lead)
    expect(out).toEqual({ id: 'lead-1', status: 'new' })
    expect(redisMock.publish).not.toHaveBeenCalled()
  })
})
