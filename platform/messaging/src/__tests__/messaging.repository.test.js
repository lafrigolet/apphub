// messaging.repository — SQL shape de platform_messaging.* (threads, messages,
// attachments). Valida scoping (app_id+tenant_id), proyección, defaults COALESCE,
// el side-effect last_message_at en insertMessage y los boolean de rowCount.
import { describe, it, expect, vi } from 'vitest'
import * as repo from '../repositories/messaging.repository.js'

function mockClient(result = { rows: [] }) {
  return { query: vi.fn().mockResolvedValue(result) }
}

const APP = 'mk'
const TEN = 't1'

describe('insertThread', () => {
  it('INSERT scoped con COALESCE status open', async () => {
    const c = mockClient({ rows: [{ id: 'th1' }] })
    const r = await repo.insertThread(c, APP, TEN, { buyerUserId: 'b1', vendorUserId: 'v1' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_messaging\.threads/)
    expect(sql).toMatch(/COALESCE\(\$7, 'open'\)/)
    expect(params).toEqual([APP, TEN, 'b1', 'v1', null, null, null])
    expect(r).toEqual({ id: 'th1' })
  })

  it('respeta orderId, subject, status explícitos', async () => {
    const c = mockClient({ rows: [{ id: 'th1' }] })
    await repo.insertThread(c, APP, TEN, {
      buyerUserId: 'b1', vendorUserId: 'v1', orderId: 'o1', subject: 'hi', status: 'closed',
    })
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, 'b1', 'v1', 'o1', 'hi', 'closed'])
  })
})

describe('findThreadById', () => {
  it('row → objeto; sin row → null', async () => {
    expect(await repo.findThreadById(mockClient({ rows: [{ id: 'th1' }] }), APP, TEN, 'th1')).toEqual({ id: 'th1' })
    const c = mockClient({ rows: [] })
    expect(await repo.findThreadById(c, APP, TEN, 'gh')).toBeNull()
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, 'gh'])
  })
})

describe('listThreadsForUser', () => {
  it('role vendor → filtra por vendor_user_id', async () => {
    const c = mockClient({ rows: [{ id: 'th1' }] })
    const r = await repo.listThreadsForUser(c, APP, TEN, 'v1', 'vendor')
    expect(c.query.mock.calls[0][0]).toMatch(/vendor_user_id=\$3/)
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, 'v1'])
    expect(r).toEqual([{ id: 'th1' }])
  })

  it('role buyer (u otro) → filtra por buyer_user_id + ORDER BY COALESCE(last_message_at...)', async () => {
    const c = mockClient({ rows: [] })
    await repo.listThreadsForUser(c, APP, TEN, 'b1', 'buyer')
    expect(c.query.mock.calls[0][0]).toMatch(/buyer_user_id=\$3/)
    expect(c.query.mock.calls[0][0]).toMatch(/ORDER BY COALESCE\(last_message_at, created_at\) DESC/)
  })
})

describe('insertMessage', () => {
  it('INSERT mensaje + UPDATE last_message_at del thread', async () => {
    const c = mockClient({ rows: [{ id: 'm1' }] })
    const r = await repo.insertMessage(c, APP, TEN, 'th1', 'u1', 'hola', [{ k: 1 }])
    expect(c.query).toHaveBeenCalledTimes(2)
    const [sql1, params1] = c.query.mock.calls[0]
    expect(sql1).toMatch(/INSERT INTO platform_messaging\.messages/)
    expect(params1).toEqual([APP, TEN, 'th1', 'u1', 'hola', JSON.stringify([{ k: 1 }])])
    const [sql2, params2] = c.query.mock.calls[1]
    expect(sql2).toMatch(/UPDATE platform_messaging\.threads SET last_message_at = now\(\)/)
    expect(params2).toEqual([APP, TEN, 'th1'])
    expect(r).toEqual({ id: 'm1' })
  })

  it('attachments default → []', async () => {
    const c = mockClient({ rows: [{ id: 'm1' }] })
    await repo.insertMessage(c, APP, TEN, 'th1', 'u1', 'hola')
    expect(c.query.mock.calls[0][1][5]).toBe(JSON.stringify([]))
  })
})

describe('listMessages', () => {
  it('defaults limit/offset + ORDER BY created_at ASC', async () => {
    const c = mockClient({ rows: [{ id: 'm1' }] })
    const r = await repo.listMessages(c, APP, TEN, 'th1')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/ORDER BY created_at ASC/)
    expect(params).toEqual([APP, TEN, 'th1', 100, 0])
    expect(r).toEqual([{ id: 'm1' }])
  })

  it('limit/offset explícitos', async () => {
    const c = mockClient({ rows: [] })
    await repo.listMessages(c, APP, TEN, 'th1', { limit: 10, offset: 20 })
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, 'th1', 10, 20])
  })
})

describe('markRead', () => {
  it('rowCount>0 → true; COALESCE read_at', async () => {
    const c = mockClient({ rowCount: 1 })
    const ok = await repo.markRead(c, APP, TEN, 'm1')
    expect(c.query.mock.calls[0][0]).toMatch(/SET read_at = COALESCE\(read_at, now\(\)\)/)
    expect(ok).toBe(true)
  })

  it('rowCount=0 → false', async () => {
    expect(await repo.markRead(mockClient({ rowCount: 0 }), APP, TEN, 'gh')).toBe(false)
  })
})

describe('findMessageById', () => {
  it('row → objeto; sin row → null', async () => {
    expect(await repo.findMessageById(mockClient({ rows: [{ id: 'm1' }] }), APP, TEN, 'm1')).toEqual({ id: 'm1' })
    expect(await repo.findMessageById(mockClient({ rows: [] }), APP, TEN, 'gh')).toBeNull()
  })
})

describe('insertAttachment', () => {
  it('INSERT scoped con COALESCE display_order 0', async () => {
    const c = mockClient({ rows: [{ id: 'a1' }] })
    await repo.insertAttachment(c, APP, TEN, 'm1', { objectId: 'o1', kind: 'image' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_messaging\.message_attachments/)
    expect(params).toEqual([APP, TEN, 'm1', 'o1', 'image', 0])
  })

  it('respeta displayOrder explícito', async () => {
    const c = mockClient({ rows: [{ id: 'a1' }] })
    await repo.insertAttachment(c, APP, TEN, 'm1', { objectId: 'o1', kind: 'file', displayOrder: 3 })
    expect(c.query.mock.calls[0][1][5]).toBe(3)
  })
})

describe('listAttachments', () => {
  it('SELECT scoped por message + ORDER BY display_order,created_at', async () => {
    const c = mockClient({ rows: [{ id: 'a1' }] })
    const r = await repo.listAttachments(c, APP, TEN, 'm1')
    expect(c.query.mock.calls[0][0]).toMatch(/ORDER BY display_order, created_at/)
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, 'm1'])
    expect(r).toEqual([{ id: 'a1' }])
  })
})

describe('deleteAttachment', () => {
  it('rowCount>0 → true; rowCount=0 → false', async () => {
    expect(await repo.deleteAttachment(mockClient({ rowCount: 1 }), APP, TEN, 'a1')).toBe(true)
    const c = mockClient({ rowCount: 0 })
    expect(await repo.deleteAttachment(c, APP, TEN, 'gh')).toBe(false)
    expect(c.query.mock.calls[0][0]).toMatch(/DELETE FROM platform_messaging\.message_attachments/)
  })
})
