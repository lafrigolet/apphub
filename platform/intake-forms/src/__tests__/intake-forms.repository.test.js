// intake-forms.repository — SQL shape de platform_intake_forms.{templates,submissions}.
// Valida proyección de columnas, scoping (app_id + tenant_id), params parametrizados,
// filtros opcionales y el stamping FSM de submitAnswers / reviewSubmission.
import { describe, it, expect, vi } from 'vitest'

// answers are encrypted at rest (use-case #1); set a deterministic master key.
process.env.PLATFORM_CONFIG_ENCRYPTION_KEY = 'a'.repeat(64)

import * as repo from '../repositories/intake-forms.repository.js'
import { decryptSecret } from '@apphub/platform-sdk/crypto'

const APP = 'aikikan'
const TEN = 't1'

function mockClient(rows = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) }
}

describe('insertTemplate', () => {
  it('INSERT en platform_intake_forms.templates con defaults COALESCE', async () => {
    const c = mockClient([{ id: 'tpl1' }])
    const t = { code: 'C', name: 'N', description: 'D', schema: { fields: [] } }
    const r = await repo.insertTemplate(c, APP, TEN, t)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_intake_forms\.templates/)
    expect(sql).toMatch(/COALESCE\(\$7,1\)/)
    expect(sql).toMatch(/COALESCE\(\$8,FALSE\)/)
    expect(sql).toMatch(/COALESCE\(\$9,FALSE\)/)
    expect(params).toEqual([APP, TEN, 'C', 'N', 'D', { fields: [] }, 1, false, false])
    expect(r).toEqual({ id: 'tpl1' })
  })

  it('aplica defaults cuando faltan description/version/flags', async () => {
    const c = mockClient([{ id: 'tpl1' }])
    await repo.insertTemplate(c, APP, TEN, { code: 'C', name: 'N', schema: {} })
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, 'C', 'N', null, {}, 1, false, false])
  })
})

describe('findTemplateById', () => {
  it('WHERE app_id+tenant_id+id; sin row → null', async () => {
    const c = mockClient([])
    expect(await repo.findTemplateById(c, APP, TEN, 'x')).toBeNull()
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/WHERE app_id=\$1 AND tenant_id=\$2 AND id=\$3/)
    expect(params).toEqual([APP, TEN, 'x'])
  })

  it('devuelve la primera fila cuando existe', async () => {
    const c = mockClient([{ id: 'tpl1' }])
    expect(await repo.findTemplateById(c, APP, TEN, 'tpl1')).toEqual({ id: 'tpl1' })
  })
})

describe('listTemplates', () => {
  it('sin onlyPublished → solo scope app/tenant', async () => {
    const c = mockClient([{ id: 'a' }])
    await repo.listTemplates(c, APP, TEN)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/WHERE app_id = \$1 AND tenant_id = \$2 ORDER BY name, version DESC/)
    expect(sql).not.toMatch(/is_published = TRUE/)
    expect(params).toEqual([APP, TEN])
  })

  it('onlyPublished → añade is_published = TRUE', async () => {
    const c = mockClient([])
    await repo.listTemplates(c, APP, TEN, { onlyPublished: true })
    expect(c.query.mock.calls[0][0]).toMatch(/is_published = TRUE/)
  })
})

describe('publishTemplate', () => {
  it('UPDATE is_published TRUE; row inexistente → null', async () => {
    const c = mockClient([])
    expect(await repo.publishTemplate(c, APP, TEN, 'x')).toBeNull()
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/SET is_published = TRUE, updated_at = now\(\)/)
    expect(params).toEqual([APP, TEN, 'x'])
  })

  it('devuelve la fila actualizada', async () => {
    const c = mockClient([{ id: 'tpl1', is_published: true }])
    expect(await repo.publishTemplate(c, APP, TEN, 'tpl1')).toEqual({ id: 'tpl1', is_published: true })
  })
})

describe('insertSubmission', () => {
  it('INSERT sin answers → answers_encrypted NULL + plaintext blanqueado', async () => {
    const c = mockClient([{ id: 'sub1' }])
    const s = { templateId: 'tpl1', clientUserId: 'u1' }
    await repo.insertSubmission(c, APP, TEN, s)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_intake_forms\.submissions/)
    expect(sql).toMatch(/answers_encrypted/)
    expect(sql).toMatch(/COALESCE\(\$10,'pending'\)/)
    // app, tenant, template, booking, client, answers_encrypted(null), sig_url, sig_obj, signed, status, submitted, consent*4
    expect(params).toEqual([
      APP, TEN, 'tpl1', null, 'u1', null, null, null, null, 'pending', null, null, null, null, null,
    ])
  })

  it('cifra answers en reposo (answers_encrypted descifrable) + consent', async () => {
    const c = mockClient([{ id: 'sub1' }])
    await repo.insertSubmission(c, APP, TEN, {
      templateId: 'tpl1', bookingId: 'bk1', clientUserId: 'u1',
      answers: { q: 1 }, signatureUrl: 'http://s', signatureObjectId: 'obj1',
      signedAt: 'now', status: 'submitted', submittedAt: 'then',
      consentText: 'I agree', consentVersion: 'v1', consentAcceptedAt: 'when', legalBasis: 'consent',
    })
    const params = c.query.mock.calls[0][1]
    const enc = params[5]
    expect(Buffer.isBuffer(enc)).toBe(true)
    expect(JSON.parse(decryptSecret(enc))).toEqual({ q: 1 })
    expect(params.slice(6)).toEqual([
      'http://s', 'obj1', 'now', 'submitted', 'then', 'I agree', 'v1', 'when', 'consent',
    ])
  })
})

describe('findSubmissionById', () => {
  it('WHERE app_id+tenant_id+id; sin row → null', async () => {
    const c = mockClient([])
    expect(await repo.findSubmissionById(c, APP, TEN, 'x')).toBeNull()
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, 'x'])
  })

  it('devuelve la fila', async () => {
    const c = mockClient([{ id: 'sub1' }])
    expect(await repo.findSubmissionById(c, APP, TEN, 'sub1')).toEqual({ id: 'sub1' })
  })
})

describe('findSubmissionByBookingId', () => {
  it('filtra por booking_id, ORDER BY created_at DESC LIMIT 1', async () => {
    const c = mockClient([{ id: 'sub1' }])
    expect(await repo.findSubmissionByBookingId(c, APP, TEN, 'bk1')).toEqual({ id: 'sub1' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/WHERE app_id=\$1 AND tenant_id=\$2 AND booking_id=\$3/)
    expect(sql).toMatch(/ORDER BY created_at DESC LIMIT 1/)
    expect(params).toEqual([APP, TEN, 'bk1'])
  })

  it('sin row → null', async () => {
    const c = mockClient([])
    expect(await repo.findSubmissionByBookingId(c, APP, TEN, 'bk1')).toBeNull()
  })
})

describe('submitAnswers', () => {
  it('UPDATE cifra answers + COALESCE firma + status submitted; null defaults', async () => {
    const c = mockClient([{ id: 'sub1', status: 'submitted' }])
    const r = await repo.submitAnswers(c, APP, TEN, 'sub1', { answers: { q: 1 } })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/SET answers='\{\}'::jsonb/)
    expect(sql).toMatch(/answers_encrypted\s+= \$4/)
    expect(sql).toMatch(/signature_url\s+= COALESCE\(\$5, signature_url\)/)
    expect(sql).toMatch(/status='submitted'/)
    expect(params[0]).toBe(APP); expect(params[1]).toBe(TEN); expect(params[2]).toBe('sub1')
    expect(JSON.parse(decryptSecret(params[3]))).toEqual({ q: 1 })
    expect(params.slice(4)).toEqual([null, null])
    expect(r).toEqual({ id: 'sub1', status: 'submitted' })
  })

  it('pasa signatureUrl + signatureObjectId', async () => {
    const c = mockClient([{ id: 'sub1' }])
    await repo.submitAnswers(c, APP, TEN, 'sub1', { answers: {}, signatureUrl: 'http://s', signatureObjectId: 'obj1' })
    const params = c.query.mock.calls[0][1]
    // empty answers object still encrypts to a buffer
    expect(Buffer.isBuffer(params[3])).toBe(true)
    expect(params.slice(4)).toEqual(['http://s', 'obj1'])
  })

  it('row inexistente → null', async () => {
    const c = mockClient([])
    expect(await repo.submitAnswers(c, APP, TEN, 'x', { answers: {} })).toBeNull()
  })
})

describe('reviewSubmission', () => {
  it('UPDATE status reviewed + reviewer; row → fila', async () => {
    const c = mockClient([{ id: 'sub1', status: 'reviewed' }])
    const r = await repo.reviewSubmission(c, APP, TEN, 'sub1', 'reviewer1')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/SET status='reviewed', reviewed_by_user_id=\$4, reviewed_at=now\(\)/)
    expect(params).toEqual([APP, TEN, 'sub1', 'reviewer1'])
    expect(r).toEqual({ id: 'sub1', status: 'reviewed' })
  })

  it('row inexistente → null', async () => {
    const c = mockClient([])
    expect(await repo.reviewSubmission(c, APP, TEN, 'x', 'r')).toBeNull()
  })
})

describe('listSubmissions', () => {
  function listClient() {
    // first query = count, second = items
    const c = { query: vi.fn() }
    c.query
      .mockResolvedValueOnce({ rows: [{ total: 3 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'a' }, { id: 'b' }] })
    return c
  }

  it('scopes by app+tenant and paginates with defaults', async () => {
    const c = listClient()
    const out = await repo.listSubmissions(c, APP, TEN, {})
    const [countSql, countParams] = c.query.mock.calls[0]
    expect(countSql).toMatch(/SELECT COUNT\(\*\)::int AS total FROM platform_intake_forms\.submissions/)
    expect(countSql).toMatch(/app_id = \$1 AND tenant_id = \$2/)
    // shared params array; the count query ran with only [APP, TEN] (no filters)
    expect(countParams.slice(0, 2)).toEqual([APP, TEN])

    const [itemsSql, itemsParams] = c.query.mock.calls[1]
    expect(itemsSql).toMatch(/ORDER BY created_at DESC/)
    expect(itemsSql).not.toMatch(/answers_encrypted/) // never bulk-decrypt
    expect(itemsParams).toEqual([APP, TEN, 50, 0]) // default limit/offset
    expect(out).toEqual({ items: [{ id: 'a' }, { id: 'b' }], total: 3, limit: 50, offset: 0 })
  })

  it('applies all filters as parametrised conditions', async () => {
    const c = listClient()
    await repo.listSubmissions(c, APP, TEN, {
      status: 'submitted', templateId: 'tpl', clientUserId: 'cu', bookingId: 'bk',
      from: '2026-01-01', to: '2026-02-01', limit: 10, offset: 20,
    })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/status = \$3/)
    expect(sql).toMatch(/template_id = \$4::uuid/)
    expect(sql).toMatch(/client_user_id = \$5::uuid/)
    expect(sql).toMatch(/booking_id = \$6::uuid/)
    expect(sql).toMatch(/created_at >= \$7/)
    expect(sql).toMatch(/created_at <= \$8/)
    // count + items share the same params array (items appends limit/offset);
    // assert the filter prefix (first 8) + the trailing pagination args.
    expect(params.slice(0, 8)).toEqual([APP, TEN, 'submitted', 'tpl', 'cu', 'bk', '2026-01-01', '2026-02-01'])
    expect(params.slice(-2)).toEqual([10, 20])
  })

  it('clamps limit to [1,200] and offset to >=0', async () => {
    const c = listClient()
    await repo.listSubmissions(c, APP, TEN, { limit: 9999, offset: -5 })
    expect(c.query.mock.calls[1][1].slice(-2)).toEqual([200, 0])
  })
})

describe('eraseSubmission', () => {
  it('anonymises answers + signature, stamps erased_*; idempotent COALESCE', async () => {
    const c = mockClient([{ id: 'sub1', erased_at: 'now' }])
    const r = await repo.eraseSubmission(c, APP, TEN, 'sub1', 'staff1')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/answers='\{\}'::jsonb/)
    expect(sql).toMatch(/answers_encrypted = NULL/)
    expect(sql).toMatch(/signature_object_id = NULL/)
    expect(sql).toMatch(/erased_at = COALESCE\(erased_at, now\(\)\)/)
    expect(params).toEqual([APP, TEN, 'sub1', 'staff1'])
    expect(r).toEqual({ id: 'sub1', erased_at: 'now' })
  })

  it('row inexistente → null', async () => {
    const c = mockClient([])
    expect(await repo.eraseSubmission(c, APP, TEN, 'x', 'staff1')).toBeNull()
  })
})
