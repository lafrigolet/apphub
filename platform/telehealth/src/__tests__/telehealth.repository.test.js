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

  it('INSERT en platform_telehealth.rooms con 13 params en orden', async () => {
    const c = mockClient([{ id: 'room1' }])
    const out = await repo.insertRoom(c, APP, TEN, { ...r, dataRegion: 'eu-central' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_telehealth\.rooms/)
    expect(sql).toMatch(/RETURNING \*/)
    expect(params).toEqual([
      APP, TEN, 'b1', 'daily', 'ext1', 'http://j', 'created', 'S', 'E', 'X', true, { a: 1 }, 'eu-central',
    ])
    expect(out).toEqual({ id: 'room1' })
  })

  it('aplica defaults (provider stub, status created, recording false, metadata {}, region null→eu-west)', async () => {
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
    expect(params[12]).toBeNull()       // dataRegion → COALESCE to eu-west in SQL
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

describe('updateRoomSchedule', () => {
  it('UPDATE starts/ends/expires scoped y excluye estados terminales', async () => {
    const c = mockClient([{ id: 'room1' }])
    const out = await repo.updateRoomSchedule(c, APP, TEN, 'room1', { startsAt: 'S2', endsAt: 'E2', expiresAt: 'X2' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/SET starts_at=\$4, ends_at=\$5, expires_at=\$6/)
    expect(sql).toMatch(/status NOT IN \('ended','cancelled','expired'\)/)
    expect(params).toEqual([APP, TEN, 'room1', 'S2', 'E2', 'X2'])
    expect(out).toEqual({ id: 'room1' })
  })
  it('sin row → null', async () => {
    const c = mockClient([])
    expect(await repo.updateRoomSchedule(c, APP, TEN, 'x', { startsAt: 'S', endsAt: 'E', expiresAt: 'X' })).toBeNull()
  })
})

describe('expireStaleRooms', () => {
  it("UPDATE status='expired' filtra expires_at<now() y created/active, devuelve filas", async () => {
    const c = mockClient([{ id: 'r1' }, { id: 'r2' }])
    const out = await repo.expireStaleRooms(c, APP, TEN, 100)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/SET status='expired'/)
    expect(sql).toMatch(/expires_at < now\(\)/)
    expect(sql).toMatch(/status IN \('created','active'\)/)
    expect(params).toEqual([APP, TEN, 100])
    expect(out).toHaveLength(2)
  })
  it('default limit = 500', async () => {
    const c = mockClient([])
    await repo.expireStaleRooms(c, APP, TEN)
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, 500])
  })
})

describe('setRecordingConsent', () => {
  it('UPDATE recording_consent_* scoped; text COALESCE', async () => {
    const c = mockClient([{ id: 'room1' }])
    const out = await repo.setRecordingConsent(c, APP, TEN, 'room1', { status: 'granted', by: 'u9', text: 'I consent' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/recording_consent_status=\$4/)
    expect(sql).toMatch(/recording_consent_at=now\(\)/)
    expect(params).toEqual([APP, TEN, 'room1', 'granted', 'u9', 'I consent'])
    expect(out).toEqual({ id: 'room1' })
  })
  it('by/text omitidos → null', async () => {
    const c = mockClient([{ id: 'room1' }])
    await repo.setRecordingConsent(c, APP, TEN, 'room1', { status: 'denied' })
    const params = c.query.mock.calls[0][1]
    expect(params[4]).toBeNull()
    expect(params[5]).toBeNull()
  })
})

describe('insertRoomEvent / listRoomEvents', () => {
  it('insertRoomEvent con 8 params y defaults', async () => {
    const c = mockClient([{ id: 'ev1' }])
    await repo.insertRoomEvent(c, APP, TEN, { roomId: 'r1', toStatus: 'ended' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_telehealth\.room_events/)
    expect(params).toEqual([APP, TEN, 'r1', null, 'ended', null, null, {}])
  })
  it('listRoomEvents filtra por room_id ORDER BY created_at', async () => {
    const c = mockClient([{ id: 'ev1' }])
    await repo.listRoomEvents(c, APP, TEN, 'r1')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/room_id=\$3 ORDER BY created_at/)
    expect(params).toEqual([APP, TEN, 'r1'])
  })
})

describe('session_notes repo', () => {
  it('insertNote con 11 params y defaults', async () => {
    const c = mockClient([{ id: 'n1' }])
    await repo.insertNote(c, APP, TEN, { roomId: 'r1', authorId: 'u1', subjective: 'S' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_telehealth\.session_notes/)
    expect(params[0]).toBe(APP)
    expect(params[2]).toBe('r1')        // roomId
    expect(params[3]).toBeNull()        // bookingId
    expect(params[4]).toBe('u1')        // authorId
    expect(params[5]).toBe('S')         // subjective
    expect(params[10]).toEqual({})      // metadata default
  })
  it('findNoteById scoped; sin row → null', async () => {
    const c = mockClient([])
    expect(await repo.findNoteById(c, APP, TEN, 'n1')).toBeNull()
    expect(c.query.mock.calls[0][0]).toMatch(/WHERE app_id=\$1 AND tenant_id=\$2 AND id=\$3/)
  })
  it('listNotesByRoom filtra por room_id', async () => {
    const c = mockClient([{ id: 'n1' }])
    await repo.listNotesByRoom(c, APP, TEN, 'r1')
    expect(c.query.mock.calls[0][0]).toMatch(/room_id=\$3 ORDER BY created_at/)
  })
  it('updateNote solo si signed_at IS NULL', async () => {
    const c = mockClient([{ id: 'n1' }])
    await repo.updateNote(c, APP, TEN, 'n1', { plan: 'P' })
    expect(c.query.mock.calls[0][0]).toMatch(/signed_at IS NULL/)
  })
  it('signNote stampea signed_at solo si no firmada', async () => {
    const c = mockClient([{ id: 'n1', signed_at: 'now' }])
    const out = await repo.signNote(c, APP, TEN, 'n1')
    const sql = c.query.mock.calls[0][0]
    expect(sql).toMatch(/SET signed_at=now\(\)/)
    expect(sql).toMatch(/signed_at IS NULL/)
    expect(out).toEqual({ id: 'n1', signed_at: 'now' })
  })
})
