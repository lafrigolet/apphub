// audit.service — lectura del audit log con scoping por rol.
// Staff/super_admin ven todo; el resto sólo su propio tenant_id.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', DATABASE_URL_TENANTS: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../lib/db.js', () => ({ pool: {}, withTransaction: vi.fn() }))
vi.mock('../repositories/audit.repository.js')

import { listAudit, recordAudit } from '../services/audit.service.js'
import { withTransaction } from '../lib/db.js'
import * as auditRepo from '../repositories/audit.repository.js'

beforeEach(() => {
  vi.clearAllMocks()
  withTransaction.mockImplementation(async (_p, fn) => fn({}))
})

describe('listAudit — scoping por rol', () => {
  it('staff ve cualquier appId/tenantId tal cual', async () => {
    auditRepo.list.mockResolvedValue([{ id: 'a1' }])
    await listAudit({ appId: 'a', tenantId: 't9', limit: 10 }, { role: 'staff' })
    expect(auditRepo.list).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ appId: 'a', tenantId: 't9', limit: 10 }))
  })

  it('super_admin idem', async () => {
    auditRepo.list.mockResolvedValue([])
    await listAudit({ tenantId: 't9' }, { role: 'super_admin' })
    expect(auditRepo.list).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ tenantId: 't9' }))
  })

  it('non-staff sin tenantId en JWT → Forbidden', async () => {
    await expect(listAudit({}, { role: 'owner' })).rejects.toThrow(/Tenant scope required/)
  })

  it('non-staff pidiendo otro tenant → Forbidden', async () => {
    await expect(listAudit({ tenantId: 'other' }, { role: 'owner', tenantId: 't1' }))
      .rejects.toThrow(/another tenant/)
  })

  it('non-staff → fuerza su propio tenantId', async () => {
    auditRepo.list.mockResolvedValue([])
    await listAudit({ appId: 'a' }, { role: 'owner', tenantId: 't1' })
    expect(auditRepo.list).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ tenantId: 't1' }))
  })

  it('non-staff pidiendo su propio tenant explícito → ok', async () => {
    auditRepo.list.mockResolvedValue([])
    await listAudit({ tenantId: 't1' }, { role: 'owner', tenantId: 't1' })
    expect(auditRepo.list).toHaveBeenCalled()
  })

  it('propaga el cursor `before` al repo (#10)', async () => {
    auditRepo.list.mockResolvedValue([])
    await listAudit({ tenantId: 't9', before: '2026-06-01T00:00:00Z' }, { role: 'staff' })
    expect(auditRepo.list).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ before: '2026-06-01T00:00:00Z' }),
    )
  })
})

describe('recordAudit', () => {
  it('delega en auditRepo.insert', async () => {
    auditRepo.insert.mockResolvedValue({ id: 'a1' })
    const r = await recordAudit({ appId: 'a', action: 'X' })
    expect(r).toEqual({ id: 'a1' })
    expect(auditRepo.insert).toHaveBeenCalledWith(expect.anything(), { appId: 'a', action: 'X' })
  })
})
