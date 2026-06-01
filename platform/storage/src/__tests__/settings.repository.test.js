// settings.repository — config encriptada de platform_storage.settings.
// Secrets (s3_access_key, s3_secret_key) se encriptan con AES-256-GCM antes
// de persistir y se descifran al leer; los plain settings (endpoint, region,
// bucket…) se guardan en plano. Valida getValue/getAll/listForAdmin/upsertValue.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { encryptSecret, decryptSecret } = vi.hoisted(() => ({
  encryptSecret: vi.fn((s) => Buffer.from(`enc(${s})`, 'utf8')),
  decryptSecret: vi.fn((b) => Buffer.from(b).toString('utf8').replace(/^enc\((.*)\)$/, '$1')),
}))

vi.mock('@apphub/platform-sdk/crypto', () => ({ encryptSecret, decryptSecret }))

import * as repo from '../repositories/settings.repository.js'

beforeEach(() => { vi.clearAllMocks() })

function mockClient(rows = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) }
}

describe('getValue', () => {
  it('plain key → devuelve plain_value sin descifrar', async () => {
    const c = mockClient([{ plain_value: 'us-east-1', encrypted_value: null }])
    const v = await repo.getValue(c, 's3_region')
    expect(v).toBe('us-east-1')
    expect(decryptSecret).not.toHaveBeenCalled()
    expect(c.query.mock.calls[0][1]).toEqual(['s3_region'])
  })

  it('secret key → descifra encrypted_value', async () => {
    const c = mockClient([{ encrypted_value: Buffer.from('enc(supersecret)'), plain_value: null }])
    const v = await repo.getValue(c, 's3_secret_key')
    expect(v).toBe('supersecret')
    expect(decryptSecret).toHaveBeenCalled()
  })

  it('sin row → null', async () => {
    const c = mockClient([])
    expect(await repo.getValue(c, 's3_region')).toBeNull()
  })
})

describe('getAll', () => {
  it('descifra secrets y deja plain en plano', async () => {
    const c = mockClient([
      { key: 's3_region', plain_value: 'eu-west-1', encrypted_value: null },
      { key: 's3_access_key', plain_value: null, encrypted_value: Buffer.from('enc(AKIA)') },
    ])
    const out = await repo.getAll(c)
    expect(out).toEqual({ s3_region: 'eu-west-1', s3_access_key: 'AKIA' })
  })

  it('sin rows → objeto vacío', async () => {
    const c = mockClient([])
    expect(await repo.getAll(c)).toEqual({})
  })
})

describe('listForAdmin', () => {
  it('secrets reportan configured:bool (nunca el valor); plain reportan value', async () => {
    const c = mockClient([
      { key: 's3_region', plain_value: 'eu-west-1', encrypted_value: null, updated_at: 'T1' },
      { key: 's3_secret_key', plain_value: null, encrypted_value: Buffer.from('x'), updated_at: 'T2' },
    ])
    const out = await repo.listForAdmin(c)
    const region = out.find((x) => x.key === 's3_region')
    const secret = out.find((x) => x.key === 's3_secret_key')
    const access = out.find((x) => x.key === 's3_access_key')
    expect(region).toEqual({ key: 's3_region', value: 'eu-west-1', updatedAt: 'T1' })
    expect(secret).toEqual({ key: 's3_secret_key', configured: true, updatedAt: 'T2' })
    // missing secret → configured:false, updatedAt:null
    expect(access).toEqual({ key: 's3_access_key', configured: false, updatedAt: null })
    // never leaks the encrypted/plain value of a secret
    expect(secret).not.toHaveProperty('value')
  })

  it('plain key ausente → value:null', async () => {
    const c = mockClient([])
    const out = await repo.listForAdmin(c)
    const bucket = out.find((x) => x.key === 's3_bucket')
    expect(bucket).toEqual({ key: 's3_bucket', value: null, updatedAt: null })
    expect(out).toHaveLength(repo.KEYS.length)
  })
})

describe('upsertValue', () => {
  it('rechaza keys fuera del catálogo', async () => {
    const c = mockClient()
    await expect(repo.upsertValue(c, 'nope', 'x')).rejects.toThrow(/Unknown storage settings key/)
    expect(c.query).not.toHaveBeenCalled()
  })

  it('secret → encripta y borra plain_value en conflicto', async () => {
    const c = mockClient()
    await repo.upsertValue(c, 's3_access_key', 'AKIA')
    expect(encryptSecret).toHaveBeenCalledWith('AKIA')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/encrypted_value = EXCLUDED\.encrypted_value, plain_value = NULL/)
    expect(params[0]).toBe('s3_access_key')
    expect(params[1]).toEqual(Buffer.from('enc(AKIA)', 'utf8'))
  })

  it('plain → guarda en plano y borra encrypted_value en conflicto', async () => {
    const c = mockClient()
    await repo.upsertValue(c, 's3_bucket', 'apphub')
    expect(encryptSecret).not.toHaveBeenCalled()
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/plain_value = EXCLUDED\.plain_value, encrypted_value = NULL/)
    expect(params).toEqual(['s3_bucket', 'apphub'])
  })
})
