import { describe, it, expect, vi, beforeEach } from 'vitest'

const { stubClient } = vi.hoisted(() => ({
  stubClient: { query: vi.fn(), release: vi.fn() },
}))

vi.mock('../lib/db.js', () => ({
  pool: { connect: vi.fn().mockResolvedValue(stubClient) },
}))
vi.mock('../repositories/analytics.repository.js', () => ({
  funnel:      vi.fn(),
  byDimension: vi.fn(),
  byOwner:     vi.fn(),
  timeseries:  vi.fn(),
}))
vi.mock('../repositories/leads.repository.js', () => ({ list: vi.fn() }))

import * as service from '../services/analytics.service.js'
import * as analyticsRepo from '../repositories/analytics.repository.js'
import * as leadsRepo from '../repositories/leads.repository.js'

beforeEach(() => { vi.clearAllMocks() })

describe('delegación + liberación del client', () => {
  it('funnel delega y libera', async () => {
    analyticsRepo.funnel.mockResolvedValue({ statusCounts: [], milestones: [] })
    const r = await service.funnel({ createdFrom: 'x' })
    expect(analyticsRepo.funnel).toHaveBeenCalledWith(stubClient, { createdFrom: 'x' })
    expect(stubClient.release).toHaveBeenCalled()
    expect(r).toEqual({ statusCounts: [], milestones: [] })
  })

  it('byDimension pasa la dimensión y el rango', async () => {
    analyticsRepo.byDimension.mockResolvedValue([{ dimension: 'landing' }])
    await service.byDimension('source', { createdTo: 'y' })
    expect(analyticsRepo.byDimension).toHaveBeenCalledWith(stubClient, 'source', { createdTo: 'y' })
  })

  it('byOwner delega', async () => {
    analyticsRepo.byOwner.mockResolvedValue([])
    await service.byOwner({})
    expect(analyticsRepo.byOwner).toHaveBeenCalledWith(stubClient, {})
  })

  it('timeseries pasa la granularidad', async () => {
    analyticsRepo.timeseries.mockResolvedValue([])
    await service.timeseries('week', {})
    expect(analyticsRepo.timeseries).toHaveBeenCalledWith(stubClient, 'week', {})
  })

  it('libera el client aunque el repo lance', async () => {
    analyticsRepo.funnel.mockRejectedValueOnce(new Error('boom'))
    await expect(service.funnel({})).rejects.toThrow('boom')
    expect(stubClient.release).toHaveBeenCalled()
  })
})

describe('toCsv', () => {
  it('cabecera + filas, escapa comas/comillas/saltos y une arrays', () => {
    const csv = service.toCsv([
      { id: 'l1', email: 'a@b.com', business_name: 'Ana, S.L.', tags: ['vip', 'urgente'], message: 'di "hola"' },
    ], ['id', 'email', 'business_name', 'tags', 'message'])
    const [header, row] = csv.split('\n')
    expect(header).toBe('id,email,business_name,tags,message')
    expect(row).toBe('l1,a@b.com,"Ana, S.L.",vip; urgente,"di ""hola"""')
  })

  it('null/undefined → celda vacía', () => {
    const csv = service.toCsv([{ id: 'l1', email: null }], ['id', 'email'])
    expect(csv.split('\n')[1]).toBe('l1,')
  })
})

describe('exportCsv', () => {
  it('reutiliza leadsRepo.list con los filtros y un tope alto, y serializa', async () => {
    leadsRepo.list.mockResolvedValue([{ id: 'l1', email: 'a@b.com', tags: [] }])
    const csv = await service.exportCsv({ status: 'won' })
    expect(leadsRepo.list).toHaveBeenCalledWith(stubClient, expect.objectContaining({ status: 'won', limit: 5000 }))
    expect(csv.split('\n')[0]).toContain('id,created_at')
    expect(csv).toContain('l1')
    expect(stubClient.release).toHaveBeenCalled()
  })
})
