import { describe, it, expect, vi, beforeEach } from 'vitest'

const stubClient = { query: vi.fn() }

vi.mock('../lib/db.js', () => ({
  withTenantTransaction: vi.fn(async (_a, _t, _s, fn) => fn(stubClient)),
}))

vi.mock('../repositories/tenant-settings.repository.js', () => ({
  find:   vi.fn(),
  upsert: vi.fn(),
}))

import * as service from '../services/tenant-settings.service.js'
import * as repo    from '../repositories/tenant-settings.repository.js'

beforeEach(() => { vi.clearAllMocks(); stubClient.query.mockReset() })

const APP    = 'aikikan'
const TENANT = '30000000-0000-0000-0000-000000000001'
const admin  = { userId: 'a1', role: 'admin', appId: APP, tenantId: TENANT }
const donor  = { userId: 'u1', role: 'user',  appId: APP, tenantId: TENANT }

describe('normalizeSuggestedAmounts', () => {
  it('ordena ascendente y deduplica', () => {
    expect(service.normalizeSuggestedAmounts([2500, 1000, 2500, 5000])).toEqual([1000, 2500, 5000])
  })
  it('null → []', () => {
    expect(service.normalizeSuggestedAmounts(null)).toEqual([])
  })
  it('rechaza no-array', () => {
    expect(() => service.normalizeSuggestedAmounts(1000)).toThrow()
  })
  it('rechaza importe < 100 céntimos', () => {
    expect(() => service.normalizeSuggestedAmounts([50])).toThrow()
  })
  it('rechaza no-entero', () => {
    expect(() => service.normalizeSuggestedAmounts([100.5])).toThrow()
  })
  it('rechaza > 12 importes', () => {
    expect(() => service.normalizeSuggestedAmounts(Array.from({ length: 13 }, (_, i) => 100 + i))).toThrow()
  })
})

describe('getSettings', () => {
  it('rechaza al donante (403)', async () => {
    await expect(service.getSettings(donor)).rejects.toMatchObject({ statusCode: 403 })
  })
  it('sin fila → default vacío', async () => {
    repo.find.mockResolvedValue(null)
    const r = await service.getSettings(admin)
    expect(r.default_suggested_amounts_cents).toEqual([])
  })
  it('con fila → devuelve la fila', async () => {
    repo.find.mockResolvedValue({ default_suggested_amounts_cents: [1000, 2000] })
    const r = await service.getSettings(admin)
    expect(r.default_suggested_amounts_cents).toEqual([1000, 2000])
  })
})

describe('updateSettings', () => {
  it('normaliza antes de persistir', async () => {
    repo.upsert.mockResolvedValue({ default_suggested_amounts_cents: [1000, 2500] })
    await service.updateSettings(admin, { defaultSuggestedAmountsCents: [2500, 1000, 2500] })
    expect(repo.upsert).toHaveBeenCalledWith(stubClient, expect.objectContaining({
      appId: APP, tenantId: TENANT, defaultSuggestedAmountsCents: [1000, 2500],
    }))
  })
  it('rechaza al donante', async () => {
    await expect(service.updateSettings(donor, { defaultSuggestedAmountsCents: [1000] }))
      .rejects.toMatchObject({ statusCode: 403 })
  })
})

describe('getPublicSuggestedAmounts — precedencia override de causa → default tenant', () => {
  it('requiere appId y tenantId', async () => {
    await expect(service.getPublicSuggestedAmounts({})).rejects.toMatchObject({ statusCode: 422 })
  })
  it('usa el override de la causa si existe y no está vacío', async () => {
    stubClient.query.mockResolvedValueOnce({ rows: [{ suggested_amounts_cents: [3000, 6000] }] })
    const r = await service.getPublicSuggestedAmounts({ appId: APP, tenantId: TENANT, causeId: 'c1' })
    expect(r).toEqual([3000, 6000])
    expect(repo.find).not.toHaveBeenCalled()
  })
  it('cae al default del tenant si la causa no tiene override', async () => {
    stubClient.query.mockResolvedValueOnce({ rows: [{ suggested_amounts_cents: [] }] })
    repo.find.mockResolvedValue({ default_suggested_amounts_cents: [1000, 2000] })
    const r = await service.getPublicSuggestedAmounts({ appId: APP, tenantId: TENANT, causeId: 'c1' })
    expect(r).toEqual([1000, 2000])
  })
  it('sin causeId → default del tenant directamente', async () => {
    repo.find.mockResolvedValue({ default_suggested_amounts_cents: [1500] })
    const r = await service.getPublicSuggestedAmounts({ appId: APP, tenantId: TENANT })
    expect(r).toEqual([1500])
    expect(stubClient.query).not.toHaveBeenCalled()
  })
  it('sin config → []', async () => {
    repo.find.mockResolvedValue(null)
    const r = await service.getPublicSuggestedAmounts({ appId: APP, tenantId: TENANT })
    expect(r).toEqual([])
  })
})
