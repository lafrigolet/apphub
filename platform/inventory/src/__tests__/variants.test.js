// inventory.service — variants + handleOrderEvent.
// Cubre lo NO testeado en inventory.service.test.js / stock-reservation.test.js:
//
// listVariants:
//   - parent SKU no existe → NotFoundError.
//   - happy: { parent, variants }.
//
// addVariant:
//   - sku === parentSku → ConflictError "must differ from parent".
//   - sku vacío → ConflictError.
//   - optionValues vacío o ausente → ConflictError.
//   - parent no existe → NotFoundError.
//   - parent es ya una variant (parent.parent_sku set) → ConflictError "flatten".
//   - mismas optionValues YA existen → ConflictError con sku conflictivo.
//   - unique violation (23505) en INSERT → ConflictError.
//
// handleOrderEvent:
//   - 'order.created' con items → reserveItem por cada item.
//   - 'order.cancelled' con items → releaseItem (libera reservas).
//   - 'order.paid' con items → commitItem (decrementa stock real).
//   - Errores en cada item se loguean pero NO abortan el lote.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../lib/db.js', () => ({ pool: {}, withTenantTransaction: vi.fn() }))
vi.mock('../lib/redis.js', () => ({ publish: vi.fn() }))
vi.mock('../repositories/inventory.repository.js')

import {
  listVariants, addVariant, handleOrderEvent,
} from '../services/inventory.service.js'
import { withTenantTransaction } from '../lib/db.js'
import * as repo from '../repositories/inventory.repository.js'

const ctx = { appId: 'shop', tenantId: 't1', subTenantId: null, userId: 'admin-1', role: 'admin' }

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn({}))
})

// ── listVariants ────────────────────────────────────────────────────

describe('listVariants', () => {
  it('parent SKU no existe → NotFoundError', async () => {
    repo.findBySku.mockResolvedValue(null)
    await expect(listVariants(ctx, 'ghost')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('happy: retorna { parent, variants }', async () => {
    repo.findBySku.mockResolvedValue({ sku: 'PARENT', qty_on_hand: 0 })
    repo.listVariants.mockResolvedValue([
      { sku: 'PARENT-S', option_values: { size: 'S' } },
      { sku: 'PARENT-M', option_values: { size: 'M' } },
    ])
    const r = await listVariants(ctx, 'PARENT')
    expect(r.parent.sku).toBe('PARENT')
    expect(r.variants).toHaveLength(2)
  })

  it('parent sin variants → array vacío', async () => {
    repo.findBySku.mockResolvedValue({ sku: 'PARENT' })
    repo.listVariants.mockResolvedValue([])
    const r = await listVariants(ctx, 'PARENT')
    expect(r.variants).toEqual([])
  })
})

// ── addVariant — validaciones ──────────────────────────────────────

describe('addVariant validations', () => {
  it('sku vacío → ConflictError', async () => {
    await expect(addVariant(ctx, 'PARENT', { optionValues: { size: 'M' } }))
      .rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('must differ') })
  })

  it('sku === parentSku → ConflictError "must differ"', async () => {
    await expect(addVariant(ctx, 'PARENT', { sku: 'PARENT', optionValues: { size: 'M' } }))
      .rejects.toMatchObject({ statusCode: 409 })
  })

  it('optionValues vacío → ConflictError "requires at least one"', async () => {
    await expect(addVariant(ctx, 'PARENT', { sku: 'PARENT-M', optionValues: {} }))
      .rejects.toMatchObject({
        statusCode: 409, message: expect.stringContaining('at least one option'),
      })
  })

  it('optionValues ausente → ConflictError', async () => {
    await expect(addVariant(ctx, 'PARENT', { sku: 'PARENT-M' }))
      .rejects.toMatchObject({ statusCode: 409 })
  })
})

describe('addVariant — parent guard', () => {
  it('parent no existe → NotFoundError', async () => {
    repo.findBySku.mockResolvedValue(null)
    await expect(addVariant(ctx, 'GHOST', { sku: 'GHOST-S', optionValues: { size: 'S' } }))
      .rejects.toMatchObject({ statusCode: 404 })
  })

  it('parent es ya una variant (parent_sku set) → ConflictError "flatten the hierarchy"', async () => {
    repo.findBySku.mockResolvedValue({ sku: 'CHILD', parent_sku: 'GRANDPARENT' })
    await expect(addVariant(ctx, 'CHILD', { sku: 'CHILD-S', optionValues: { size: 'S' } }))
      .rejects.toMatchObject({
        statusCode: 409, message: expect.stringContaining('flatten'),
      })
  })

  it('mismas optionValues YA existen → ConflictError con sku conflictivo', async () => {
    repo.findBySku.mockResolvedValue({ sku: 'PARENT', parent_sku: null })
    repo.findByParentAndOptions.mockResolvedValue({ sku: 'PARENT-M-RED' })
    await expect(addVariant(ctx, 'PARENT', { sku: 'PARENT-M-RED-2', optionValues: { size: 'M', color: 'red' } }))
      .rejects.toMatchObject({
        statusCode: 409, message: expect.stringContaining('PARENT-M-RED'),
      })
  })

  it('unique violation 23505 en INSERT → ConflictError "collides"', async () => {
    repo.findBySku.mockResolvedValue({ sku: 'PARENT', parent_sku: null })
    repo.findByParentAndOptions.mockResolvedValue(null)
    const err = new Error('duplicate'); err.code = '23505'
    repo.upsert.mockRejectedValueOnce(err)
    await expect(addVariant(ctx, 'PARENT', { sku: 'P-M', optionValues: { size: 'M' } }))
      .rejects.toMatchObject({
        statusCode: 409, message: expect.stringContaining('collides'),
      })
  })

  it('happy: persiste variant con parentSku + optionValues', async () => {
    repo.findBySku.mockResolvedValue({ sku: 'PARENT', parent_sku: null })
    repo.findByParentAndOptions.mockResolvedValue(null)
    repo.upsert.mockResolvedValue({ sku: 'P-M', parent_sku: 'PARENT' })
    await addVariant(ctx, 'PARENT', {
      sku: 'P-M', optionValues: { size: 'M' }, qtyOnHand: 50, displayName: 'M',
    })
    expect(repo.upsert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      sku: 'P-M', parentSku: 'PARENT',
      optionValues: { size: 'M' }, qtyOnHand: 50, displayName: 'M',
    }))
  })

  it('qtyOnHand default = 0 (variants se crean vacíos por defecto)', async () => {
    repo.findBySku.mockResolvedValue({ sku: 'PARENT', parent_sku: null })
    repo.findByParentAndOptions.mockResolvedValue(null)
    repo.upsert.mockResolvedValue({})
    await addVariant(ctx, 'PARENT', { sku: 'P-M', optionValues: { size: 'M' } })
    expect(repo.upsert.mock.calls[0][1].qtyOnHand).toBe(0)
  })
})

// ── handleOrderEvent ────────────────────────────────────────────────

describe('handleOrderEvent', () => {
  it('order.created con items → reserve por cada item', async () => {
    repo.reserve.mockResolvedValue({ qty_on_hand: 10, qty_reserved: 1 })
    await handleOrderEvent({
      type: 'order.created',
      payload: {
        appId: 'shop', tenantId: 't1', orderId: 'o1',
        items: [{ sku: 'A', qty: 1 }, { sku: 'B', qty: 2 }],
      },
    })
    expect(repo.reserve).toHaveBeenCalledTimes(2)
  })

  it('order.cancelled con items → release', async () => {
    repo.release.mockResolvedValue({ qty_on_hand: 10, qty_reserved: 0 })
    await handleOrderEvent({
      type: 'order.cancelled',
      payload: {
        appId: 'shop', tenantId: 't1', orderId: 'o1',
        items: [{ sku: 'A', qty: 1 }],
      },
    })
    expect(repo.release).toHaveBeenCalled()
  })

  it('order.paid con items → commit (decrementa qty_on_hand real)', async () => {
    repo.commit.mockResolvedValue({ qty_on_hand: 9, low_stock_threshold: 0 })
    await handleOrderEvent({
      type: 'order.paid',
      payload: {
        appId: 'shop', tenantId: 't1', orderId: 'o1',
        items: [{ sku: 'A', qty: 1 }],
      },
    })
    expect(repo.commit).toHaveBeenCalled()
  })

  it('eventos desconocidos → no-op', async () => {
    await handleOrderEvent({ type: 'random.event', payload: { items: [{ sku: 'A', qty: 1 }] } })
    expect(repo.reserve).not.toHaveBeenCalled()
    expect(repo.release).not.toHaveBeenCalled()
    expect(repo.commit).not.toHaveBeenCalled()
  })

  it('error en UN item NO aborta los demás (best-effort)', async () => {
    repo.reserve
      .mockRejectedValueOnce(new Error('insufficient stock'))
      .mockResolvedValueOnce({ qty_on_hand: 9 })
    await expect(handleOrderEvent({
      type: 'order.created',
      payload: {
        appId: 'shop', tenantId: 't1', orderId: 'o1',
        items: [{ sku: 'A', qty: 1 }, { sku: 'B', qty: 1 }],
      },
    })).resolves.toBeUndefined()
    expect(repo.reserve).toHaveBeenCalledTimes(2)         // ambos intentados
  })
})
