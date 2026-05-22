// items.service.images — listImages, attachImage, detachImage.
// Foco en lo NO cubierto por catalog.service.test.js (que prueba items + CSV).
//
// Contrato:
//   listImages: delega al repo (sin guard — público).
//   attachImage:
//     - item no existe → NotFoundError "Item".
//     - happy: persiste imagen con itemId + objectId + altText + displayOrder.
//   detachImage:
//     - image no existe → NotFoundError "Image".

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../lib/db.js', () => ({ pool: {}, withTenantTransaction: vi.fn() }))
vi.mock('../repositories/items.repository.js')

import {
  listImages, attachImage, detachImage, listItemVersions,
} from '../services/items.service.js'
import { withTenantTransaction } from '../lib/db.js'
import * as repo from '../repositories/items.repository.js'

const ctx = {
  appId: 'shop', tenantId: '22222222-2222-2222-2222-222222222222', subTenantId: null,
  id: 'item-1',
}

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn({}))
})

// ── listImages ──────────────────────────────────────────────────────

describe('listImages', () => {
  it('delega al repo con item id', async () => {
    repo.listImages.mockResolvedValue([{ id: 'img-1' }, { id: 'img-2' }])
    const r = await listImages(ctx)
    expect(repo.listImages).toHaveBeenCalledWith(expect.anything(), ctx.id)
    expect(r).toHaveLength(2)
  })

  it('empty → array vacío (no crash)', async () => {
    repo.listImages.mockResolvedValue([])
    const r = await listImages(ctx)
    expect(r).toEqual([])
  })
})

// ── attachImage ─────────────────────────────────────────────────────

describe('attachImage', () => {
  it('item no existe → NotFoundError "Item"', async () => {
    repo.findById.mockResolvedValue(null)
    await expect(attachImage({ ...ctx, objectId: 'obj-1' }))
      .rejects.toMatchObject({ statusCode: 404, message: expect.stringContaining('Item') })
    expect(repo.insertImage).not.toHaveBeenCalled()
  })

  it('happy: persiste con itemId + objectId + altText + displayOrder', async () => {
    repo.findById.mockResolvedValue({ id: ctx.id })
    repo.insertImage.mockResolvedValue({ id: 'img-1' })
    await attachImage({ ...ctx, objectId: 'obj-1', altText: 'Front view', displayOrder: 0 })
    expect(repo.insertImage).toHaveBeenCalledWith(expect.anything(), {
      itemId: ctx.id, objectId: 'obj-1', altText: 'Front view', displayOrder: 0,
    })
  })

  it('altText / displayOrder opcionales propagan undefined', async () => {
    repo.findById.mockResolvedValue({ id: ctx.id })
    repo.insertImage.mockResolvedValue({ id: 'img-1' })
    await attachImage({ ...ctx, objectId: 'obj-1' })
    const args = repo.insertImage.mock.calls[0][1]
    expect(args.altText).toBeUndefined()
    expect(args.displayOrder).toBeUndefined()
  })
})

// ── detachImage ─────────────────────────────────────────────────────

describe('detachImage', () => {
  it('image no existe → NotFoundError "Image"', async () => {
    repo.deleteImage.mockResolvedValue(false)
    await expect(detachImage({ ...ctx, imageId: 'ghost' }))
      .rejects.toMatchObject({
        statusCode: 404, message: expect.stringContaining('Image'),
      })
  })

  it('happy: delega al repo', async () => {
    repo.deleteImage.mockResolvedValue(true)
    await expect(detachImage({ ...ctx, imageId: 'img-1' })).resolves.toBeUndefined()
    expect(repo.deleteImage).toHaveBeenCalledWith(expect.anything(), 'img-1')
  })
})

// ── listItemVersions ────────────────────────────────────────────────

describe('listItemVersions', () => {
  it('delega al repo', async () => {
    repo.listVersions.mockResolvedValue([
      { version_number: 3, published_at: '2026-05-01T00:00:00Z' },
      { version_number: 2, published_at: '2026-04-01T00:00:00Z' },
      { version_number: 1, published_at: '2026-03-01T00:00:00Z' },
    ])
    const r = await listItemVersions(ctx)
    expect(r).toHaveLength(3)
    expect(repo.listVersions).toHaveBeenCalledWith(expect.anything(), ctx.id)
  })

  it('item sin versiones publicadas → array vacío', async () => {
    repo.listVersions.mockResolvedValue([])
    const r = await listItemVersions(ctx)
    expect(r).toEqual([])
  })
})
