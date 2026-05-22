import { describe, it, expect, vi, beforeEach } from 'vitest'

const stubClient = { query: vi.fn() }

vi.mock('../lib/db.js', () => ({
  withTenantTransaction: vi.fn(async (_a, _t, _s, fn) => fn(stubClient)),
}))

vi.mock('../lib/env.js', () => ({
  env: { PLATFORM_CORE_BASE_URL: 'http://platform-core:3000' },
}))

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// renderToBuffer es síncrono y devuelve un Buffer; lo stubeamos para no
// arrastrar @react-pdf/renderer en el unit (es lento y orthogonal).
vi.mock('@react-pdf/renderer', () => ({
  renderToBuffer: vi.fn(async () => Buffer.from('%PDF-stub')),
}))

vi.mock('../templates/Certificate.js', () => ({ Certificate: () => null }))

const { publishSpy } = vi.hoisted(() => ({ publishSpy: vi.fn() }))
vi.mock('@apphub/platform-sdk/redis', () => ({ publish: publishSpy }))

import { generateAnnualCertificates } from '../services/certificate.service.js'

beforeEach(() => {
  vi.clearAllMocks()
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ data: { id: 'obj_pdf_1' } }),
  })

  stubClient.query.mockImplementation(async (sql, params) => {
    if (/FROM platform_tenants\.tenants/i.test(sql)) {
      return {
        rows: [{
          legal_name: 'Fundación AulaVera',
          display_name: 'AulaVera',
          cif: 'G-12345678',
          address: 'Calle Olivo 1',
        }],
      }
    }
    if (/FROM platform_donations\.donations/i.test(sql)) {
      // 2 donaciones distintas con MISMO NIF + 1 donación de OTRO NIF.
      return {
        rows: [
          { id: 'd1', donor_nif: 'X1234567L', donor_email: 'juan@x', donor_name: 'Juan Pérez',
            donor_address: null, donor_postal_code: null, donor_country: 'ES',
            amount_cents: 10000, paid_at: new Date('2026-03-01'), cause_id: null, cause_name: null },
          { id: 'd2', donor_nif: 'X1234567L', donor_email: 'juan@x', donor_name: 'Juan Pérez',
            donor_address: null, donor_postal_code: null, donor_country: 'ES',
            amount_cents: 2500,  paid_at: new Date('2026-06-15'), cause_id: null, cause_name: null },
          { id: 'd3', donor_nif: '12345678Z', donor_email: 'maria@x', donor_name: 'María García',
            donor_address: null, donor_postal_code: null, donor_country: 'ES',
            amount_cents: 5000,  paid_at: new Date('2026-09-01'), cause_id: null, cause_name: null },
        ],
      }
    }
    if (/INSERT INTO platform_donations\.fiscal_certificates/i.test(sql)) {
      return { rows: [{ id: `cert-${params[3]}` }] }   // params[3] = donor_nif
    }
    return { rows: [] }
  })
})

const admin = { userId: 'a1', role: 'admin', appId: 'aulavera', tenantId: 't1' }
const donor = { userId: 'u1', role: 'user',  appId: 'aulavera', tenantId: 't1' }

describe('generateAnnualCertificates', () => {
  it('rechaza si el caller no es admin', async () => {
    await expect(generateAnnualCertificates(donor, { year: 2026 })).rejects.toMatchObject({ statusCode: 403 })
  })

  it('rechaza si year no es entero', async () => {
    await expect(generateAnnualCertificates(admin, { year: 'X' })).rejects.toMatchObject({ statusCode: 422 })
  })

  it('agrupa donaciones por NIF y genera 1 PDF por donante (no 1 por donación)', async () => {
    const out = await generateAnnualCertificates(admin, { year: 2026 })
    // 3 donaciones, 2 NIFs distintos → 2 certificados
    expect(out).toHaveLength(2)
    const totals = Object.fromEntries(out.map(c => [c.donorNif, c.totalCents]))
    expect(totals['X1234567L']).toBe(12500)
    expect(totals['12345678Z']).toBe(5000)
  })

  it('UNIQUE (app, tenant, year, donor_nif) garantiza idempotencia — usa ON CONFLICT DO UPDATE', async () => {
    await generateAnnualCertificates(admin, { year: 2026 })
    // Captura todas las SQL ejecutadas y busca el INSERT del certificate.
    const sqlCalls = stubClient.query.mock.calls.map(c => c[0])
    const insert   = sqlCalls.find(s => /INSERT INTO platform_donations\.fiscal_certificates/.test(s))
    expect(insert).toMatch(/ON CONFLICT \(app_id, tenant_id, fiscal_year, donor_nif\) DO UPDATE/)
  })

  it('publica donation.certificate.ready cuando se pasa redis', async () => {
    const fakeRedis = {}
    await generateAnnualCertificates(admin, { year: 2026 }, { redis: fakeRedis })
    expect(publishSpy).toHaveBeenCalledTimes(2)
    const types = publishSpy.mock.calls.map(c => c[2].type)
    expect(types).toEqual(['donation.certificate.ready', 'donation.certificate.ready'])
  })

  it('NO publica el evento si no se pasa redis (modo síncrono CLI)', async () => {
    await generateAnnualCertificates(admin, { year: 2026 })   // sin { redis }
    expect(publishSpy).not.toHaveBeenCalled()
  })

  it('filtra por donorNif cuando se pasa (genera solo 1 cert)', async () => {
    stubClient.query.mockImplementationOnce(async () => ({
      rows: [{ legal_name: 'X', display_name: 'X', cif: 'G-1', address: null }],
    })).mockImplementationOnce(async () => ({
      rows: [{
        id: 'd1', donor_nif: 'X1234567L', donor_email: 'j@x', donor_name: 'Juan',
        donor_address: null, donor_postal_code: null, donor_country: 'ES',
        amount_cents: 10000, paid_at: new Date('2026-03-01'), cause_id: null, cause_name: null,
      }],
    })).mockImplementationOnce(async () => ({ rows: [{ id: 'cert-1' }] }))

    const out = await generateAnnualCertificates(admin, { year: 2026, donorNif: 'X1234567L' })
    expect(out).toHaveLength(1)
    expect(out[0].donorNif).toBe('X1234567L')
  })
})
