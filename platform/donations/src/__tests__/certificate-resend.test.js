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

vi.mock('@react-pdf/renderer', () => ({ renderToBuffer: vi.fn() }))
vi.mock('../templates/Certificate.js', () => ({ Certificate: () => null }))

vi.mock('../repositories/fiscal-certificates.repository.js', () => ({
  findById: vi.fn(),
  markSent: vi.fn(),
}))

const { publishSpy } = vi.hoisted(() => ({ publishSpy: vi.fn() }))
vi.mock('@apphub/platform-sdk/redis', () => ({ publish: publishSpy }))

import { resendCertificate } from '../services/certificate.service.js'
import * as certsRepo from '../repositories/fiscal-certificates.repository.js'

beforeEach(() => vi.clearAllMocks())

const APP    = 'aikikan'
const TENANT = '30000000-0000-0000-0000-000000000001'
const admin  = { userId: 'a1', role: 'admin', appId: APP, tenantId: TENANT }
const donor  = { userId: 'u1', role: 'user',  appId: APP, tenantId: TENANT }

const cert = {
  id: 'cert1', fiscal_year: 2026, donor_nif: 'X1234567L',
  donor_email: 'juan@x.org', donor_name: 'Juan', total_cents: 12500,
  pdf_object_id: 'obj1', sent_at: null,
}

describe('resendCertificate', () => {
  it('rechaza al donante (403)', async () => {
    await expect(resendCertificate(donor, 'cert1')).rejects.toMatchObject({ statusCode: 403 })
  })

  it('404 si el certificado no existe', async () => {
    certsRepo.findById.mockResolvedValue(null)
    await expect(resendCertificate(admin, 'ghost')).rejects.toMatchObject({ statusCode: 404 })
    expect(certsRepo.markSent).not.toHaveBeenCalled()
  })

  it('marca sent_at y re-publica el evento donation.certificate.ready', async () => {
    certsRepo.findById.mockResolvedValue(cert)
    certsRepo.markSent.mockResolvedValue({ ...cert, sent_at: new Date() })
    const redis = {}
    const r = await resendCertificate(admin, 'cert1', { redis })
    expect(certsRepo.markSent).toHaveBeenCalledWith(stubClient, 'cert1')
    expect(r.sent_at).toBeTruthy()
    expect(publishSpy).toHaveBeenCalledWith(redis, APP, expect.objectContaining({
      type: 'donation.certificate.ready',
      payload: expect.objectContaining({
        certificateId: 'cert1', donorEmail: 'juan@x.org', resend: true,
      }),
    }))
  })

  it('sin redis → marca sent_at pero no publica (no falla)', async () => {
    certsRepo.findById.mockResolvedValue(cert)
    certsRepo.markSent.mockResolvedValue({ ...cert, sent_at: new Date() })
    await resendCertificate(admin, 'cert1', {})
    expect(certsRepo.markSent).toHaveBeenCalled()
    expect(publishSpy).not.toHaveBeenCalled()
  })
})
