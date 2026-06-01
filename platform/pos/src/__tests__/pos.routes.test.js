// pos.routes — delega en el service inyectando ctx desde req.identity,
// devuelve 201 al crear, valida bodies con zod (.parse inline).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../services/pos.service.js', () => ({
  openBill:  vi.fn(),
  listBills: vi.fn(),
  getBill:   vi.fn(),
  addItem:   vi.fn(),
  splitBill: vi.fn(),
  payBill:   vi.fn(),
  closeBill: vi.fn(),
}))

import { posRoutes } from '../routes/pos.routes.js'
import * as service from '../services/pos.service.js'

const BILL_ID = '11111111-1111-1111-1111-111111111111'
const SPLIT_ID = '22222222-2222-2222-2222-222222222222'

const identity = { appId: 'resto', tenantId: 't1', subTenantId: null, userId: 'u1', role: 'server' }

async function buildApp() {
  const app = Fastify({ logger: false })
  app.decorateRequest('identity', null)
  app.addHook('onRequest', async (req) => { req.identity = { ...identity } })
  await app.register(posRoutes)
  app.setErrorHandler((err, req, reply) => {
    if (err.statusCode) return reply.status(err.statusCode).send({ error: { code: err.code } })
    if (err.name === 'ZodError' || err.issues) return reply.status(400).send({ error: { code: 'VALIDATION' } })
    return reply.status(500).send({ error: { code: 'INTERNAL', message: err.message } })
  })
  await app.ready()
  return app
}

let app
beforeEach(async () => { vi.clearAllMocks(); app = await buildApp() })
afterEach(async () => { await app.close() })

describe('POST /v1/pos/bills', () => {
  it('201 + delega openBill con ctx de identity', async () => {
    service.openBill.mockResolvedValue({ id: BILL_ID })
    const res = await app.inject({ method: 'POST', url: '/v1/pos/bills', payload: { tableCode: 'T1' } })
    expect(res.statusCode).toBe(201)
    expect(service.openBill).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 'resto', tenantId: 't1', userId: 'u1' }),
      expect.objectContaining({ tableCode: 'T1' }),
    )
  })

  it('body inválido → 400/500', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/pos/bills', payload: { currency: 'TOOLONG' } })
    expect([400, 500]).toContain(res.statusCode)
    expect(service.openBill).not.toHaveBeenCalled()
  })
})

describe('GET /v1/pos/bills', () => {
  it('pasa filtros del query (limit numérico)', async () => {
    service.listBills.mockResolvedValue([])
    await app.inject({ method: 'GET', url: '/v1/pos/bills?status=open&tableId=tab1&limit=5' })
    expect(service.listBills).toHaveBeenCalledWith(expect.anything(), { status: 'open', tableId: 'tab1', limit: 5 })
  })

  it('sin limit → undefined', async () => {
    service.listBills.mockResolvedValue([])
    await app.inject({ method: 'GET', url: '/v1/pos/bills' })
    expect(service.listBills).toHaveBeenCalledWith(expect.anything(), { status: undefined, tableId: undefined, limit: undefined })
  })
})

describe('GET /v1/pos/bills/:id', () => {
  it('delega getBill', async () => {
    service.getBill.mockResolvedValue({ id: BILL_ID })
    const res = await app.inject({ method: 'GET', url: `/v1/pos/bills/${BILL_ID}` })
    expect(res.statusCode).toBe(200)
    expect(service.getBill).toHaveBeenCalledWith(expect.anything(), BILL_ID)
  })
})

describe('POST /v1/pos/bills/:id/items', () => {
  it('201 + delega addItem', async () => {
    service.addItem.mockResolvedValue({ id: BILL_ID })
    const res = await app.inject({
      method: 'POST', url: `/v1/pos/bills/${BILL_ID}/items`,
      payload: { sku: 'SKU', name: 'Burger', qty: 2, unitPriceCents: 900 },
    })
    expect(res.statusCode).toBe(201)
    expect(service.addItem).toHaveBeenCalledWith(expect.anything(), BILL_ID, expect.objectContaining({ sku: 'SKU' }))
  })
})

describe('POST /v1/pos/bills/:id/split', () => {
  it('separa mode del resto de args y delega splitBill', async () => {
    service.splitBill.mockResolvedValue([])
    const res = await app.inject({
      method: 'POST', url: `/v1/pos/bills/${BILL_ID}/split`,
      payload: { mode: 'equal', shares: 3 },
    })
    expect(res.statusCode).toBe(200)
    expect(service.splitBill).toHaveBeenCalledWith(expect.anything(), BILL_ID, 'equal', { shares: 3 })
  })
})

describe('POST /v1/pos/bills/:id/pay', () => {
  it('delega payBill con el body completo', async () => {
    service.payBill.mockResolvedValue({ id: BILL_ID, status: 'paid' })
    const res = await app.inject({
      method: 'POST', url: `/v1/pos/bills/${BILL_ID}/pay`,
      payload: { method: 'card', amountCents: 1000, splitId: SPLIT_ID },
    })
    expect(res.statusCode).toBe(200)
    expect(service.payBill).toHaveBeenCalledWith(expect.anything(), BILL_ID, expect.objectContaining({ method: 'card', amountCents: 1000 }))
  })
})

describe('POST /v1/pos/bills/:id/close', () => {
  it('delega closeBill', async () => {
    service.closeBill.mockResolvedValue({ id: BILL_ID, status: 'closed' })
    const res = await app.inject({ method: 'POST', url: `/v1/pos/bills/${BILL_ID}/close` })
    expect(res.statusCode).toBe(200)
    expect(service.closeBill).toHaveBeenCalledWith(expect.anything(), BILL_ID)
  })
})
