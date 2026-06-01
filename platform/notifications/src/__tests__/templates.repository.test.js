// templates.repository — CRUD de plantillas de notificación con lookup
// locale-aware (fallback a 'es'). Valida proyección de columnas, params,
// la lógica de fallback de findByKey y los COALESCE de insert/update.
import { describe, it, expect, vi } from 'vitest'
import * as repo from '../repositories/templates.repository.js'

function mockClient(rowsSeq) {
  // rowsSeq: array de {rows} devueltos en orden de llamada.
  let i = 0
  return { query: vi.fn().mockImplementation(async () => rowsSeq[i++] ?? { rows: [] }) }
}

describe('list / findById', () => {
  it('list ordena por key, channel, locale', async () => {
    const c = mockClient([{ rows: [{ id: 't1' }] }])
    expect(await repo.list(c)).toEqual([{ id: 't1' }])
    expect(c.query.mock.calls[0][0]).toMatch(/ORDER BY key, channel, locale/)
  })

  it('findById → null sin row', async () => {
    const c = mockClient([{ rows: [] }])
    expect(await repo.findById(c, 'x')).toBeNull()
    expect(c.query.mock.calls[0][1]).toEqual(['x'])
  })
})

describe('findByKey — fallback de locale', () => {
  it('encuentra en el locale pedido → no consulta fallback', async () => {
    const c = mockClient([{ rows: [{ id: 't-en' }] }])
    const r = await repo.findByKey(c, 'welcome', 'email', 'en')
    expect(r).toEqual({ id: 't-en' })
    expect(c.query).toHaveBeenCalledTimes(1)
    expect(c.query.mock.calls[0][1]).toEqual(['welcome', 'email', 'en'])
  })

  it('locale pedido vacío + locale != es → consulta fallback es', async () => {
    const c = mockClient([{ rows: [] }, { rows: [{ id: 't-es' }] }])
    const r = await repo.findByKey(c, 'welcome', 'email', 'en')
    expect(r).toEqual({ id: 't-es' })
    expect(c.query).toHaveBeenCalledTimes(2)
    expect(c.query.mock.calls[1][1]).toEqual(['welcome', 'email', 'es'])
  })

  it('locale == es y sin row → null (no segunda consulta)', async () => {
    const c = mockClient([{ rows: [] }])
    expect(await repo.findByKey(c, 'welcome', 'email', 'es')).toBeNull()
    expect(c.query).toHaveBeenCalledTimes(1)
  })

  it('fallback tampoco existe → null', async () => {
    const c = mockClient([{ rows: [] }, { rows: [] }])
    expect(await repo.findByKey(c, 'welcome', 'email', 'fr')).toBeNull()
  })

  it('defaults channel=email locale=es', async () => {
    const c = mockClient([{ rows: [{ id: 't' }] }])
    await repo.findByKey(c, 'welcome')
    expect(c.query.mock.calls[0][1]).toEqual(['welcome', 'email', 'es'])
  })
})

describe('insert', () => {
  it('aplica defaults via SQL COALESCE y params en orden', async () => {
    const c = mockClient([{ rows: [{ id: 'new' }] }])
    await repo.insert(c, {
      key: 'welcome', body_text: 'hola', channel: 'sms', locale: 'en',
      subject: 'S', body_html: '<b>', variables: ['name'], enabled: true,
    })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_notifications\.templates/)
    expect(params).toEqual(['welcome', 'sms', 'en', 'S', 'hola', '<b>', ['name'], true])
  })

  it('channel ausente → email; variables ausente → []', async () => {
    const c = mockClient([{ rows: [{}] }])
    await repo.insert(c, { key: 'k', body_text: 't' })
    const params = c.query.mock.calls[0][1]
    expect(params[1]).toBe('email')
    expect(params[6]).toEqual([])
  })
})

describe('update / remove', () => {
  it('update → null sin row', async () => {
    const c = mockClient([{ rows: [] }])
    expect(await repo.update(c, 'x', { subject: 'S' })).toBeNull()
  })

  it('update pasa los 8 params', async () => {
    const c = mockClient([{ rows: [{ id: 'x' }] }])
    await repo.update(c, 'x', { channel: 'email', locale: 'es', subject: 'S', body_text: 'b', body_html: 'h', variables: [], enabled: false })
    expect(c.query.mock.calls[0][1]).toEqual(['x', 'email', 'es', 'S', 'b', 'h', [], false])
  })

  it('remove → DELETE por id', async () => {
    const c = mockClient([{ rows: [] }])
    await repo.remove(c, 'x')
    expect(c.query.mock.calls[0][0]).toMatch(/DELETE FROM platform_notifications\.templates WHERE id = \$1/)
  })
})
