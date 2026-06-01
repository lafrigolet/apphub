// config.repository — config DB-backed encriptada para notifications.
// Distingue SECRET_KEYS (encrypted_value, AES-GCM) de PLAIN_KEYS
// (plain_value). Valida que upsert encripta solo secrets, que getValue
// descifra solo secrets, y que listConfig nunca expone plain de secrets.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { encryptSecret, decryptSecret } = vi.hoisted(() => ({
  encryptSecret: vi.fn((s) => Buffer.from(`enc(${s})`)),
  decryptSecret: vi.fn((b) => Buffer.from(b).toString('utf8').replace(/^enc\((.*)\)$/, '$1')),
}))
vi.mock('@apphub/platform-sdk/crypto', () => ({ encryptSecret, decryptSecret }))

import * as repo from '../repositories/config.repository.js'

function mockClient(rows = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) }
}

beforeEach(() => vi.clearAllMocks())

describe('KEYS', () => {
  it('incluye secrets y plain keys', () => {
    expect(repo.KEYS).toContain('resend_api_key')
    expect(repo.KEYS).toContain('sender_email')
  })
})

describe('getValue', () => {
  it('secret key → descifra encrypted_value', async () => {
    const c = mockClient([{ encrypted_value: Buffer.from('enc(re_123)'), plain_value: null }])
    const v = await repo.getValue(c, 'resend_api_key')
    expect(decryptSecret).toHaveBeenCalled()
    expect(v).toBe('re_123')
  })

  it('plain key → devuelve plain_value sin descifrar', async () => {
    const c = mockClient([{ encrypted_value: null, plain_value: 'no-reply@x.com' }])
    const v = await repo.getValue(c, 'sender_email')
    expect(decryptSecret).not.toHaveBeenCalled()
    expect(v).toBe('no-reply@x.com')
  })

  it('sin row → null', async () => {
    const c = mockClient([])
    expect(await repo.getValue(c, 'sender_email')).toBeNull()
  })
})

describe('listConfig', () => {
  it('secret configurada → configured=true sin exponer value; plain → value', async () => {
    const c = mockClient([
      { key: 'resend_api_key', encrypted_value: Buffer.from('x'), plain_value: null, updated_at: new Date('2026-01-01') },
      { key: 'sender_email', encrypted_value: null, plain_value: 'a@b.com', updated_at: null },
    ])
    const list = await repo.listConfig(c)
    const byKey = Object.fromEntries(list.map((x) => [x.key, x]))
    expect(byKey.resend_api_key.configured).toBe(true)
    expect(byKey.resend_api_key).not.toHaveProperty('value')
    expect(byKey.sender_email.value).toBe('a@b.com')
    // claves sin row presentes con defaults
    expect(byKey.twilio_account_sid.value).toBeNull()
    expect(byKey.apns_p8_key.configured).toBe(false)
  })
})

describe('upsertValue', () => {
  it('rechaza key fuera del catálogo', async () => {
    await expect(repo.upsertValue(mockClient(), 'evil', 'x')).rejects.toThrow(/Unknown notifications config key/)
  })

  it('secret → encripta y limpia plain_value en el conflict', async () => {
    const c = mockClient()
    await repo.upsertValue(c, 'resend_api_key', 're_live')
    expect(encryptSecret).toHaveBeenCalledWith('re_live')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/plain_value = NULL/)
    expect(params[0]).toBe('resend_api_key')
  })

  it('plain → guarda plain_value y limpia encrypted_value', async () => {
    const c = mockClient()
    await repo.upsertValue(c, 'sender_name', 'AppHub')
    expect(encryptSecret).not.toHaveBeenCalled()
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/encrypted_value = NULL/)
    expect(params).toEqual(['sender_name', 'AppHub'])
  })
})
