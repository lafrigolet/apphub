// send-log.repository — SQL hacia platform_notifications.send_log.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as repo from '../repositories/send-log.repository.js'

const client = { query: vi.fn() }
beforeEach(() => { vi.clearAllMocks() })

describe('insert', () => {
  it('mapea todos los campos y devuelve id + sent_at', async () => {
    client.query.mockResolvedValue({ rows: [{ id: 'sl1', sent_at: 'now' }] })
    const r = await repo.insert(client, {
      appId: 'aikikan', tenantId: 't1', userId: 'u1',
      channel: 'email', template: 'user.welcome', recipient: 'a@b',
      status: 'sent', error: null,
    })
    expect(r).toEqual({ id: 'sl1', sent_at: 'now' })
    const [sql, params] = client.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_notifications\.send_log/)
    expect(params).toEqual(['aikikan', 't1', 'u1', 'email', 'user.welcome', 'a@b', 'sent', null])
  })

  it('app_id/tenant_id/user_id/error ausentes → NULL', async () => {
    client.query.mockResolvedValue({ rows: [{}] })
    await repo.insert(client, { channel: 'sms', template: 'k', recipient: '+34', status: 'skipped' })
    expect(client.query.mock.calls[0][1]).toEqual([null, null, null, 'sms', 'k', '+34', 'skipped', null])
  })
})

describe('list', () => {
  it('sin filtros → solo LIMIT/OFFSET con defaults', async () => {
    client.query.mockResolvedValue({ rows: [] })
    await repo.list(client)
    const [sql, params] = client.query.mock.calls[0]
    expect(sql).not.toMatch(/WHERE/)
    expect(params).toEqual([100, 0])
  })

  it('filtros combinados channel+status → WHERE con placeholders en orden', async () => {
    client.query.mockResolvedValue({ rows: [{ id: 'sl1' }] })
    const rows = await repo.list(client, { channel: 'email', status: 'failed', limit: 10, offset: 5 })
    const [sql, params] = client.query.mock.calls[0]
    expect(sql).toMatch(/WHERE channel = \$1 AND status = \$2/)
    expect(sql).toMatch(/LIMIT \$3 OFFSET \$4/)
    expect(params).toEqual(['email', 'failed', 10, 5])
    expect(rows).toEqual([{ id: 'sl1' }])
  })

  it('filtro template', async () => {
    client.query.mockResolvedValue({ rows: [] })
    await repo.list(client, { template: 'booking.confirmed' })
    const [sql, params] = client.query.mock.calls[0]
    expect(sql).toMatch(/WHERE template = \$1/)
    expect(params).toEqual(['booking.confirmed', 100, 0])
  })
})
