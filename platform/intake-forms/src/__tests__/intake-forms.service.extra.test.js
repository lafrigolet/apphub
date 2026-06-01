// Cobertura complementaria del service: rutas felices (getTemplate, getSubmission,
// publishTemplate) y el exportador de PDF (exportSubmissionPdf) con sus ramas.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../lib/db.js', () => ({
  pool: { connect: vi.fn() },
  withTenantTransaction: vi.fn(),
}))
vi.mock('../lib/redis.js', () => ({
  publish: vi.fn(),
  subscribe: vi.fn(),
}))
vi.mock('../repositories/intake-forms.repository.js')
vi.mock('@apphub/platform-sdk/simple-pdf', () => ({
  createTextPdf: vi.fn(() => Buffer.from('PDF')),
}))

import * as service from '../services/intake-forms.service.js'
import { withTenantTransaction } from '../lib/db.js'
import * as repo from '../repositories/intake-forms.repository.js'
import { createTextPdf } from '@apphub/platform-sdk/simple-pdf'
import { NotFoundError } from '@apphub/platform-sdk/errors'

const APP = 'yoga'
const TEN = '00000000-0000-0000-0000-000000000001'
const TPL = '11111111-1111-1111-1111-111111111111'
const SUB = '22222222-2222-2222-2222-222222222222'

const ctx = { appId: APP, tenantId: TEN, subTenantId: null, userId: 'u1', role: 'buyer' }

function mockClient() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }
}

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(mockClient()))
})

describe('happy paths', () => {
  it('getTemplate returns the template when found', async () => {
    repo.findTemplateById.mockResolvedValue({ id: TPL, name: 'T' })
    expect(await service.getTemplate(ctx, TPL)).toEqual({ id: TPL, name: 'T' })
  })

  it('getSubmission returns the submission when found', async () => {
    repo.findSubmissionById.mockResolvedValue({ id: SUB })
    expect(await service.getSubmission(ctx, SUB)).toEqual({ id: SUB })
  })

  it('getSubmission throws NotFoundError when missing', async () => {
    repo.findSubmissionById.mockResolvedValue(null)
    await expect(service.getSubmission(ctx, SUB)).rejects.toThrow(NotFoundError)
  })

  it('publishTemplate returns the published template', async () => {
    repo.publishTemplate.mockResolvedValue({ id: TPL, is_published: true })
    expect(await service.publishTemplate(ctx, TPL)).toEqual({ id: TPL, is_published: true })
  })

  it('createSubmission defaults clientUserId to ctx.userId', async () => {
    repo.findTemplateById.mockResolvedValue({ id: TPL, is_published: true })
    repo.insertSubmission.mockResolvedValue({ id: SUB })
    await service.createSubmission(ctx, { templateId: TPL })
    expect(repo.insertSubmission).toHaveBeenCalledWith(
      expect.anything(), APP, TEN,
      expect.objectContaining({ clientUserId: 'u1' }),
    )
  })
})

describe('exportSubmissionPdf', () => {
  it('throws NotFoundError when submission missing', async () => {
    repo.findSubmissionById.mockResolvedValue(null)
    await expect(service.exportSubmissionPdf(ctx, SUB)).rejects.toThrow(NotFoundError)
  })

  it('renders fields with all value shapes (template fields known)', async () => {
    repo.findSubmissionById.mockResolvedValue({
      id: SUB, template_id: TPL, booking_id: 'bk1', status: 'submitted',
      submitted_at: '2026-01-01T00:00:00Z', signature_object_id: 'obj1',
      answers: { a: 'text', b: ['x', 'y'], c: { k: 1 }, d: '' },
    })
    repo.findTemplateById.mockResolvedValue({
      id: TPL, name: 'Cuestionario', version: 2,
      fields: [
        { key: 'a', label: 'A' },
        { key: 'b', label: 'B' },
        { key: 'c', label: 'C' },
        { key: 'd', label: 'D' },
        { key: 'e' }, // missing answer + no label
      ],
    })
    const out = await service.exportSubmissionPdf(ctx, SUB)
    expect(out.filename).toBe(`intake-${SUB}.pdf`)
    expect(Buffer.isBuffer(out.pdf)).toBe(true)
    const lines = createTextPdf.mock.calls[0][0].lines
    expect(lines).toContain('A:')
    expect(lines).toContain('  text')
    expect(lines).toContain('  x, y')
    expect(lines).toContain('  {"k":1}')
    expect(lines.some((l) => l.includes('Firma digital adjunta'))).toBe(true)
  })

  it('falls back to KV dump when template has no fields', async () => {
    repo.findSubmissionById.mockResolvedValue({
      id: SUB, template_id: TPL, status: 'pending', answers: { foo: 'bar', obj: { z: 1 } },
    })
    repo.findTemplateById.mockResolvedValue(null)
    await service.exportSubmissionPdf(ctx, SUB)
    const lines = createTextPdf.mock.calls[0][0].lines
    expect(lines).toContain('foo: bar')
    expect(lines).toContain('obj: {"z":1}')
  })
})
