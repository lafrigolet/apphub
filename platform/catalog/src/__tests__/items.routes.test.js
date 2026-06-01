// items.routes — wiring HTTP de catalog. Monta la app real (app.js) con el
// service mockeado y un app-guard stub que inyecta identity. Verifica status,
// delegación al service con el scope correcto, y los headers CSV.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))

vi.mock('../services/items.service.js', () => ({
  listItems:        vi.fn(),
  searchItems:      vi.fn(),
  getItem:          vi.fn(),
  createItem:       vi.fn(),
  updateItem:       vi.fn(),
  deleteItem:       vi.fn(),
  setItemStatus:    vi.fn(),
  listItemVersions: vi.fn(),
  listImages:       vi.fn(),
  attachImage:      vi.fn(),
  detachImage:      vi.fn(),
  exportCsv:        vi.fn(),
  importCsv:        vi.fn(),
}))

// app-guard stub: inyecta identity en cada request (no role-gating aquí).
vi.mock('@apphub/platform-sdk/app-guard', async () => {
  const { default: fp } = await import('fastify-plugin')
  return {
    appGuard: fp(async (fastify) => {
      fastify.decorateRequest('identity', null)
      fastify.addHook('onRequest', async (req) => {
        req.identity = { appId: 'shop', tenantId: 't1', subTenantId: null, userId: 'u1' }
      })
    }),
    requireRole: () => async () => {},
  }
})

import { createApp } from '../app.js'
import * as service from '../services/items.service.js'

const UUID = '11111111-1111-1111-1111-111111111111'
const UUID2 = '22222222-2222-2222-2222-222222222222'

let app
beforeEach(async () => {
  vi.clearAllMocks()
  app = createApp()
  await app.ready()
})
afterEach(async () => { await app.close() })

describe('GET /v1/items', () => {
  it('sin ?q → listItems con scope + activeOnly true', async () => {
    service.listItems.mockResolvedValue([{ id: 'i1' }])
    const res = await app.inject({ method: 'GET', url: '/v1/items' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([{ id: 'i1' }])
    expect(service.listItems).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 'shop', tenantId: 't1', activeOnly: true }),
    )
    expect(service.searchItems).not.toHaveBeenCalled()
  })

  it('?activeOnly=false → activeOnly false', async () => {
    service.listItems.mockResolvedValue([])
    await app.inject({ method: 'GET', url: '/v1/items?activeOnly=false' })
    expect(service.listItems).toHaveBeenCalledWith(expect.objectContaining({ activeOnly: false }))
  })

  it('?q=barro → searchItems con q trim', async () => {
    service.searchItems.mockResolvedValue([{ id: 'i1' }])
    const res = await app.inject({ method: 'GET', url: '/v1/items?q=%20barro%20' })
    expect(res.statusCode).toBe(200)
    expect(service.searchItems).toHaveBeenCalledWith(expect.objectContaining({ q: 'barro' }))
    expect(service.listItems).not.toHaveBeenCalled()
  })
})

describe('GET /v1/items/:id', () => {
  it('delega a getItem', async () => {
    service.getItem.mockResolvedValue({ id: UUID })
    const res = await app.inject({ method: 'GET', url: `/v1/items/${UUID}` })
    expect(res.statusCode).toBe(200)
    expect(service.getItem).toHaveBeenCalledWith(expect.objectContaining({ id: UUID }))
  })
})

describe('POST /v1/items', () => {
  it('201 + createItem con body', async () => {
    service.createItem.mockResolvedValue({ id: UUID, name: 'Jarra' })
    const res = await app.inject({
      method: 'POST', url: '/v1/items',
      payload: { name: 'Jarra', priceCents: 1500 },
    })
    expect(res.statusCode).toBe(201)
    expect(service.createItem).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Jarra', priceCents: 1500, appId: 'shop' }),
    )
  })

  it('body inválido → 422', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/items', payload: { name: '' } })
    expect(res.statusCode).toBe(422)
    expect(service.createItem).not.toHaveBeenCalled()
  })
})

describe('PATCH /v1/items/:id', () => {
  it('delega a updateItem', async () => {
    service.updateItem.mockResolvedValue({ id: UUID, name: 'New' })
    const res = await app.inject({
      method: 'PATCH', url: `/v1/items/${UUID}`, payload: { name: 'New' },
    })
    expect(res.statusCode).toBe(200)
    expect(service.updateItem).toHaveBeenCalledWith(expect.objectContaining({ id: UUID, name: 'New' }))
  })
})

describe('DELETE /v1/items/:id', () => {
  it('204', async () => {
    service.deleteItem.mockResolvedValue()
    const res = await app.inject({ method: 'DELETE', url: `/v1/items/${UUID}` })
    expect(res.statusCode).toBe(204)
    expect(service.deleteItem).toHaveBeenCalledWith(expect.objectContaining({ id: UUID }))
  })
})

describe('PATCH /v1/items/:id/status', () => {
  it('delega a setItemStatus con actorUserId', async () => {
    service.setItemStatus.mockResolvedValue({ id: UUID, status: 'published' })
    const res = await app.inject({
      method: 'PATCH', url: `/v1/items/${UUID}/status`, payload: { status: 'published' },
    })
    expect(res.statusCode).toBe(200)
    expect(service.setItemStatus).toHaveBeenCalledWith(
      expect.objectContaining({ id: UUID, status: 'published', actorUserId: 'u1' }),
    )
  })
})

describe('GET /v1/items/:id/versions', () => {
  it('envuelve en { data }', async () => {
    service.listItemVersions.mockResolvedValue([{ version_number: 2 }])
    const res = await app.inject({ method: 'GET', url: `/v1/items/${UUID}/versions` })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: [{ version_number: 2 }] })
  })
})

describe('GET /v1/items/:id/images', () => {
  it('envuelve en { data }', async () => {
    service.listImages.mockResolvedValue([{ id: 'img1' }])
    const res = await app.inject({ method: 'GET', url: `/v1/items/${UUID}/images` })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: [{ id: 'img1' }] })
  })
})

describe('POST /v1/items/:id/images', () => {
  it('201 + attachImage', async () => {
    service.attachImage.mockResolvedValue({ id: 'img1' })
    const res = await app.inject({
      method: 'POST', url: `/v1/items/${UUID}/images`,
      payload: { objectId: UUID2, altText: 'front', displayOrder: 0 },
    })
    expect(res.statusCode).toBe(201)
    expect(service.attachImage).toHaveBeenCalledWith(
      expect.objectContaining({ id: UUID, objectId: UUID2, altText: 'front' }),
    )
  })
})

describe('DELETE /v1/items/:id/images/:imageId', () => {
  it('204 + detachImage por imageId', async () => {
    service.detachImage.mockResolvedValue()
    const res = await app.inject({ method: 'DELETE', url: `/v1/items/${UUID}/images/${UUID2}` })
    expect(res.statusCode).toBe(204)
    expect(service.detachImage).toHaveBeenCalledWith(expect.objectContaining({ imageId: UUID2 }))
  })
})

describe('GET /v1/items/export.csv', () => {
  it('text/csv + content-disposition; cuerpo es el CSV', async () => {
    service.exportCsv.mockResolvedValue('id,name\n,Jarra\n')
    const res = await app.inject({ method: 'GET', url: '/v1/items/export.csv' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/csv/)
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="catalog-/)
    expect(res.body).toBe('id,name\n,Jarra\n')
    expect(service.exportCsv).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 'shop', tenantId: 't1' }),
    )
  })
})

describe('POST /v1/items/import.csv', () => {
  it('delega a importCsv con el csv del body', async () => {
    service.importCsv.mockResolvedValue({ rowsTotal: 1, inserted: 1, updated: 0, errors: 0 })
    const res = await app.inject({
      method: 'POST', url: '/v1/items/import.csv',
      payload: { csv: 'name,price_cents\nJarra,1500\n' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ rowsTotal: 1, inserted: 1, updated: 0, errors: 0 })
    expect(service.importCsv).toHaveBeenCalledWith(
      expect.objectContaining({ csv: 'name,price_cents\nJarra,1500\n' }),
    )
  })
})
