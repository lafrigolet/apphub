// telehealth.repository — SQL shape de platform_telehealth.{rooms,tokens}.
// Valida proyección de columnas, params parametrizados, COALESCE de defaults,
// scoping (app_id+tenant_id) y el stamping idempotente de markTokenUsed.
import { describe, it, expect, vi } from 'vitest'
import * as repo from '../repositories/telehealth.repository.js'

function mockClient(rows = [], rowCount) {
  return { query: vi.fn().mockResolvedValue({ rows, rowCount: rowCount ?? rows.length }) }
}

const APP = 'yoga'
const TEN = 't1'

describe('insertRoom', () => {
  const r = {
    bookingId: 'b1', provider: 'daily', externalRoomId: 'ext1', joinUrl: 'http://j',
    status: 'created', startsAt: 'S', endsAt: 'E', expiresAt: 'X',
    recordingEnabled: true, metadata: { a: 1 },
  }

  it('INSERT en platform_telehealth.rooms con 12 params en orden', async () => {
    const c = mockClient([{ id: 'room1' }])
    const out = await repo.insertRoom(c, APP, TEN, r)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_telehealth\.rooms/)
    expect(sql).toMatch(/RETURNING \*/)
    expect(params).toEqual([
      APP, TEN, 'b1', 'daily', 'ext1', 'http://j', 'created', 'S', 'E', 'X', true, { a: 1 },
    ])
    expect(out).toEqual({ id: 'room1' })
  })

  it('aplica defaults (provider stub, status created, recording false, metadata {})', async () => {
    const c = mockClient([{ id: 'room1' }])
    await repo.insertRoom(c, APP, TEN, { startsAt: 'S', endsAt: 'E', expiresAt: 'X' })
    const params = c.query.mock.calls[0][1]
    expect(params[2]).toBeNull()        // bookingId
    expect(params[3]).toBe('stub')      // provider default
    expect(params[4]).toBeNull()        // externalRoomId
    expect(params[5]).toBeNull()        // joinUrl
    expect(params[6]).toBe('created')   // status default
    expect(params[10]).toBe(false)      // recordingEnabled default
    expect(params[11]).toEqual({})      // metadata default
  })
})

describe('findRoomById', () => {
  it('scoping app_id/tenant_id/id; row → objeto', async () => {
    const c = mockClient([{ id: 'room1' }])
    const out = await repo.findRoomById(c, APP, TEN, 'room1')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/WHERE app_id=\$1 AND tenant_id=\$2 AND id=\$3/)
    expect(params).toEqual([APP, TEN, 'room1'])
    expect(out).toEqual({ id: 'room1' })
  })

  it('sin row → null', async () => {
    const c = mockClient([])
    expect(await repo.findRoomById(c, APP, TEN, 'x')).toBeNull()
  })
})

describe('findRoomByBookingId', () => {
  it('filtra por booking_id, ORDER BY created_at DESC LIMIT 1', async () => {
    const c = mockClient([{ id: 'room1' }])
    const out = await repo.findRoomByBookingId(c, APP, TEN, 'b1')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/booking_id=\$3/)
    expect(sql).toMatch(/ORDER BY created_at DESC LIMIT 1/)
    expect(params).toEqual([APP, TEN, 'b1'])
    expect(out).toEqual({ id: 'room1' })
  })

  it('sin row → null', async () => {
    const c = mockClient([])
    expect(await repo.findRoomByBookingId(c, APP, TEN, 'b1')).toBeNull()
  })
})

describe('setRoomStatus', () => {
  it('UPDATE status=$4, updated_at=now() scoped', async () => {
    const c = mockClient([{ id: 'room1', status: 'ended' }])
    const out = await repo.setRoomStatus(c, APP, TEN, 'room1', 'ended')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/SET status=\$4, updated_at=now\(\)/)
    expect(params).toEqual([APP, TEN, 'room1', 'ended'])
    expect(out).toEqual({ id: 'room1', status: 'ended' })
  })

  it('sin row → null', async () => {
    const c = mockClient([])
    expect(await repo.setRoomStatus(c, APP, TEN, 'x', 'ended')).toBeNull()
  })
})

describe('insertToken', () => {
  it('INSERT en tokens con 7 params en orden', async () => {
    const c = mockClient([{ id: 'tok1' }])
    const out = await repo.insertToken(c, APP, TEN, {
      roomId: 'room1', userId: 'u1', participantRole: 'host', token: 'tkn', expiresAt: 'X',
    })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_telehealth\.tokens/)
    expect(params).toEqual([APP, TEN, 'room1', 'u1', 'host', 'tkn', 'X'])
    expect(out).toEqual({ id: 'tok1' })
  })
})

describe('listTokens', () => {
  it('filtra por room_id, ORDER BY created_at', async () => {
    const c = mockClient([{ id: 'tok1' }, { id: 'tok2' }])
    const out = await repo.listTokens(c, APP, TEN, 'room1')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/room_id=\$3 ORDER BY created_at/)
    expect(params).toEqual([APP, TEN, 'room1'])
    expect(out).toHaveLength(2)
  })
})

describe('markTokenUsed', () => {
  it('UPDATE used_at = COALESCE(used_at, now()); rowCount>0 → true', async () => {
    const c = mockClient([], 1)
    const out = await repo.markTokenUsed(c, APP, TEN, 'tok1')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/used_at = COALESCE\(used_at, now\(\)\)/)
    expect(params).toEqual([APP, TEN, 'tok1'])
    expect(out).toBe(true)
  })

  it('rowCount=0 → false', async () => {
    const c = mockClient([], 0)
    expect(await repo.markTokenUsed(c, APP, TEN, 'tok1')).toBe(false)
  })
})
