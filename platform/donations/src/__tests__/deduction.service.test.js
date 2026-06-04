import { describe, it, expect, vi, beforeEach } from 'vitest'

const stubClient = { query: vi.fn() }

vi.mock('../lib/db.js', () => ({
  withTenantTransaction: vi.fn(async (_a, _t, _s, fn) => fn(stubClient)),
}))
vi.mock('../repositories/donations.repository.js', () => ({
  totalForNifAndYear:      vi.fn(),
  listDonationYearsForNif: vi.fn(),
}))

import { estimateDeduction } from '../services/deduction.service.js'
import * as repo from '../repositories/donations.repository.js'

const admin = { userId: 'a1', role: 'admin', appId: 'aikikan', tenantId: 't1' }
const user  = { userId: 'u1', role: 'user',  appId: 'aikikan', tenantId: 't1' }

beforeEach(() => vi.clearAllMocks())

describe('estimateDeduction — guards', () => {
  it('rechaza no-admin', async () => {
    await expect(estimateDeduction(user, { year: 2025, donorNif: '12345678Z' }))
      .rejects.toMatchObject({ statusCode: 403 })
  })
  it('rechaza year no entero', async () => {
    await expect(estimateDeduction(admin, { year: '2025', donorNif: '12345678Z' }))
      .rejects.toThrow()
  })
  it('rechaza NIF ausente', async () => {
    await expect(estimateDeduction(admin, { year: 2025, donorNif: '' }))
      .rejects.toThrow()
  })
  it('rechaza NIF inválido', async () => {
    await expect(estimateDeduction(admin, { year: 2025, donorNif: 'BADNIF' }))
      .rejects.toThrow()
  })
})

describe('estimateDeduction — cálculo', () => {
  it('normaliza el NIF y aplica fidelización si ≥ 3 años consecutivos', async () => {
    repo.totalForNifAndYear.mockResolvedValue(50000) // 500 €
    repo.listDonationYearsForNif.mockResolvedValue([2023, 2024, 2025])

    const r = await estimateDeduction(admin, { year: 2025, donorNif: '12.345.678-z' })

    expect(repo.totalForNifAndYear).toHaveBeenCalledWith(stubClient, '12345678Z', 2025)
    expect(r.donorNif).toBe('12345678Z')
    expect(r.consecutiveYears).toBe(3)
    expect(r.loyal).toBe(true)
    expect(r.excessRate).toBe(0.40)
    expect(r.deductibleCents).toBe(30000)
  })

  it('sin fidelización → 35 % sobre el exceso', async () => {
    repo.totalForNifAndYear.mockResolvedValue(50000)
    repo.listDonationYearsForNif.mockResolvedValue([2025])

    const r = await estimateDeduction(admin, { year: 2025, donorNif: '12345678Z' })
    expect(r.loyal).toBe(false)
    expect(r.deductibleCents).toBe(28750)
  })
})
