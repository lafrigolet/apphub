// config.repository — splitpay_core.config: secretos cifrados vs plain values.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@apphub/platform-sdk/crypto', () => ({
  encryptSecret: vi.fn((v) => Buffer.from(`enc:${v}`)),
  decryptSecret: vi.fn((b) => `dec:${b}`),
}))

import * as repo from '../repositories/config.repository.js'
import { encryptSecret, decryptSecret } from '@apphub/platform-sdk/crypto'

function mockClient(rows = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) }
}

beforeEach(() => vi.clearAllMocks())

describe('KEYS', () => {
  it('expone los dos juegos test/live + stripe_mode (secret + plain)', () => {
    expect(repo.KEYS).toContain('stripe_test_secret_key')
    expect(repo.KEYS).toContain('stripe_live_secret_key')
    expect(repo.KEYS).toContain('platform_account_id_test')
    expect(repo.KEYS).toContain('platform_account_id_live')
    expect(repo.KEYS).toContain('stripe_mode')
    // Las legacy sin namespace ya no existen (migración 0010 las renombró).
    expect(repo.KEYS).not.toContain('stripe_secret_key')
    expect(repo.KEYS).not.toContain('platform_account_id')
  })
})

describe('getValue', () => {
  it('key secreta → descifra encrypted_value', async () => {
    const c = mockClient([{ encrypted_value: Buffer.from('blob'), plain_value: null }])
    const r = await repo.getValue(c, 'stripe_test_secret_key')
    expect(decryptSecret).toHaveBeenCalled()
    expect(r).toMatch(/^dec:/)
  })

  it('key plana → devuelve plain_value directo', async () => {
    const c = mockClient([{ encrypted_value: null, plain_value: 'acct_123' }])
    const r = await repo.getValue(c, 'platform_account_id_test')
    expect(r).toBe('acct_123')
    expect(decryptSecret).not.toHaveBeenCalled()
  })

  it('sin row → null', async () => {
    const c = mockClient([])
    expect(await repo.getValue(c, 'stripe_test_secret_key')).toBeNull()
  })
})

describe('listConfig', () => {
  it('mapea todas las KEYS: secret→configured flag, plain→value', async () => {
    const c = mockClient([
      { key: 'stripe_test_secret_key', encrypted_value: Buffer.from('x'), plain_value: null, updated_at: 'T1' },
      { key: 'platform_account_id_test', encrypted_value: null, plain_value: 'acct_1', updated_at: 'T2' },
    ])
    const r = await repo.listConfig(c)
    const secret = r.find((x) => x.key === 'stripe_test_secret_key')
    const plain = r.find((x) => x.key === 'platform_account_id_test')
    expect(secret).toEqual({ key: 'stripe_test_secret_key', configured: true, updatedAt: 'T1' })
    expect(plain).toEqual({ key: 'platform_account_id_test', value: 'acct_1', updatedAt: 'T2' })
  })

  it('keys sin row → configured:false / value:null / updatedAt:null', async () => {
    const c = mockClient([])
    const r = await repo.listConfig(c)
    const secret = r.find((x) => x.key === 'stripe_live_webhook_secret')
    const plain = r.find((x) => x.key === 'stripe_live_publishable_key')
    expect(secret).toEqual({ key: 'stripe_live_webhook_secret', configured: false, updatedAt: null })
    expect(plain).toEqual({ key: 'stripe_live_publishable_key', value: null, updatedAt: null })
  })
})

describe('upsertValue', () => {
  it('key desconocida → throw', async () => {
    const c = mockClient()
    await expect(repo.upsertValue(c, 'bogus', 'x')).rejects.toThrow(/Unknown splitpay config key/)
  })

  it('key secreta → cifra y persiste en encrypted_value', async () => {
    const c = mockClient()
    await repo.upsertValue(c, 'stripe_live_secret_key', 'sk_live_x')
    expect(encryptSecret).toHaveBeenCalledWith('sk_live_x')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/encrypted_value/)
    expect(params[0]).toBe('stripe_live_secret_key')
  })

  it('key plana → persiste en plain_value', async () => {
    const c = mockClient()
    await repo.upsertValue(c, 'platform_account_id_test', 'acct_9')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/plain_value/)
    expect(params).toEqual(['platform_account_id_test', 'acct_9'])
    expect(encryptSecret).not.toHaveBeenCalled()
  })
})
