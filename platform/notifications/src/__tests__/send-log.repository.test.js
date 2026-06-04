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
    expect(params).toEqual(['aikikan', 't1', 'u1', 'email', 'user.welcome', 'a@b', 'sent', null, null])
  })

  it('app_id/tenant_id/user_id/error ausentes → NULL', async () => {
    client.query.mockResolvedValue({ rows: [{}] })
    await repo.insert(client, { channel: 'sms', template: 'k', recipient: '+34', status: 'skipped' })
    expect(client.query.mock.calls[0][1]).toEqual([null, null, null, 'sms', 'k', '+34', 'skipped', null, null])
  })

  it('providerMessageId se persiste como 9º param', async () => {
    client.query.mockResolvedValue({ rows: [{ id: 'x' }] })
    await repo.insert(client, { channel: 'email', template: 'k', recipient: 'a@b', status: 'sent', providerMessageId: 'msg_42' })
    expect(client.query.mock.calls[0][1][8]).toBe('msg_42')
  })
})

describe('updateDeliveryStatus', () => {
  it('actualiza por provider_message_id y devuelve rowCount', async () => {
    client.query.mockResolvedValue({ rowCount: 1 })
    const n = await repo.updateDeliveryStatus(client, { providerMessageId: 'msg_1', deliveryStatus: 'delivered' })
    expect(n).toBe(1)
    const [sql, params] = client.query.mock.calls[0]
    expect(sql).toMatch(/UPDATE platform_notifications\.send_log/)
    expect(sql).toMatch(/WHERE provider_message_id = \$1/)
    expect(params).toEqual(['msg_1', 'delivered', null])
  })
  it('trunca el error a 2000 chars', async () => {
    client.query.mockResolvedValue({ rowCount: 0 })
    const n = await repo.updateDeliveryStatus(client, { providerMessageId: 'm', deliveryStatus: 'bounced', error: 'e'.repeat(5000) })
    expect(n).toBe(0)
    expect(client.query.mock.calls[0][1][2].length).toBe(2000)
  })
})

describe('purgeOlderThan', () => {
  it('borra por intervalo y devuelve rowCount', async () => {
    client.query.mockResolvedValue({ rowCount: 7 })
    const n = await repo.purgeOlderThan(client, { olderThanDays: 90 })
    expect(n).toBe(7)
    const [sql, params] = client.query.mock.calls[0]
    expect(sql).toMatch(/DELETE FROM platform_notifications\.send_log/)
    expect(sql).toMatch(/interval/)
    expect(params).toEqual(['90'])
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
