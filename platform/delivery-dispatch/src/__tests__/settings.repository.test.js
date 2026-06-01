// settings.repository — credenciales de carriers (Uber/Glovo/Stuart).
// Valida cifrado de secretos vs plain values, proyección para admin
// (configured flag) y los dos branches del upsert (secret vs plain).
import { describe, it, expect, vi } from 'vitest'

vi.mock('@apphub/platform-sdk/crypto', () => ({
  encryptSecret: vi.fn((v) => Buffer.from(`enc:${v}`)),
  decryptSecret: vi.fn((b) => `dec:${b}`),
}))

import * as repo from '../repositories/settings.repository.js'
import { encryptSecret, decryptSecret } from '@apphub/platform-sdk/crypto'

function mockClient(rows = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) }
}

describe('KEYS', () => {
  it('expone secretos + plain keys', () => {
    expect(repo.KEYS).toContain('uber_client_secret')
    expect(repo.KEYS).toContain('uber_enabled')
  })
})

describe('getValue', () => {
  it('secreto → descifra encrypted_value', async () => {
    const c = mockClient([{ encrypted_value: 'BLOB', plain_value: null }])
    const v = await repo.getValue(c, 'uber_client_secret')
    expect(decryptSecret).toHaveBeenCalledWith('BLOB')
    expect(v).toBe('dec:BLOB')
    expect(c.query.mock.calls[0][1]).toEqual(['uber_client_secret'])
  })

  it('plain → devuelve plain_value sin descifrar', async () => {
    const c = mockClient([{ encrypted_value: null, plain_value: 'sandbox' }])
    const v = await repo.getValue(c, 'uber_environment')
    expect(v).toBe('sandbox')
  })

  it('sin row → null', async () => {
    const c = mockClient([])
    expect(await repo.getValue(c, 'uber_enabled')).toBeNull()
  })
})

describe('getAll', () => {
  it('mapea cada key descifrando los secretos', async () => {
    const c = mockClient([
      { key: 'uber_client_secret', encrypted_value: 'BLOB', plain_value: null },
      { key: 'uber_enabled', encrypted_value: null, plain_value: 'true' },
    ])
    const out = await repo.getAll(c)
    expect(out).toEqual({ uber_client_secret: 'dec:BLOB', uber_enabled: 'true' })
  })
})

describe('listForAdmin', () => {
  it('secretos → solo flag configured (sin exponer valor); plain → value', async () => {
    const c = mockClient([
      { key: 'uber_client_secret', encrypted_value: 'BLOB', plain_value: null, updated_at: 'ts1' },
      { key: 'uber_enabled', encrypted_value: null, plain_value: 'true', updated_at: 'ts2' },
    ])
    const list = await repo.listForAdmin(c)
    const secret = list.find((x) => x.key === 'uber_client_secret')
    const plain  = list.find((x) => x.key === 'uber_enabled')
    expect(secret).toEqual({ key: 'uber_client_secret', configured: true, updatedAt: 'ts1' })
    expect(plain).toEqual({ key: 'uber_enabled', value: 'true', updatedAt: 'ts2' })
    // No expone el valor del secreto
    expect(secret.value).toBeUndefined()
  })

  it('keys sin fila → configured=false / value=null / updatedAt=null', async () => {
    const c = mockClient([])
    const list = await repo.listForAdmin(c)
    const secret = list.find((x) => x.key === 'glovo_api_key')
    const plain  = list.find((x) => x.key === 'glovo_enabled')
    expect(secret).toEqual({ key: 'glovo_api_key', configured: false, updatedAt: null })
    expect(plain).toEqual({ key: 'glovo_enabled', value: null, updatedAt: null })
  })
})

describe('upsertValue', () => {
  it('key desconocida → throw', async () => {
    const c = mockClient()
    await expect(repo.upsertValue(c, 'bogus', 'x')).rejects.toThrow(/Unknown delivery-dispatch settings key/)
  })

  it('secreto → cifra y borra plain_value en conflicto', async () => {
    const c = mockClient()
    await repo.upsertValue(c, 'uber_client_secret', 'shh')
    expect(encryptSecret).toHaveBeenCalledWith('shh')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/encrypted_value = EXCLUDED.encrypted_value, plain_value = NULL/)
    expect(params).toEqual(['uber_client_secret', Buffer.from('enc:shh')])
  })

  it('plain → guarda plain_value y borra encrypted_value en conflicto', async () => {
    const c = mockClient()
    await repo.upsertValue(c, 'uber_environment', 'production')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/plain_value = EXCLUDED.plain_value, encrypted_value = NULL/)
    expect(params).toEqual(['uber_environment', 'production'])
  })
})
