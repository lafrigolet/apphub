// email-domains.repository — SQL shape de tenant_email_domains.
// Valida proyección, params parametrizados, el stamping condicional de
// verified_at en setStatus, y los COALESCE de updateDefaults/setStatus.
import { describe, it, expect, vi } from 'vitest'
import * as repo from '../repositories/email-domains.repository.js'

function mockClient(rows = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) }
}

describe('insert', () => {
  it('INSERT con status pending y dns_records serializado', async () => {
    const c = mockClient([{ id: 'd1' }])
    const r = await repo.insert(c, {
      appId: 'aikikan', tenantId: 't1', domain: 'mail.x.com',
      provider: 'resend', providerDomainId: 'rsd-1', dnsRecords: [{ a: 1 }],
    })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_notifications\.tenant_email_domains/)
    expect(sql).toMatch(/'pending'/)
    expect(params).toEqual(['aikikan', 't1', 'mail.x.com', 'resend', 'rsd-1', JSON.stringify([{ a: 1 }])])
    expect(r).toEqual({ id: 'd1' })
  })

  it('dnsRecords ausente → array vacío serializado', async () => {
    const c = mockClient([{}])
    await repo.insert(c, { appId: 'a', tenantId: 't', domain: 'd', provider: 'p', providerDomainId: null })
    expect(c.query.mock.calls[0][1][5]).toBe('[]')
  })
})

describe('listForTenant / findById / findVerifiedByDomain', () => {
  it('listForTenant ordena por created_at DESC', async () => {
    const c = mockClient([{ id: 'd1' }])
    expect(await repo.listForTenant(c)).toEqual([{ id: 'd1' }])
    expect(c.query.mock.calls[0][0]).toMatch(/ORDER BY created_at DESC/)
  })

  it('findById → null sin row', async () => {
    const c = mockClient([])
    expect(await repo.findById(c, 'x')).toBeNull()
    expect(c.query.mock.calls[0][1]).toEqual(['x'])
  })

  it('findVerifiedByDomain filtra status=verified', async () => {
    const c = mockClient([{ id: 'd1' }])
    await repo.findVerifiedByDomain(c, 'mail.x.com')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/status = 'verified'/)
    expect(params).toEqual(['mail.x.com'])
  })

  it('findVerifiedByDomain → null sin row', async () => {
    expect(await repo.findVerifiedByDomain(mockClient([]), 'd')).toBeNull()
  })
})

describe('setStatus', () => {
  it('stampa verified_at condicional y serializa dnsRecords', async () => {
    const c = mockClient([{ id: 'd1', status: 'verified' }])
    await repo.setStatus(c, 'd1', 'verified', [{ ok: true }])
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/verified_at\s+= CASE WHEN \$2 = 'verified' THEN now\(\) ELSE verified_at END/)
    expect(params).toEqual(['d1', 'verified', JSON.stringify([{ ok: true }])])
  })

  it('dnsRecords null → param null', async () => {
    const c = mockClient([{}])
    await repo.setStatus(c, 'd1', 'failed', null)
    expect(c.query.mock.calls[0][1][2]).toBeNull()
  })

  it('sin row → null', async () => {
    expect(await repo.setStatus(mockClient([]), 'x', 'pending', null)).toBeNull()
  })
})

describe('updateDefaults', () => {
  it('COALESCE en los 3 campos, null por defecto', async () => {
    const c = mockClient([{ id: 'd1' }])
    await repo.updateDefaults(c, 'd1', { defaultFromName: 'X' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/default_from_local = COALESCE/)
    expect(params).toEqual(['d1', null, 'X', null])
  })

  it('sin row → null', async () => {
    expect(await repo.updateDefaults(mockClient([]), 'x', {})).toBeNull()
  })
})

describe('suspend', () => {
  it('marca suspended con reason', async () => {
    const c = mockClient([{ id: 'd1', status: 'suspended' }])
    await repo.suspend(c, 'd1', 'abuse')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/status\s+= 'suspended'/)
    expect(params).toEqual(['d1', 'abuse'])
  })

  it('reason ausente → null', async () => {
    const c = mockClient([{}])
    await repo.suspend(c, 'd1')
    expect(c.query.mock.calls[0][1][1]).toBeNull()
  })

  it('sin row → null', async () => {
    expect(await repo.suspend(mockClient([]), 'x', 'r')).toBeNull()
  })
})

describe('remove', () => {
  it('DELETE por id', async () => {
    const c = mockClient([])
    await repo.remove(c, 'd1')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/DELETE FROM platform_notifications\.tenant_email_domains WHERE id = \$1/)
    expect(params).toEqual(['d1'])
  })
})
