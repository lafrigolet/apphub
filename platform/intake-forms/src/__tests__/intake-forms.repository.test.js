// intake-forms.repository — SQL shape de platform_intake_forms.{templates,submissions}.
// Valida proyección de columnas, scoping (app_id + tenant_id), params parametrizados,
// filtros opcionales y el stamping FSM de submitAnswers / reviewSubmission.
import { describe, it, expect, vi } from 'vitest'
import * as repo from '../repositories/intake-forms.repository.js'

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
  it('INSERT con defaults COALESCE para answers y status', async () => {
    const c = mockClient([{ id: 'sub1' }])
    const s = { templateId: 'tpl1', clientUserId: 'u1' }
    await repo.insertSubmission(c, APP, TEN, s)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_intake_forms\.submissions/)
    expect(sql).toMatch(/COALESCE\(\$6,'\{\}'::jsonb\)/)
    expect(sql).toMatch(/COALESCE\(\$10,'pending'\)/)
    expect(params).toEqual([APP, TEN, 'tpl1', null, 'u1', {}, null, null, null, 'pending', null])
  })

  it('respeta valores explícitos', async () => {
    const c = mockClient([{ id: 'sub1' }])
    await repo.insertSubmission(c, APP, TEN, {
      templateId: 'tpl1', bookingId: 'bk1', clientUserId: 'u1',
      answers: { q: 1 }, signatureUrl: 'http://s', signatureObjectId: 'obj1',
      signedAt: 'now', status: 'submitted', submittedAt: 'then',
    })
    expect(c.query.mock.calls[0][1]).toEqual([
      APP, TEN, 'tpl1', 'bk1', 'u1', { q: 1 }, 'http://s', 'obj1', 'now', 'submitted', 'then',
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
  it('UPDATE answers + COALESCE firma + status submitted; null defaults', async () => {
    const c = mockClient([{ id: 'sub1', status: 'submitted' }])
    const r = await repo.submitAnswers(c, APP, TEN, 'sub1', { answers: { q: 1 } })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/SET answers=\$4/)
    expect(sql).toMatch(/signature_url\s+= COALESCE\(\$5, signature_url\)/)
    expect(sql).toMatch(/status='submitted'/)
    expect(params).toEqual([APP, TEN, 'sub1', { q: 1 }, null, null])
    expect(r).toEqual({ id: 'sub1', status: 'submitted' })
  })

  it('pasa signatureUrl + signatureObjectId', async () => {
    const c = mockClient([{ id: 'sub1' }])
    await repo.submitAnswers(c, APP, TEN, 'sub1', { answers: {}, signatureUrl: 'http://s', signatureObjectId: 'obj1' })
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, 'sub1', {}, 'http://s', 'obj1'])
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
