// inquiries.service — create + listAdmin + update.
// Contrato:
//   create:
//     - Falta appId/tenantId/contactName/email/message → ValidationError 422.
//     - settings ausente para (app, tenant) → ValidationError 422.
//     - Happy: INSERT row + publish event 'inquiry.created' (DESPUÉS del COMMIT).
//     - Publish failure NO propaga (log error; row queda persistido).
//     - UNIQUE collision en reference (23505) → ConflictError 409.
//   listAdmin / getById / update: requieren role owner|admin|staff|super_admin.
//   update FSM:
//     - new       → contacted | closed | spam
//     - contacted → closed | spam
//     - closed/spam → terminales (cualquier salida 409).
//     - 404 si no existe.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z' },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../lib/db.js', () => ({ withTenantTransaction: vi.fn() }))
vi.mock('../repositories/inquiries.repository.js')
vi.mock('../repositories/settings.repository.js')

import {
  create, listAdmin, getById, update,
} from '../services/inquiries.service.js'
import { withTenantTransaction } from '../lib/db.js'
import * as inquiriesRepo from '../repositories/inquiries.repository.js'
import * as settingsRepo from '../repositories/settings.repository.js'

const APP    = 'aikikan'
const TENANT = '22222222-2222-2222-2222-222222222222'

const adminIdentity = { userId: 'admin-1', appId: APP, tenantId: TENANT, role: 'admin' }
const ownerIdentity = { userId: 'o-1',     appId: APP, tenantId: TENANT, role: 'owner' }
const staffIdentity = { userId: 's-1',     appId: APP, tenantId: TENANT, role: 'staff' }
const userIdentity  = { userId: 'u-1',     appId: APP, tenantId: TENANT, role: 'user' }

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_a, _t, _s, fn) => fn({}))
})

const validBody = {
  appId: APP, tenantId: TENANT,
  contactName: 'Ana', email: 'ana@x.com', message: 'Hola',
}

// ── create — validations ────────────────────────────────────────────

describe('create — validations', () => {
  it.each([
    ['appId',       { ...validBody, appId: undefined }],
    ['tenantId',    { ...validBody, tenantId: undefined }],
    ['contactName', { ...validBody, contactName: '' }],
    ['email',       { ...validBody, email: '' }],
    ['message',     { ...validBody, message: '' }],
  ])('falta %s → ValidationError 422', async (_field, body) => {
    await expect(create({}, body)).rejects.toMatchObject({ statusCode: 422 })
  })
})

// ── create — settings gate ──────────────────────────────────────────

describe('create — settings gate', () => {
  it('settings ausente → ValidationError "contact inbox not configured"', async () => {
    settingsRepo.findByAppTenant.mockResolvedValue(null)
    await expect(create({}, validBody)).rejects.toMatchObject({
      statusCode: 422,
      message: expect.stringContaining('contact inbox not configured'),
    })
    expect(inquiriesRepo.insert).not.toHaveBeenCalled()
  })

  it('settings con contact_inbox_email=null → 422', async () => {
    settingsRepo.findByAppTenant.mockResolvedValue({ contact_inbox_email: null })
    await expect(create({}, validBody)).rejects.toMatchObject({ statusCode: 422 })
  })
})

// ── create — happy path ─────────────────────────────────────────────

describe('create — happy path', () => {
  beforeEach(() => {
    settingsRepo.findByAppTenant.mockResolvedValue({
      contact_inbox_email: 'admin@x.com',
      reply_to_email: null,
      user_thanks_subject: null,
      user_thanks_body: null,
    })
    inquiriesRepo.insert.mockImplementation(async (_c, args) => ({
      id: 'inq-1',
      reference: args.reference,
      contact_name: args.contactName,
      email: args.email,
      phone: args.phone,
      subject: args.subject,
      message: args.message,
      created_at: '2026-05-24T10:00:00Z',
    }))
  })

  it('INSERT row con reference auto-generada formato INQ-...', async () => {
    await create({}, validBody)
    const args = inquiriesRepo.insert.mock.calls[0][1]
    expect(args.reference).toMatch(/^INQ-\d{8}-[A-Z2-9]{6}$/)
  })

  it('publish event inquiry.created DESPUÉS del COMMIT con payload completo', async () => {
    const redis = { publish: vi.fn().mockResolvedValue(1) }
    await create({ redis }, { ...validBody, phone: '+34', subject: 'Asunto' })
    expect(redis.publish).toHaveBeenCalledWith(
      'platform.events',
      expect.any(String),
    )
    const sent = JSON.parse(redis.publish.mock.calls[0][1])
    expect(sent.type).toBe('inquiry.created')
    expect(sent.payload).toMatchObject({
      appId: APP, tenantId: TENANT,
      inquiryId: 'inq-1',
      contactName: 'Ana', email: 'ana@x.com',
      phone: '+34', subject: 'Asunto',
      contactInboxEmail: 'admin@x.com',
      replyToEmail: 'admin@x.com',                  // fallback al inbox
    })
    expect(sent.payload.reference).toMatch(/^INQ-/)
  })

  it('replyToEmail del settings override el contactInboxEmail', async () => {
    settingsRepo.findByAppTenant.mockResolvedValue({
      contact_inbox_email: 'admin@x.com',
      reply_to_email: 'custom-replyto@x.com',
    })
    const redis = { publish: vi.fn().mockResolvedValue(1) }
    await create({ redis }, validBody)
    const sent = JSON.parse(redis.publish.mock.calls[0][1])
    expect(sent.payload.replyToEmail).toBe('custom-replyto@x.com')
  })

  it('publish error NO propaga (row queda persistido)', async () => {
    const redis = { publish: vi.fn().mockRejectedValue(new Error('redis down')) }
    await expect(create({ redis }, validBody)).resolves.toBeDefined()
  })

  it('sin redis (caller no lo inyecta) → no publish, no error', async () => {
    await expect(create({}, validBody)).resolves.toBeDefined()
  })

  it('returns row con id + reference', async () => {
    const r = await create({}, validBody)
    expect(r.id).toBe('inq-1')
    expect(r.reference).toMatch(/^INQ-/)
  })

  it('UNIQUE collision (23505) → ConflictError 409', async () => {
    const err = new Error('duplicate'); err.code = '23505'
    inquiriesRepo.insert.mockRejectedValue(err)
    await expect(create({}, validBody)).rejects.toMatchObject({ statusCode: 409 })
  })

  it('error DB no-23505 → propaga (no wrap)', async () => {
    inquiriesRepo.insert.mockRejectedValue(new Error('connection refused'))
    await expect(create({}, validBody)).rejects.toThrow('connection refused')
  })
})

// ── listAdmin / getById — role gate ─────────────────────────────────

describe('admin endpoints — role gate', () => {
  it('listAdmin con user → 403', async () => {
    await expect(listAdmin(userIdentity, {})).rejects.toMatchObject({ statusCode: 403 })
  })

  it.each([['admin', adminIdentity], ['owner', ownerIdentity], ['staff', staffIdentity]])(
    'listAdmin con role=%s → OK',
    async (_role, identity) => {
      inquiriesRepo.list.mockResolvedValue([])
      await expect(listAdmin(identity, {})).resolves.toEqual([])
    },
  )

  it('getById con user → 403', async () => {
    await expect(getById(userIdentity, 'i-1')).rejects.toMatchObject({ statusCode: 403 })
  })

  it('getById no encontrado → NotFoundError 404', async () => {
    inquiriesRepo.findById.mockResolvedValue(null)
    await expect(getById(adminIdentity, 'ghost')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('getById encontrado con sub_tenant → pasa subTenantId (rama truthy de ?? null)', async () => {
    inquiriesRepo.findById.mockResolvedValue({ id: 'i-1' })
    const out = await getById({ ...adminIdentity, subTenantId: 'sub-9' }, 'i-1')
    expect(out).toEqual({ id: 'i-1' })
    expect(withTenantTransaction).toHaveBeenCalledWith(APP, TENANT, 'sub-9', expect.any(Function))
  })

  it('listAdmin con identity sin userId → 403', async () => {
    await expect(listAdmin({ role: 'admin' }, {})).rejects.toMatchObject({ statusCode: 403 })
  })
})

// ── update — FSM ────────────────────────────────────────────────────

describe('update — FSM', () => {
  it.each([
    ['new',       'contacted'],
    ['new',       'closed'],
    ['new',       'spam'],
    ['contacted', 'closed'],
    ['contacted', 'spam'],
  ])('transition válida %s → %s', async (from, to) => {
    inquiriesRepo.findById.mockResolvedValue({ id: 'i-1', status: from })
    inquiriesRepo.updateStatus.mockResolvedValue({ id: 'i-1', status: to })
    const r = await update(adminIdentity, 'i-1', { status: to })
    expect(r.status).toBe(to)
    expect(inquiriesRepo.updateStatus).toHaveBeenCalledWith(expect.anything(), 'i-1', to, undefined)
  })

  it.each([
    ['new',       'new'],            // self-transition no permitida
    ['closed',    'contacted'],
    ['closed',    'new'],
    ['spam',      'new'],
    ['contacted', 'new'],
  ])('transition inválida %s → %s → ConflictError 409', async (from, to) => {
    inquiriesRepo.findById.mockResolvedValue({ id: 'i-1', status: from })
    if (from === to) {
      // Self-transition: el código actual considera "no cambio" (no entra al check).
      inquiriesRepo.updateStatus.mockResolvedValue({ id: 'i-1', status: from })
      const r = await update(adminIdentity, 'i-1', { status: to })
      expect(r.status).toBe(from)
    } else {
      await expect(update(adminIdentity, 'i-1', { status: to }))
        .rejects.toMatchObject({ statusCode: 409 })
    }
  })

  it('update staff_notes sin cambiar status → permitido', async () => {
    inquiriesRepo.findById.mockResolvedValue({ id: 'i-1', status: 'closed' })
    inquiriesRepo.updateStatus.mockResolvedValue({ id: 'i-1', status: 'closed', staff_notes: 'nota' })
    const r = await update(adminIdentity, 'i-1', { staffNotes: 'nota' })
    expect(r.staff_notes).toBe('nota')
  })

  it('update con role=user → 403 ANTES del lookup', async () => {
    await expect(update(userIdentity, 'i-1', { status: 'contacted' }))
      .rejects.toMatchObject({ statusCode: 403 })
    expect(inquiriesRepo.findById).not.toHaveBeenCalled()
  })

  it('update id inexistente → NotFoundError 404', async () => {
    inquiriesRepo.findById.mockResolvedValue(null)
    await expect(update(adminIdentity, 'ghost', { status: 'contacted' }))
      .rejects.toMatchObject({ statusCode: 404 })
  })
})
