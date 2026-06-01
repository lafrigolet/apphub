// services.service — galería de imágenes + happy paths de pricing tiers que
// los otros tests no cubren (listImages/attachImage/detachImage,
// listPricingTiers happy, removePricingTier happy).
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../lib/db.js', () => ({ pool: {}, withTenantTransaction: vi.fn() }))
vi.mock('../lib/redis.js', () => ({ publish: vi.fn() }))
vi.mock('../repositories/services.repository.js')

import {
  listImages, attachImage, detachImage, listPricingTiers, removePricingTier,
} from '../services/services.service.js'
import { withTenantTransaction } from '../lib/db.js'
import * as repo from '../repositories/services.repository.js'

const ctx = { appId: 'wellness', tenantId: 't1', subTenantId: null }
const SVC = 'svc-1'

function mockClient() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(mockClient()))
})

describe('listImages', () => {
  it('service no existe → NotFoundError', async () => {
    repo.findById.mockResolvedValue(null)
    await expect(listImages(ctx, 'ghost')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('happy → delega al repo', async () => {
    repo.findById.mockResolvedValue({ id: SVC })
    repo.listImages.mockResolvedValue([{ id: 'img1' }])
    const r = await listImages(ctx, SVC)
    expect(r).toEqual([{ id: 'img1' }])
    expect(repo.listImages).toHaveBeenCalledWith(expect.anything(), 'wellness', 't1', SVC)
  })
})

describe('attachImage', () => {
  it('service no existe → NotFoundError', async () => {
    repo.findById.mockResolvedValue(null)
    await expect(attachImage(ctx, 'ghost', { objectId: 'o1' })).rejects.toMatchObject({ statusCode: 404 })
  })

  it('happy → inserta imagen', async () => {
    repo.findById.mockResolvedValue({ id: SVC })
    repo.insertImage.mockResolvedValue({ id: 'img1' })
    const r = await attachImage(ctx, SVC, { objectId: 'o1', altText: 'a' })
    expect(r).toEqual({ id: 'img1' })
    expect(repo.insertImage).toHaveBeenCalledWith(expect.anything(), 'wellness', 't1', SVC, { objectId: 'o1', altText: 'a' })
  })
})

describe('detachImage', () => {
  it('no existe → NotFoundError "image"', async () => {
    repo.deleteImage.mockResolvedValue(false)
    await expect(detachImage(ctx, 'img-ghost')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('happy → resuelve void', async () => {
    repo.deleteImage.mockResolvedValue(true)
    await expect(detachImage(ctx, 'img1')).resolves.toBeUndefined()
  })
})

describe('listPricingTiers happy', () => {
  it('service existe → devuelve tiers', async () => {
    repo.findById.mockResolvedValue({ id: SVC })
    repo.listPricingTiers.mockResolvedValue([{ id: 'pt1' }])
    const r = await listPricingTiers(ctx, SVC)
    expect(r).toEqual([{ id: 'pt1' }])
  })
})

describe('removePricingTier happy', () => {
  it('borra → resuelve void', async () => {
    repo.deletePricingTier.mockResolvedValue(true)
    await expect(removePricingTier(ctx, 'pt1')).resolves.toBeUndefined()
  })
})
