// settings.repository — secrets encriptados vs plain values en
// platform_shipping.settings. Mock crypto para que enc/dec sea determinista.
import { describe, it, expect, vi } from 'vitest'

vi.mock('@apphub/platform-sdk/crypto', () => ({
  encryptSecret: (v) => Buffer.from(`enc:${v}`),
  decryptSecret: (buf) => buf?.toString().replace(/^enc:/, '') ?? null,
}))

import * as repo from '../repositories/settings.repository.js'

function mockClient(rows = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) }
}

describe('KEYS', () => {
  it('expone secret + plain keys', () => {
    expect(repo.KEYS).toContain('ups_client_secret')
    expect(repo.KEYS).toContain('ups_enabled')
  })
})

describe('getValue', () => {
  it('null cuando no hay fila', async () => {
    const c = mockClient([])
    expect(await repo.getValue(c, 'ups_enabled')).toBeNull()
    expect(c.query.mock.calls[0][1]).toEqual(['ups_enabled'])
  })
  it('secret key → desencripta encrypted_value', async () => {
    const c = mockClient([{ encrypted_value: Buffer.from('enc:topsecret'), plain_value: null }])
    expect(await repo.getValue(c, 'ups_client_secret')).toBe('topsecret')
  })
  it('plain key → devuelve plain_value', async () => {
    const c = mockClient([{ encrypted_value: null, plain_value: 'production' }])
    expect(await repo.getValue(c, 'ups_environment')).toBe('production')
  })
})

describe('getAll', () => {
  it('mapea cada fila según secret/plain', async () => {
    const c = mockClient([
      { key: 'ups_client_secret', encrypted_value: Buffer.from('enc:abc'), plain_value: null },
      { key: 'ups_enabled', encrypted_value: null, plain_value: 'true' },
    ])
    const out = await repo.getAll(c)
    expect(out).toEqual({ ups_client_secret: 'abc', ups_enabled: 'true' })
  })
})

describe('listForAdmin', () => {
  it('secret → configured boolean; plain → value; faltantes → null', async () => {
    const c = mockClient([
      { key: 'ups_client_secret', encrypted_value: Buffer.from('enc:x'), plain_value: null, updated_at: 'ts1' },
      { key: 'ups_enabled', encrypted_value: null, plain_value: 'true', updated_at: 'ts2' },
    ])
    const out = await repo.listForAdmin(c)
    const secret = out.find((x) => x.key === 'ups_client_secret')
    const plain = out.find((x) => x.key === 'ups_enabled')
    const missing = out.find((x) => x.key === 'fedex_api_key')
    expect(secret).toEqual({ key: 'ups_client_secret', configured: true, updatedAt: 'ts1' })
    expect(plain).toEqual({ key: 'ups_enabled', value: 'true', updatedAt: 'ts2' })
    expect(missing).toEqual({ key: 'fedex_api_key', configured: false, updatedAt: null })
    expect(out).toHaveLength(repo.KEYS.length)
  })
})

describe('upsertValue', () => {
  it('lanza en key desconocida', async () => {
    const c = mockClient([])
    await expect(repo.upsertValue(c, 'nope', 'x')).rejects.toThrow(/Unknown shipping settings key/)
  })
  it('secret → INSERT encrypted_value, plain_value NULL', async () => {
    const c = mockClient([])
    await repo.upsertValue(c, 'ups_client_secret', 'mysecret')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/encrypted_value/)
    expect(sql).toMatch(/plain_value = NULL/)
    expect(params[0]).toBe('ups_client_secret')
    expect(params[1].toString()).toBe('enc:mysecret')
  })
  it('plain → INSERT plain_value, encrypted_value NULL', async () => {
    const c = mockClient([])
    await repo.upsertValue(c, 'ups_environment', 'sandbox')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/plain_value/)
    expect(sql).toMatch(/encrypted_value = NULL/)
    expect(params).toEqual(['ups_environment', 'sandbox'])
  })
})
