// pii-redaction (1.12.4 · P1) — anti-disintermediation: emails y teléfonos en
// el cuerpo del mensaje se enmascaran ANTES de persistir, para que las partes
// no se salgan de la plataforma. Cubre el util `redactPii` y su aplicación en
// `postMessage` (el body que se inserta ya viene redactado).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { redactPii } from '../lib/redact.js'

describe('redactPii — util', () => {
  it('enmascara emails', () => {
    expect(redactPii('escríbeme a juan@gmail.com please')).toBe('escríbeme a [email oculto] please')
  })

  it('enmascara teléfonos (≥9 dígitos, con +/espacios/guiones)', () => {
    expect(redactPii('mi móvil es +34 612 345 678')).toMatch(/\[teléfono oculto\]/)
    expect(redactPii('llámame al 612-345-678')).toMatch(/\[teléfono oculto\]/)
  })

  it('NO enmascara cifras cortas (no son teléfonos)', () => {
    expect(redactPii('tengo 3 gatos y 12 plantas')).toBe('tengo 3 gatos y 12 plantas')
  })

  it('candidato con separadores pero <9 dígitos → NO se enmascara (rama false del ternario)', () => {
    // matchea PHONE_CANDIDATE_RE (≥8 chars con separadores) pero solo 8 dígitos
    const text = 'ref 12.34.56.78 interna'
    expect(redactPii(text)).toBe(text)
    expect(redactPii(text)).not.toContain('[teléfono oculto]')
  })

  it('enmascara email Y teléfono en el mismo texto, conservando el resto', () => {
    const out = redactPii('soy ana@x.com / 600112233, hablamos?')
    expect(out).toContain('[email oculto]')
    expect(out).toContain('[teléfono oculto]')
    expect(out).toContain('hablamos?')
  })

  it('null/undefined → se devuelve tal cual', () => {
    expect(redactPii(null)).toBeNull()
    expect(redactPii(undefined)).toBeUndefined()
  })
})

// ── aplicación en postMessage ──────────────────────────────────────────
const { withTenantTransaction, insertMessageMock, findThreadMock, publishMock } = vi.hoisted(() => ({
  withTenantTransaction: vi.fn(),
  insertMessageMock: vi.fn(),
  findThreadMock: vi.fn(),
  publishMock: vi.fn(),
}))
vi.mock('../lib/db.js', () => ({ pool: {}, withTenantTransaction }))
vi.mock('../lib/redis.js', () => ({ publish: publishMock }))
vi.mock('../repositories/messaging.repository.js', () => ({
  findThreadById: findThreadMock,
  insertMessage: insertMessageMock,
}))

import { postMessage } from '../services/messaging.service.js'

const ctx = { appId: 'mk', tenantId: 't1', subTenantId: null, userId: 'buyer-1', role: 'user' }
const client = {}

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(client))
  findThreadMock.mockResolvedValue({ id: 'th1', buyer_user_id: 'buyer-1', vendor_user_id: 'vendor-1', order_id: 'o1' })
  insertMessageMock.mockResolvedValue({ id: 'm1' })
})

describe('postMessage — persiste el body redactado', () => {
  it('el body insertado tiene email/teléfono enmascarados', async () => {
    await postMessage(ctx, 'th1', 'paga fuera: ana@x.com o al 612345678', [])
    const insertedBody = insertMessageMock.mock.calls[0][5] // (c, app, tenant, thread, user, BODY, attachments)
    expect(insertedBody).toContain('[email oculto]')
    expect(insertedBody).toContain('[teléfono oculto]')
    expect(insertedBody).not.toContain('ana@x.com')
    expect(insertedBody).not.toContain('612345678')
  })

  it('body limpio se inserta sin cambios', async () => {
    await postMessage(ctx, 'th1', '¿cuándo llega mi pedido?', [])
    expect(insertMessageMock.mock.calls[0][5]).toBe('¿cuándo llega mi pedido?')
  })
})
