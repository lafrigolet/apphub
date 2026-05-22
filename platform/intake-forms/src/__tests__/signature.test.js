// exportSubmissionPdf — PDF render del cuestionario respondido + firma.
// Contrato:
//   - submission inexistente → NotFoundError.
//   - Si template existe + tiene fields → renderiza por field:label en orden.
//     · answer null/'' → "  —"
//     · answer array → join con ", "
//     · answer object → JSON.stringify
//   - Si template SIN fields → dump KV de submission.answers (fallback).
//   - signature_object_id presente → línea final "Firma digital adjunta — object_id: <id>"
//   - filename = "intake-<id>.pdf"
//   - pdf es un Buffer no-vacío.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../lib/db.js', () => ({ pool: {}, withTenantTransaction: vi.fn() }))
vi.mock('../lib/redis.js', () => ({ publish: vi.fn(), subscribe: vi.fn() }))
vi.mock('../repositories/intake-forms.repository.js')

const createTextPdfMock = vi.hoisted(() => vi.fn())
vi.mock('@apphub/platform-sdk/simple-pdf', () => ({ createTextPdf: createTextPdfMock }))

import { exportSubmissionPdf } from '../services/intake-forms.service.js'
import { withTenantTransaction } from '../lib/db.js'
import * as repo from '../repositories/intake-forms.repository.js'

const ctx = {
  appId: 'wellness-app',
  tenantId: '22222222-2222-2222-2222-222222222222',
  subTenantId: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn({}))
  createTextPdfMock.mockReturnValue(Buffer.from('PDF-DATA'))
})

// ── 404 ─────────────────────────────────────────────────────────────

describe('exportSubmissionPdf — guards', () => {
  it('submission inexistente → NotFoundError', async () => {
    repo.findSubmissionById.mockResolvedValue(null)
    await expect(exportSubmissionPdf(ctx, 'ghost')).rejects.toMatchObject({ statusCode: 404 })
  })
})

// ── PDF con fields ──────────────────────────────────────────────────

describe('exportSubmissionPdf — render with template fields', () => {
  it('renderiza cada field en orden + filename correcto', async () => {
    repo.findSubmissionById.mockResolvedValue({
      template_id: 't1', status: 'submitted', submitted_at: '2026-05-01T10:00:00Z',
      answers: { name: 'Ana López', age: 34, allergies: ['nuts', 'shellfish'] },
    })
    repo.findTemplateById.mockResolvedValue({
      name: 'Pre-Op',
      version: 2,
      fields: [
        { key: 'name',      label: 'Nombre completo' },
        { key: 'age',       label: 'Edad' },
        { key: 'allergies', label: 'Alergias conocidas' },
      ],
    })
    const r = await exportSubmissionPdf(ctx, 'sub-1')

    expect(r.filename).toBe('intake-sub-1.pdf')
    expect(r.pdf).toBeInstanceOf(Buffer)

    const callArgs = createTextPdfMock.mock.calls[0][0]
    expect(callArgs.title).toBe('Cuestionario · Pre-Op')
    const lines = callArgs.lines
    // header
    expect(lines).toContain('Plantilla: Pre-Op')
    expect(lines).toContain('Versión: 2')
    expect(lines).toContain('Estado: submitted')
    // labels + values
    expect(lines).toContain('Nombre completo:')
    expect(lines).toContain('  Ana López')
    expect(lines).toContain('Edad:')
    expect(lines).toContain('  34')
    expect(lines).toContain('Alergias conocidas:')
    expect(lines).toContain('  nuts, shellfish')
  })

  it('answer null/empty → "—"', async () => {
    repo.findSubmissionById.mockResolvedValue({
      template_id: 't1', status: 'submitted',
      answers: { foo: null, bar: '' },
    })
    repo.findTemplateById.mockResolvedValue({
      name: 'X', version: 1,
      fields: [{ key: 'foo', label: 'Foo' }, { key: 'bar', label: 'Bar' }],
    })
    await exportSubmissionPdf(ctx, 'sub-1')
    const lines = createTextPdfMock.mock.calls[0][0].lines
    const dashLines = lines.filter((l) => l === '  —')
    expect(dashLines.length).toBeGreaterThanOrEqual(2)
  })

  it('answer object → JSON.stringify', async () => {
    repo.findSubmissionById.mockResolvedValue({
      template_id: 't1', status: 'submitted',
      answers: { meds: { name: 'Aspirin', dose: '100mg' } },
    })
    repo.findTemplateById.mockResolvedValue({
      name: 'X', version: 1,
      fields: [{ key: 'meds', label: 'Medicación' }],
    })
    await exportSubmissionPdf(ctx, 'sub-1')
    const lines = createTextPdfMock.mock.calls[0][0].lines
    expect(lines).toContain('  {"name":"Aspirin","dose":"100mg"}')
  })

  it('booking_id presente → línea "Reserva: ..."', async () => {
    repo.findSubmissionById.mockResolvedValue({
      template_id: 't1', booking_id: 'bk-99', status: 'submitted',
      answers: {},
    })
    repo.findTemplateById.mockResolvedValue({ name: 'X', version: 1, fields: [] })
    await exportSubmissionPdf(ctx, 'sub-1')
    const lines = createTextPdfMock.mock.calls[0][0].lines
    expect(lines).toContain('Reserva: bk-99')
  })
})

// ── Fallback: template sin fields ────────────────────────────────────

describe('exportSubmissionPdf — fallback sin template fields', () => {
  it('dump KV de answers cuando fields=[]', async () => {
    repo.findSubmissionById.mockResolvedValue({
      template_id: 't1', status: 'submitted',
      answers: { name: 'Ana', age: 34, extra: { foo: 'bar' } },
    })
    repo.findTemplateById.mockResolvedValue({ name: 'X', version: 1, fields: [] })
    await exportSubmissionPdf(ctx, 'sub-1')
    const lines = createTextPdfMock.mock.calls[0][0].lines
    expect(lines).toContain('name: Ana')
    expect(lines).toContain('age: 34')
    expect(lines).toContain('extra: {"foo":"bar"}')
  })

  it('template no encontrado (null) → usa template_id en header + KV dump', async () => {
    repo.findSubmissionById.mockResolvedValue({
      template_id: 't1', status: 'pending', answers: { x: 1 },
    })
    repo.findTemplateById.mockResolvedValue(null)
    await exportSubmissionPdf(ctx, 'sub-1')
    const callArgs = createTextPdfMock.mock.calls[0][0]
    expect(callArgs.title).toBe('Cuestionario · t1')   // fallback al template_id
    expect(callArgs.lines).toContain('Plantilla: t1')
    expect(callArgs.lines).toContain('Versión: —')
  })
})

// ── Firma digital ───────────────────────────────────────────────────

describe('exportSubmissionPdf — signature', () => {
  it('signature_object_id presente → línea final con el object_id', async () => {
    repo.findSubmissionById.mockResolvedValue({
      template_id: 't1', status: 'submitted',
      answers: { name: 'A' }, signature_object_id: 'obj-signature-123',
    })
    repo.findTemplateById.mockResolvedValue({ name: 'X', version: 1, fields: [] })
    await exportSubmissionPdf(ctx, 'sub-1')
    const lines = createTextPdfMock.mock.calls[0][0].lines
    expect(lines.some((l) => l.includes('Firma digital adjunta — object_id: obj-signature-123'))).toBe(true)
  })

  it('SIN signature_object_id → NO añade línea de firma', async () => {
    repo.findSubmissionById.mockResolvedValue({
      template_id: 't1', status: 'submitted', answers: {},
    })
    repo.findTemplateById.mockResolvedValue({ name: 'X', version: 1, fields: [] })
    await exportSubmissionPdf(ctx, 'sub-1')
    const lines = createTextPdfMock.mock.calls[0][0].lines
    expect(lines.some((l) => l.includes('Firma digital'))).toBe(false)
  })
})
