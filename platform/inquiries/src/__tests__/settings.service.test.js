// settings.service — resolveContactInbox + getForTenant + upsertForTenant.
// Contrato:
//   resolveContactInbox(client, app, tenant):
//     - row sin contact_inbox_email (o ausente) → ValidationError 422.
//     - row válido → lo devuelve.
//     - NO abre transacción propia (recibe el client del caller).
//   getForTenant / upsertForTenant:
//     - requireAdmin: sin userId o role no-admin → ForbiddenError 403.
//     - corren dentro de withTenantTransaction con el scope del identity.
//     - upsert pasa el body mapeado al repo.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/db.js', () => ({ withTenantTransaction: vi.fn() }))
vi.mock('../repositories/settings.repository.js', () => ({
  findByAppTenant: vi.fn(),
  upsert:          vi.fn(),
}))

import { resolveContactInbox, getForTenant, upsertForTenant } from '../services/settings.service.js'
import { withTenantTransaction } from '../lib/db.js'
import * as repo from '../repositories/settings.repository.js'
import { ForbiddenError, ValidationError } from '@apphub/platform-sdk/errors'

const APP    = 'aikikan'
const TENANT = '22222222-2222-2222-2222-222222222222'
const admin  = { userId: 'a1', appId: APP, tenantId: TENANT, subTenantId: null, role: 'admin' }

// withTenantTransaction(app, tenant, sub, cb) → cb(fakeClient)
const fakeClient = { query: vi.fn() }
beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_a, _t, _s, cb) => cb(fakeClient))
})

describe('resolveContactInbox', () => {
  it('row sin contact_inbox_email → ValidationError', async () => {
    repo.findByAppTenant.mockResolvedValue({ app_id: APP, tenant_id: TENANT, contact_inbox_email: null })
    await expect(resolveContactInbox(fakeClient, APP, TENANT)).rejects.toBeInstanceOf(ValidationError)
  })

  it('sin row (null) → ValidationError', async () => {
    repo.findByAppTenant.mockResolvedValue(null)
    await expect(resolveContactInbox(fakeClient, APP, TENANT)).rejects.toBeInstanceOf(ValidationError)
  })

  it('row con inbox → lo devuelve, usando el client recibido (sin abrir tx)', async () => {
    const row = { contact_inbox_email: 'box@x.com' }
    repo.findByAppTenant.mockResolvedValue(row)
    const out = await resolveContactInbox(fakeClient, APP, TENANT)
    expect(out).toBe(row)
    expect(repo.findByAppTenant).toHaveBeenCalledWith(fakeClient, APP, TENANT)
    expect(withTenantTransaction).not.toHaveBeenCalled()
  })
})

describe('getForTenant', () => {
  it('identity sin userId → ForbiddenError', async () => {
    await expect(getForTenant({ role: 'admin' })).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('role no admin → ForbiddenError', async () => {
    await expect(getForTenant({ userId: 'x', role: 'user', appId: APP, tenantId: TENANT })).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('admin → withTenantTransaction con scope del identity + repo.findByAppTenant', async () => {
    repo.findByAppTenant.mockResolvedValue({ contact_inbox_email: 'box@x.com' })
    const out = await getForTenant(admin)
    expect(out).toEqual({ contact_inbox_email: 'box@x.com' })
    expect(withTenantTransaction).toHaveBeenCalledWith(APP, TENANT, null, expect.any(Function))
    expect(repo.findByAppTenant).toHaveBeenCalledWith(fakeClient, APP, TENANT)
  })
})

describe('upsertForTenant', () => {
  it('role no admin → ForbiddenError', async () => {
    await expect(upsertForTenant({ userId: 'x', role: 'user' }, {})).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('admin → repo.upsert con body mapeado (camelCase) + scope', async () => {
    repo.upsert.mockResolvedValue({ contact_inbox_email: 'box@x.com' })
    const body = {
      contactInboxEmail: 'box@x.com',
      replyToEmail:      'reply@x.com',
      userThanksSubject: 'Gracias',
      userThanksBody:    'Te respondemos pronto',
    }
    const out = await upsertForTenant(admin, body)
    expect(out).toEqual({ contact_inbox_email: 'box@x.com' })
    expect(withTenantTransaction).toHaveBeenCalledWith(APP, TENANT, null, expect.any(Function))
    expect(repo.upsert).toHaveBeenCalledWith(fakeClient, {
      appId: APP, tenantId: TENANT,
      contactInboxEmail: 'box@x.com',
      replyToEmail: 'reply@x.com',
      userThanksSubject: 'Gracias',
      userThanksBody: 'Te respondemos pronto',
    })
  })
})
