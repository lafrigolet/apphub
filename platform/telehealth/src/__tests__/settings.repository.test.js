// settings.repository — credenciales de video-proveedor (platform_telehealth.settings).
// Secrets (daily_api_key, twilio_api_key_secret, whereby_api_key, jitsi_private_key)
// se encriptan/descifran con AES-256-GCM; los demás son plain. Valida
// getValue/getAll/listForAdmin/upsertValue + rechazo de keys fuera del catálogo.
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
    const c = mockClient([{ plain_value: 'daily', encrypted_value: null }])
    const v = await repo.getValue(c, 'active_provider')
    expect(v).toBe('daily')
    expect(decryptSecret).not.toHaveBeenCalled()
    expect(c.query.mock.calls[0][1]).toEqual(['active_provider'])
  })

  it('secret key → descifra encrypted_value', async () => {
    const c = mockClient([{ encrypted_value: Buffer.from('enc(apikey)'), plain_value: null }])
    const v = await repo.getValue(c, 'daily_api_key')
    expect(v).toBe('apikey')
    expect(decryptSecret).toHaveBeenCalled()
  })

  it('sin row → null', async () => {
    const c = mockClient([])
    expect(await repo.getValue(c, 'active_provider')).toBeNull()
  })
})

describe('getAll', () => {
  it('descifra secrets y deja plain en plano', async () => {
    const c = mockClient([
      { key: 'active_provider', plain_value: 'whereby', encrypted_value: null },
      { key: 'whereby_api_key', plain_value: null, encrypted_value: Buffer.from('enc(WK)') },
    ])
    const out = await repo.getAll(c)
    expect(out).toEqual({ active_provider: 'whereby', whereby_api_key: 'WK' })
  })

  it('sin rows → objeto vacío', async () => {
    const c = mockClient([])
    expect(await repo.getAll(c)).toEqual({})
  })
})

describe('listForAdmin', () => {
  it('secrets reportan configured:bool; plain reportan value', async () => {
    const c = mockClient([
      { key: 'active_provider', plain_value: 'jitsi', encrypted_value: null, updated_at: 'T1' },
      { key: 'jitsi_private_key', plain_value: null, encrypted_value: Buffer.from('x'), updated_at: 'T2' },
    ])
    const out = await repo.listForAdmin(c)
    const provider = out.find((x) => x.key === 'active_provider')
    const secret = out.find((x) => x.key === 'jitsi_private_key')
    const missingSecret = out.find((x) => x.key === 'daily_api_key')
    expect(provider).toEqual({ key: 'active_provider', value: 'jitsi', updatedAt: 'T1' })
    expect(secret).toEqual({ key: 'jitsi_private_key', configured: true, updatedAt: 'T2' })
    expect(missingSecret).toEqual({ key: 'daily_api_key', configured: false, updatedAt: null })
    expect(secret).not.toHaveProperty('value')
    expect(out).toHaveLength(repo.KEYS.length)
  })

  it('plain key ausente → value:null', async () => {
    const c = mockClient([])
    const out = await repo.listForAdmin(c)
    const domain = out.find((x) => x.key === 'daily_domain')
    expect(domain).toEqual({ key: 'daily_domain', value: null, updatedAt: null })
  })
})

describe('upsertValue', () => {
  it('rechaza keys fuera del catálogo', async () => {
    const c = mockClient()
    await expect(repo.upsertValue(c, 'nope', 'x')).rejects.toThrow(/Unknown telehealth settings key/)
    expect(c.query).not.toHaveBeenCalled()
  })

  it('secret → encripta y borra plain_value en conflicto', async () => {
    const c = mockClient()
    await repo.upsertValue(c, 'daily_api_key', 'AK')
    expect(encryptSecret).toHaveBeenCalledWith('AK')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/encrypted_value = EXCLUDED\.encrypted_value, plain_value = NULL/)
    expect(params[0]).toBe('daily_api_key')
    expect(params[1]).toEqual(Buffer.from('enc(AK)', 'utf8'))
  })

  it('plain → guarda en plano y borra encrypted_value en conflicto', async () => {
    const c = mockClient()
    await repo.upsertValue(c, 'active_provider', 'daily')
    expect(encryptSecret).not.toHaveBeenCalled()
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/plain_value = EXCLUDED\.plain_value, encrypted_value = NULL/)
    expect(params).toEqual(['active_provider', 'daily'])
  })
})
