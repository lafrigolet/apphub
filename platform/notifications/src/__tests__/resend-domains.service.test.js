// resend-domains.service — wrapper sobre la Domains API de Resend.
// Cubre stub-mode (sin apiKey → CNAMEs sintéticos / auto-pass), camino real
// (fetch con adaptRecords), el helper rs (no-ok → throw, 204 → null) y los
// 3 verbos: create / validate / delete.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import * as resend from '../services/resend-domains.service.js'

beforeEach(() => { vi.clearAllMocks(); global.fetch = vi.fn() })

describe('stub mode (sin apiKey)', () => {
  it('createBrandedDomain → providerDomainId stub + 3 dnsRecords', async () => {
    const r = await resend.createBrandedDomain({ apiKey: null, domain: 'mail.x.com' })
    expect(r.providerDomainId).toMatch(/^stub_/)
    expect(r.dnsRecords).toHaveLength(3)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('validateBrandedDomain → { valid:true, dnsRecords:null }', async () => {
    const r = await resend.validateBrandedDomain({ apiKey: '', providerDomainId: 'x' })
    expect(r).toEqual({ valid: true, dnsRecords: null })
  })

  it('deleteBrandedDomain → no-op sin fetch', async () => {
    await resend.deleteBrandedDomain({ apiKey: null, providerDomainId: 'x' })
    expect(global.fetch).not.toHaveBeenCalled()
  })
})

describe('camino real (con apiKey)', () => {
  it('createBrandedDomain adapta records de Resend', async () => {
    global.fetch.mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({
        id: 'rsd-1',
        records: [
          { record: 'SPF', type: 'TXT', name: 'send.x.com', value: 'v=spf1', status: 'not_started' },
          { record: 'DKIM', type: 'CNAME', name: 'k._domainkey.x.com', value: 'cname.x', status: 'verified' },
          { type: 'TXT', name: null, value: 'v' }, // sin host → filtrado
        ],
      }),
    })
    const r = await resend.createBrandedDomain({ apiKey: 're_k', domain: 'x.com' })
    expect(r.providerDomainId).toBe('rsd-1')
    expect(r.dnsRecords).toHaveLength(2)
    expect(r.dnsRecords[0]).toMatchObject({ key: 'SPF', type: 'txt', host: 'send.x.com', valid: false })
    expect(r.dnsRecords[1].valid).toBe(true)
  })

  it('createBrandedDomain con records ausentes → []', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'rsd-2' }) })
    const r = await resend.createBrandedDomain({ apiKey: 're_k', domain: 'x.com' })
    expect(r.dnsRecords).toEqual([])
  })

  it('validateBrandedDomain: POST verify (ignora fallo) + GET estado', async () => {
    global.fetch
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'verify-failed' }) // POST verify → catch
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ status: 'verified', records: [{ record: 'r', type: 'cname', name: 'h', value: 'v', status: 'verified' }] }) })
    const r = await resend.validateBrandedDomain({ apiKey: 're_k', providerDomainId: 'rsd-1' })
    expect(r.valid).toBe(true)
    expect(r.dnsRecords).toHaveLength(1)
  })

  it('validateBrandedDomain: estado pending sin records → dnsRecords null', async () => {
    global.fetch
      .mockResolvedValueOnce({ ok: true, status: 204, json: async () => null })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ status: 'pending' }) })
    const r = await resend.validateBrandedDomain({ apiKey: 're_k', providerDomainId: 'rsd-1' })
    expect(r).toEqual({ valid: false, dnsRecords: null })
  })

  it('deleteBrandedDomain hace DELETE (204 → null)', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 204 })
    await resend.deleteBrandedDomain({ apiKey: 're_k', providerDomainId: 'rsd-1' })
    expect(global.fetch).toHaveBeenCalledWith(expect.stringMatching(/\/domains\/rsd-1$/), expect.objectContaining({ method: 'DELETE' }))
  })

  it('rs propaga error cuando la API responde no-ok', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 422, text: async () => 'invalid domain' })
    await expect(resend.createBrandedDomain({ apiKey: 're_k', domain: 'x.com' }))
      .rejects.toThrow(/resend POST \/domains → 422: invalid domain/)
  })

  it('rs maneja text() que lanza (→ string vacío)', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 500, text: async () => { throw new Error('x') } })
    await expect(resend.createBrandedDomain({ apiKey: 're_k', domain: 'x.com' })).rejects.toThrow(/500/)
  })
})
