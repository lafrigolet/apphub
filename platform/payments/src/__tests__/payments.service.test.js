// El módulo `platform/payments` es hoy un esqueleto: solo expone el
// admin surface para configurar las credenciales Stripe a guardar
// encriptadas (AES-256-GCM via platform-sdk/crypto). El servicio de
// pagos real con PaymentIntents vive en `platform/splitpay`.
//
// Estos tests cubren el contrato actual: el repo de config encripta
// secrets antes de persistir, los descifra al leer, y rechaza keys
// fuera del catálogo permitido (KEYS).

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { encryptSecret, decryptSecret } = vi.hoisted(() => {
  // Stubs deterministas: encrypt envuelve en `enc(...)`, decrypt desenvuelve.
  const enc = vi.fn((s) => Buffer.from(`enc(${s})`, 'utf8'))
  const dec = vi.fn((b) => Buffer.from(b).toString('utf8').replace(/^enc\((.*)\)$/, '$1'))
  return { encryptSecret: enc, decryptSecret: dec }
})

vi.mock('@apphub/platform-sdk/crypto', () => ({
  encryptSecret,
  decryptSecret,
}))

import * as repo from '../repositories/config.repository.js'

function mockClient(rowsByQuery = {}) {
  return {
    query: vi.fn(async (sql, params) => {
      if (/INSERT INTO platform_payments\.config/.test(sql)) {
        return { rowCount: 1 }
      }
      if (/SELECT encrypted_value, plain_value FROM platform_payments\.config WHERE key/.test(sql)) {
        const key = params[0]
        const row = rowsByQuery.byKey?.[key]
        return { rows: row ? [row] : [] }
      }
      if (/SELECT key, encrypted_value, plain_value, updated_at FROM platform_payments\.config/.test(sql)) {
        return { rows: rowsByQuery.list ?? [] }
      }
      return { rows: [] }
    }),
  }
}

beforeEach(() => vi.clearAllMocks())

describe('KEYS — catálogo cerrado de claves permitidas', () => {
  it('expone los dos juegos test/live + stripe_mode', () => {
    expect(repo.KEYS).toEqual([
      'stripe_test_secret_key',
      'stripe_test_publishable_key',
      'stripe_test_webhook_secret',
      'stripe_live_secret_key',
      'stripe_live_publishable_key',
      'stripe_live_webhook_secret',
      'stripe_mode',
    ])
  })

  it('upsertValue rechaza una key fuera del catálogo (defensa contra inyección)', async () => {
    const client = mockClient()
    await expect(
      repo.upsertValue(client, 'malicious_key', 'value', null),
    ).rejects.toThrow(/Unknown payments config key/)
    expect(encryptSecret).not.toHaveBeenCalled()
  })

  it('upsertValue acepta una key del catálogo y la encripta antes de persistir', async () => {
    const client = mockClient()
    await repo.upsertValue(client, 'stripe_test_secret_key', 'sk_test_xyz', 'user-1')
    expect(encryptSecret).toHaveBeenCalledWith('sk_test_xyz')
    // El INSERT recibe el buffer encriptado, NUNCA el plain.
    const [sql, params] = client.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_payments\.config/)
    expect(params[1].toString('utf8')).toBe('enc(sk_test_xyz)')   // nuestro stub
  })
})

describe('getValue — desencripta al leer', () => {
  it('devuelve el plain text desencriptado (secret key)', async () => {
    const client = mockClient({
      byKey: { stripe_live_secret_key: { encrypted_value: Buffer.from('enc(sk_live_real)'), plain_value: null } },
    })
    const v = await repo.getValue(client, 'stripe_live_secret_key')
    expect(decryptSecret).toHaveBeenCalled()
    expect(v).toBe('sk_live_real')
  })

  it('devuelve el plain_value sin desencriptar (stripe_mode)', async () => {
    const client = mockClient({
      byKey: { stripe_mode: { encrypted_value: null, plain_value: 'live' } },
    })
    const v = await repo.getValue(client, 'stripe_mode')
    expect(v).toBe('live')
    expect(decryptSecret).not.toHaveBeenCalled()
  })

  it('devuelve null cuando la key no está configurada (caller usa env fallback)', async () => {
    const client = mockClient()
    const v = await repo.getValue(client, 'stripe_test_secret_key')
    expect(v).toBeNull()
    expect(decryptSecret).not.toHaveBeenCalled()
  })
})

describe('listConfig — surface admin: qué keys están configuradas (sin exponer plain)', () => {
  it('marca configured=true cuando hay encrypted_value, false en blanco', async () => {
    const client = mockClient({
      list: [
        { key: 'stripe_test_publishable_key', encrypted_value: Buffer.from('enc(pk_x)'), plain_value: null, updated_at: new Date('2026-01-01') },
        { key: 'stripe_test_secret_key',      encrypted_value: null,                     plain_value: null, updated_at: null },
        { key: 'stripe_mode',                 encrypted_value: null,                     plain_value: 'live', updated_at: null },
      ],
    })
    const list = await repo.listConfig(client)
    expect(list).toHaveLength(7)
    const byKey = Object.fromEntries(list.map(x => [x.key, x]))
    expect(byKey.stripe_test_publishable_key.configured).toBe(true)
    expect(byKey.stripe_test_secret_key.configured).toBe(false)
    expect(byKey.stripe_live_secret_key.configured).toBe(false)
    // stripe_mode es plain: se expone como value, no como configured.
    expect(byKey.stripe_mode.value).toBe('live')
    // NO incluye el plain en la respuesta de los secretos — la admin UI
    // nunca debe ver el secret, solo si está set o no.
    expect(byKey.stripe_test_publishable_key).not.toHaveProperty('value')
    expect(byKey.stripe_test_publishable_key).not.toHaveProperty('encryptedValue')
  })
})
