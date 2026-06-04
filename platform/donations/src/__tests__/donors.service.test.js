import { describe, it, expect, vi, beforeEach } from 'vitest'

const stubClient = { query: vi.fn() }

vi.mock('../lib/db.js', () => ({
  withTenantTransaction: vi.fn(async (_a, _t, _s, fn) => fn(stubClient)),
}))

vi.mock('../repositories/donors.repository.js', () => ({
  listUniqueDonors: vi.fn(),
  getDonorByKey:    vi.fn(),
}))

import * as service from '../services/donors.service.js'
import * as repo    from '../repositories/donors.repository.js'

beforeEach(() => vi.clearAllMocks())

const APP    = 'aikikan'
const TENANT = '30000000-0000-0000-0000-000000000001'
const admin  = { userId: 'a1', role: 'admin', appId: APP, tenantId: TENANT }
const donor  = { userId: 'u1', role: 'user',  appId: APP, tenantId: TENANT }

describe('listDonors', () => {
  it('rechaza al donante (403)', async () => {
    await expect(service.listDonors(donor, {})).rejects.toMatchObject({ statusCode: 403 })
  })
  it('admin: delega en el repo con filtros', async () => {
    repo.listUniqueDonors.mockResolvedValue([{ donor_key: 'x@x', total_cents: 100 }])
    const r = await service.listDonors(admin, { search: 'x', limit: 10 })
    expect(repo.listUniqueDonors).toHaveBeenCalledWith(stubClient, { search: 'x', limit: 10 })
    expect(r).toHaveLength(1)
  })
})

describe('getDonor', () => {
  it('404 si no existe', async () => {
    repo.getDonorByKey.mockResolvedValue(null)
    await expect(service.getDonor(admin, 'ghost')).rejects.toMatchObject({ statusCode: 404 })
  })
  it('devuelve la ficha cuando existe', async () => {
    repo.getDonorByKey.mockResolvedValue({ donor_key: 'a@b', donations: [] })
    const r = await service.getDonor(admin, 'a@b')
    expect(r.donor_key).toBe('a@b')
  })
})

describe('exportDonorsCsv', () => {
  it('rechaza al donante', async () => {
    await expect(service.exportDonorsCsv(donor, {})).rejects.toMatchObject({ statusCode: 403 })
  })

  it('genera CSV con cabecera + filas escapadas y CRLF', async () => {
    repo.listUniqueDonors.mockResolvedValue([
      {
        donor_key: 'X1234567L', donor_nif: 'X1234567L', donor_email: 'juan@x.org',
        donor_name: 'Juan, Pérez', registered: true, donations_count: 3, total_cents: 12500,
        first_donation_at: new Date('2026-01-01T00:00:00Z'),
        last_donation_at:  new Date('2026-06-01T00:00:00Z'),
      },
    ])
    const { filename, csv, count } = await service.exportDonorsCsv(admin, {})
    expect(count).toBe(1)
    expect(filename).toMatch(/^donantes_\d{4}-\d{2}-\d{2}\.csv$/)
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe('donor_key,donor_nif,donor_email,donor_name,registered,donations_count,total_cents,first_donation_at,last_donation_at')
    // El nombre con coma se envuelve en comillas.
    expect(lines[1]).toContain('"Juan, Pérez"')
    expect(lines[1]).toContain('12500')
    expect(lines[1]).toContain('2026-01-01T00:00:00.000Z')
    // Termina en CRLF.
    expect(csv.endsWith('\r\n')).toBe(true)
  })

  it('pide al repo un limit alto (export completo sin paginar)', async () => {
    repo.listUniqueDonors.mockResolvedValue([])
    await service.exportDonorsCsv(admin, { search: 'foo' })
    expect(repo.listUniqueDonors).toHaveBeenCalledWith(
      stubClient,
      expect.objectContaining({ search: 'foo', limit: 10000, offset: 0 }),
    )
  })
})
