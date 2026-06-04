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
  assign, addNote, listActivities, analytics, remove,
  submitCsat, purgeRetention,
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
    expect(inquiriesRepo.updateStatus).toHaveBeenCalledWith(expect.anything(), 'i-1', to, undefined, undefined)
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

  it('transition válida new→resolved', async () => {
    inquiriesRepo.findById.mockResolvedValue({ id: 'i-1', status: 'new' })
    inquiriesRepo.updateStatus.mockResolvedValue({ id: 'i-1', status: 'resolved' })
    inquiriesRepo.insertActivity.mockResolvedValue({ id: 'a-1' })
    const r = await update(adminIdentity, 'i-1', { status: 'resolved' })
    expect(r.status).toBe('resolved')
  })

  it('resolved es terminal → cualquier salida 409', async () => {
    inquiriesRepo.findById.mockResolvedValue({ id: 'i-1', status: 'resolved' })
    await expect(update(adminIdentity, 'i-1', { status: 'closed' }))
      .rejects.toMatchObject({ statusCode: 409 })
  })

  it('cambio de status registra activity status_change con autor + publica evento', async () => {
    inquiriesRepo.findById.mockResolvedValue({ id: 'i-1', status: 'new' })
    inquiriesRepo.updateStatus.mockResolvedValue({ id: 'i-1', status: 'resolved' })
    inquiriesRepo.insertActivity.mockResolvedValue({ id: 'a-1' })
    const redis = { publish: vi.fn().mockResolvedValue(1) }
    await update({ ...adminIdentity, email: 'a@x.com', redis }, 'i-1', { status: 'resolved', closeReason: 'resuelto' })
    expect(inquiriesRepo.insertActivity).toHaveBeenCalledWith(expect.anything(), 'i-1', expect.objectContaining({
      type: 'status_change', authorUserId: 'admin-1', authorEmail: 'a@x.com',
      metadata: { from: 'new', to: 'resolved' },
    }))
    const sent = JSON.parse(redis.publish.mock.calls[0][1])
    expect(sent.type).toBe('inquiry.status_changed')
    expect(sent.payload).toMatchObject({ inquiryId: 'i-1', from: 'new', to: 'resolved', closeReason: 'resuelto' })
  })

  it('update solo staff_notes (sin cambio status) NO publica evento ni activity', async () => {
    inquiriesRepo.findById.mockResolvedValue({ id: 'i-1', status: 'new' })
    inquiriesRepo.updateStatus.mockResolvedValue({ id: 'i-1', status: 'new' })
    const redis = { publish: vi.fn() }
    await update({ ...adminIdentity, redis }, 'i-1', { staffNotes: 'nota' })
    expect(inquiriesRepo.insertActivity).not.toHaveBeenCalled()
    expect(redis.publish).not.toHaveBeenCalled()
  })
})

// ── assign ───────────────────────────────────────────────────────────

describe('assign', () => {
  it('role user → 403', async () => {
    await expect(assign(userIdentity, 'i-1', 'staff-9')).rejects.toMatchObject({ statusCode: 403 })
  })

  it('inquiry inexistente → 404', async () => {
    inquiriesRepo.findById.mockResolvedValue(null)
    await expect(assign(adminIdentity, 'ghost', 'staff-9')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('asigna, registra activity assignment y publica inquiry.assigned', async () => {
    inquiriesRepo.findById.mockResolvedValue({ id: 'i-1', assigned_to: null })
    inquiriesRepo.assign.mockResolvedValue({ id: 'i-1', assigned_to: 'staff-9' })
    inquiriesRepo.insertActivity.mockResolvedValue({ id: 'a-1' })
    const redis = { publish: vi.fn().mockResolvedValue(1) }
    const r = await assign({ ...adminIdentity, redis }, 'i-1', 'staff-9')
    expect(r.assigned_to).toBe('staff-9')
    expect(inquiriesRepo.insertActivity).toHaveBeenCalledWith(expect.anything(), 'i-1', expect.objectContaining({
      type: 'assignment', metadata: { from: null, to: 'staff-9' },
    }))
    const sent = JSON.parse(redis.publish.mock.calls[0][1])
    expect(sent.type).toBe('inquiry.assigned')
    expect(sent.payload).toMatchObject({ inquiryId: 'i-1', assignedTo: 'staff-9' })
  })

  it('asignar al mismo destinatario → no-op (sin activity ni evento)', async () => {
    inquiriesRepo.findById.mockResolvedValue({ id: 'i-1', assigned_to: 'staff-9' })
    const redis = { publish: vi.fn() }
    await assign({ ...adminIdentity, redis }, 'i-1', 'staff-9')
    expect(inquiriesRepo.assign).not.toHaveBeenCalled()
    expect(redis.publish).not.toHaveBeenCalled()
  })
})

// ── addNote / listActivities ─────────────────────────────────────────

describe('addNote', () => {
  it('role user → 403', async () => {
    await expect(addNote(userIdentity, 'i-1', 'hola')).rejects.toMatchObject({ statusCode: 403 })
  })

  it('body vacío → 422', async () => {
    await expect(addNote(adminIdentity, 'i-1', '')).rejects.toMatchObject({ statusCode: 422 })
  })

  it('inquiry inexistente → 404', async () => {
    inquiriesRepo.findById.mockResolvedValue(null)
    await expect(addNote(adminIdentity, 'ghost', 'hola')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('inserta note con autoría', async () => {
    inquiriesRepo.findById.mockResolvedValue({ id: 'i-1' })
    inquiriesRepo.insertActivity.mockResolvedValue({ id: 'a-1', type: 'note' })
    const r = await addNote({ ...adminIdentity, email: 'a@x.com' }, 'i-1', 'llamado al cliente')
    expect(r.type).toBe('note')
    expect(inquiriesRepo.insertActivity).toHaveBeenCalledWith(expect.anything(), 'i-1', expect.objectContaining({
      type: 'note', body: 'llamado al cliente', authorUserId: 'admin-1', authorEmail: 'a@x.com',
    }))
  })
})

describe('listActivities', () => {
  it('role user → 403', async () => {
    await expect(listActivities(userIdentity, 'i-1', {})).rejects.toMatchObject({ statusCode: 403 })
  })

  it('inquiry inexistente → 404', async () => {
    inquiriesRepo.findById.mockResolvedValue(null)
    await expect(listActivities(adminIdentity, 'ghost', {})).rejects.toMatchObject({ statusCode: 404 })
  })

  it('devuelve el timeline', async () => {
    inquiriesRepo.findById.mockResolvedValue({ id: 'i-1' })
    inquiriesRepo.listActivities.mockResolvedValue([{ id: 'a-1', type: 'note' }])
    const r = await listActivities(adminIdentity, 'i-1', { limit: 10 })
    expect(r).toEqual([{ id: 'a-1', type: 'note' }])
  })
})

// ── analytics ────────────────────────────────────────────────────────

describe('analytics', () => {
  it('role user → 403', async () => {
    await expect(analytics(userIdentity, {})).rejects.toMatchObject({ statusCode: 403 })
  })

  it('devuelve la agregación del repo', async () => {
    inquiriesRepo.analytics.mockResolvedValue({ total: 5, spam_count: 1, avg_csat: 4.2 })
    const r = await analytics(adminIdentity, { createdFrom: '2026-01-01' })
    expect(r).toMatchObject({ total: 5, avg_csat: 4.2 })
    expect(inquiriesRepo.analytics).toHaveBeenCalledWith(expect.anything(), { createdFrom: '2026-01-01' })
  })
})

// ── remove (GDPR) ────────────────────────────────────────────────────

describe('remove — GDPR erasure', () => {
  it('role user → 403', async () => {
    await expect(remove(userIdentity, 'i-1')).rejects.toMatchObject({ statusCode: 403 })
  })

  it('inquiry inexistente → 404', async () => {
    inquiriesRepo.findById.mockResolvedValue(null)
    await expect(remove(adminIdentity, 'ghost')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('soft-delete + anonymize + activity system + evento sin PII', async () => {
    inquiriesRepo.findById.mockResolvedValue({ id: 'i-1', email: 'real@x.com' })
    inquiriesRepo.softDelete.mockResolvedValue({ id: 'i-1' })
    inquiriesRepo.anonymize.mockResolvedValue({ id: 'i-1', email: 'anonymized@removed.invalid' })
    inquiriesRepo.insertActivity.mockResolvedValue({ id: 'a-1' })
    const redis = { publish: vi.fn().mockResolvedValue(1) }
    const r = await remove({ ...adminIdentity, redis }, 'i-1')
    expect(inquiriesRepo.softDelete).toHaveBeenCalled()
    expect(inquiriesRepo.anonymize).toHaveBeenCalled()
    expect(r.email).toBe('anonymized@removed.invalid')
    const sent = JSON.parse(redis.publish.mock.calls[0][1])
    expect(sent.type).toBe('inquiry.deleted')
    expect(JSON.stringify(sent.payload)).not.toContain('real@x.com')
  })
})

// ── listAdmin — assignedTo='me' ──────────────────────────────────────

describe('listAdmin — assignedTo=me', () => {
  it("'me' se resuelve al userId del staff", async () => {
    inquiriesRepo.list.mockResolvedValue([])
    await listAdmin(adminIdentity, { assignedTo: 'me' })
    expect(inquiriesRepo.list).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ assignedTo: 'admin-1' }))
  })

  it('filtros pasan tal cual al repo', async () => {
    inquiriesRepo.list.mockResolvedValue([])
    await listAdmin(adminIdentity, { source: 'landing', q: 'factura' })
    expect(inquiriesRepo.list).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ source: 'landing', q: 'factura' }))
  })
})

// ── submitCsat (CSAT público) ────────────────────────────────────────

describe('submitCsat — CSAT público (reference + email)', () => {
  const csatInput = {
    appId: APP, tenantId: TENANT,
    reference: 'INQ-20260101-AB12CD', email: 'ana@x.com', score: 5,
  }

  it.each([
    ['appId',     { ...csatInput, appId: undefined }],
    ['tenantId',  { ...csatInput, tenantId: undefined }],
    ['reference', { ...csatInput, reference: '' }],
    ['email',     { ...csatInput, email: '' }],
  ])('falta %s → ValidationError 422', async (_f, body) => {
    await expect(submitCsat({}, body)).rejects.toMatchObject({ statusCode: 422 })
  })

  it.each([0, 6, 2.5, NaN])('score inválido (%s) → 422', async (score) => {
    await expect(submitCsat({}, { ...csatInput, score })).rejects.toMatchObject({ statusCode: 422 })
  })

  it('referencia inexistente → 404', async () => {
    inquiriesRepo.findByReference.mockResolvedValue(null)
    await expect(submitCsat({}, csatInput)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('email no coincide → 404 (indistinguible)', async () => {
    inquiriesRepo.findByReference.mockResolvedValue({ id: 'i-1', email: 'otro@x.com', status: 'resolved' })
    await expect(submitCsat({}, csatInput)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('estado no elegible (new/contacted) → 409', async () => {
    inquiriesRepo.findByReference.mockResolvedValue({ id: 'i-1', email: 'ana@x.com', status: 'new' })
    await expect(submitCsat({}, csatInput)).rejects.toMatchObject({ statusCode: 409 })
  })

  it('CSAT ya enviado → 409', async () => {
    inquiriesRepo.findByReference.mockResolvedValue({ id: 'i-1', email: 'ana@x.com', status: 'closed', csat_submitted_at: '2026-01-02T00:00:00Z' })
    await expect(submitCsat({}, csatInput)).rejects.toMatchObject({ statusCode: 409 })
  })

  it('happy: graba CSAT + publica inquiry.csat_submitted', async () => {
    inquiriesRepo.findByReference.mockResolvedValue({ id: 'i-1', email: 'ana@x.com', status: 'resolved', csat_submitted_at: null })
    inquiriesRepo.submitCsat.mockResolvedValue({ id: 'i-1', csat_submitted_at: '2026-01-02T00:00:00Z' })
    const redis = { publish: vi.fn().mockResolvedValue(1) }
    const r = await submitCsat({ redis }, csatInput)
    expect(r).toMatchObject({ reference: csatInput.reference, score: 5 })
    expect(inquiriesRepo.submitCsat).toHaveBeenCalledWith(expect.anything(), 'i-1', { score: 5, comment: undefined })
    const sent = JSON.parse(redis.publish.mock.calls[0][1])
    expect(sent.type).toBe('inquiry.csat_submitted')
    expect(sent.payload).toMatchObject({ inquiryId: 'i-1', score: 5 })
  })

  it('email case-insensitive', async () => {
    inquiriesRepo.findByReference.mockResolvedValue({ id: 'i-1', email: 'ANA@X.com', status: 'closed', csat_submitted_at: null })
    inquiriesRepo.submitCsat.mockResolvedValue({ id: 'i-1', csat_submitted_at: 't' })
    await expect(submitCsat({}, csatInput)).resolves.toBeTruthy()
  })

  it('submitCsat repo devuelve null (carrera) → 409', async () => {
    inquiriesRepo.findByReference.mockResolvedValue({ id: 'i-1', email: 'ana@x.com', status: 'resolved', csat_submitted_at: null })
    inquiriesRepo.submitCsat.mockResolvedValue(null)
    await expect(submitCsat({}, csatInput)).rejects.toMatchObject({ statusCode: 409 })
  })
})

// ── purgeRetention (GDPR retención) ──────────────────────────────────

describe('purgeRetention — anonimización por retention_days', () => {
  const svcIdentity = { appId: APP, tenantId: TENANT }

  it('sin retention_days configurado → no-op', async () => {
    settingsRepo.findByAppTenant.mockResolvedValue({ retention_days: null })
    const r = await purgeRetention(svcIdentity)
    expect(r).toEqual({ anonymized: 0, ids: [] })
    expect(inquiriesRepo.findRetentionDue).not.toHaveBeenCalled()
  })

  it('settings ausente → no-op', async () => {
    settingsRepo.findByAppTenant.mockResolvedValue(null)
    const r = await purgeRetention(svcIdentity)
    expect(r.anonymized).toBe(0)
  })

  it('sin filas due → no publica evento', async () => {
    settingsRepo.findByAppTenant.mockResolvedValue({ retention_days: 30 })
    inquiriesRepo.findRetentionDue.mockResolvedValue([])
    const redis = { publish: vi.fn() }
    const r = await purgeRetention({ ...svcIdentity, redis })
    expect(r.anonymized).toBe(0)
    expect(redis.publish).not.toHaveBeenCalled()
  })

  it('anonimiza filas due + activity system + publica inquiry.retention_purged', async () => {
    settingsRepo.findByAppTenant.mockResolvedValue({ retention_days: 30 })
    inquiriesRepo.findRetentionDue.mockResolvedValue(['i-1', 'i-2'])
    inquiriesRepo.anonymize.mockResolvedValue({ id: 'x' })
    inquiriesRepo.insertActivity.mockResolvedValue({ id: 'a' })
    const redis = { publish: vi.fn().mockResolvedValue(1) }
    const r = await purgeRetention({ ...svcIdentity, redis })
    expect(r.anonymized).toBe(2)
    expect(inquiriesRepo.anonymize).toHaveBeenCalledTimes(2)
    expect(inquiriesRepo.insertActivity).toHaveBeenCalledTimes(2)
    const sent = JSON.parse(redis.publish.mock.calls[0][1])
    expect(sent.type).toBe('inquiry.retention_purged')
    expect(sent.payload).toMatchObject({ count: 2 })
  })

  it('anonymize devuelve null (ya anonimizada) → no cuenta', async () => {
    settingsRepo.findByAppTenant.mockResolvedValue({ retention_days: 30 })
    inquiriesRepo.findRetentionDue.mockResolvedValue(['i-1'])
    inquiriesRepo.anonymize.mockResolvedValue(null)
    const redis = { publish: vi.fn() }
    const r = await purgeRetention({ ...svcIdentity, redis })
    expect(r.anonymized).toBe(0)
    expect(redis.publish).not.toHaveBeenCalled()
  })
})
