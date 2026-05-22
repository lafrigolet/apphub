// menu.service — eightySixItem / unEightySixItem (86-list de F&B).
// Contrato:
//   - eightySixItem marca item out_of_stock (setEightySixed=true) y emite
//     'menu.item.eighty_sixed' con sku para que KDS/portales actualicen.
//   - unEightySixItem revierte + emite 'menu.item.restored'.
//   - itemId desconocido → NotFoundError 404, sin publicar evento.
//   - publishMenu emite 'menu.published' tras leer el árbol completo.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../lib/db.js', () => ({ pool: {}, withTenantTransaction: vi.fn() }))
vi.mock('../lib/redis.js', () => ({ publish: vi.fn() }))
vi.mock('../repositories/menu.repository.js')

import {
  eightySixItem, unEightySixItem, publishMenu, updateItem,
} from '../services/menu.service.js'
import { withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as repo from '../repositories/menu.repository.js'

const ctx = {
  appId: 'demo-restaurant',
  tenantId: '22222222-2222-2222-2222-222222222222',
  subTenantId: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn({}))
})

// ── 86 ──────────────────────────────────────────────────────────────

describe('eightySixItem', () => {
  it('happy: flag a true + publish menu.item.eighty_sixed con sku', async () => {
    repo.setEightySixed.mockResolvedValue({ id: 'i1', sku: 'BURGER-CLASSIC', is_eighty_sixed: true })
    const r = await eightySixItem(ctx, 'i1')
    expect(repo.setEightySixed).toHaveBeenCalledWith(
      expect.anything(), ctx.appId, ctx.tenantId, 'i1', true,
    )
    expect(publish).toHaveBeenCalledWith({
      type: 'menu.item.eighty_sixed',
      payload: { appId: ctx.appId, tenantId: ctx.tenantId, itemId: 'i1', sku: 'BURGER-CLASSIC' },
    })
    expect(r.is_eighty_sixed).toBe(true)
  })

  it('item desconocido → NotFoundError 404, no publica', async () => {
    repo.setEightySixed.mockResolvedValue(null)
    await expect(eightySixItem(ctx, 'ghost')).rejects.toMatchObject({ statusCode: 404 })
    expect(publish).not.toHaveBeenCalled()
  })
})

describe('unEightySixItem', () => {
  it('happy: flag a false + publish menu.item.restored', async () => {
    repo.setEightySixed.mockResolvedValue({ id: 'i1', sku: 'BURGER-CLASSIC', is_eighty_sixed: false })
    await unEightySixItem(ctx, 'i1')
    expect(repo.setEightySixed).toHaveBeenCalledWith(
      expect.anything(), ctx.appId, ctx.tenantId, 'i1', false,
    )
    expect(publish).toHaveBeenCalledWith({
      type: 'menu.item.restored',
      payload: { appId: ctx.appId, tenantId: ctx.tenantId, itemId: 'i1', sku: 'BURGER-CLASSIC' },
    })
  })

  it('item desconocido → 404, no publica', async () => {
    repo.setEightySixed.mockResolvedValue(null)
    await expect(unEightySixItem(ctx, 'ghost')).rejects.toMatchObject({ statusCode: 404 })
    expect(publish).not.toHaveBeenCalled()
  })
})

// ── updateItem 404 ──────────────────────────────────────────────────

describe('updateItem', () => {
  it('item desconocido → NotFoundError', async () => {
    repo.updateItem.mockResolvedValue(null)
    await expect(updateItem(ctx, 'ghost', { name: 'x' })).rejects.toMatchObject({ statusCode: 404 })
  })

  it('happy: devuelve row actualizado', async () => {
    repo.updateItem.mockResolvedValue({ id: 'i1', name: 'New' })
    const r = await updateItem(ctx, 'i1', { name: 'New' })
    expect(r.name).toBe('New')
  })
})

// ── publishMenu ─────────────────────────────────────────────────────

describe('publishMenu', () => {
  it('lee árbol completo + publica menu.published con name', async () => {
    repo.findMenuById.mockResolvedValue({ id: 'm1', name: 'Carta primavera' })
    repo.listCategoriesByMenu.mockResolvedValue([{ id: 'c1', name: 'Entrantes' }])
    repo.listItemsByCategory.mockResolvedValue([{ id: 'i1' }])
    await publishMenu(ctx, 'm1')
    expect(publish).toHaveBeenCalledWith({
      type: 'menu.published',
      payload: { appId: ctx.appId, tenantId: ctx.tenantId, menuId: 'm1', name: 'Carta primavera' },
    })
  })

  it('menú desconocido → NotFoundError sin publicar', async () => {
    repo.findMenuById.mockResolvedValue(null)
    await expect(publishMenu(ctx, 'ghost')).rejects.toMatchObject({ statusCode: 404 })
    expect(publish).not.toHaveBeenCalled()
  })
})
