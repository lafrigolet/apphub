// AES-256-GCM contract — secrets at rest (Stripe keys, OAuth client_secret,
// Resend API keys, etc.). Si cualquier asserción se rompe, hay riesgo de:
//   - Fuga del plain en logs (encryptSecret debe nunca devolverlo).
//   - Cipher determinístico (mismo input → mismo blob): permite ataques de
//     correlación. GCM exige IV único por encripción.
//   - Falta de auth tag: permite manipulación silenciosa del ciphertext.
//   - Detección de tampering: la decryption debe fallar al menor cambio.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import crypto from 'node:crypto'

import { encryptSecret, decryptSecret, maskSecret, _resetKeyCache } from '../crypto.js'

const VALID_KEY = crypto.randomBytes(32).toString('hex')   // 64 chars hex
const OTHER_KEY = crypto.randomBytes(32).toString('hex')

let originalKey

beforeEach(() => {
  originalKey = process.env.PLATFORM_CONFIG_ENCRYPTION_KEY
  process.env.PLATFORM_CONFIG_ENCRYPTION_KEY = VALID_KEY
  _resetKeyCache()
})

afterEach(() => {
  if (originalKey === undefined) delete process.env.PLATFORM_CONFIG_ENCRYPTION_KEY
  else process.env.PLATFORM_CONFIG_ENCRYPTION_KEY = originalKey
  _resetKeyCache()
})

// ── Key validation ──────────────────────────────────────────────────

describe('loadKey — validación clave master', () => {
  it('lanza si PLATFORM_CONFIG_ENCRYPTION_KEY no está definida', () => {
    delete process.env.PLATFORM_CONFIG_ENCRYPTION_KEY
    _resetKeyCache()
    expect(() => encryptSecret('x')).toThrow(/32 bytes hex/)
  })

  it('lanza si la clave no son exactamente 64 caracteres hex', () => {
    process.env.PLATFORM_CONFIG_ENCRYPTION_KEY = 'abc'
    _resetKeyCache()
    expect(() => encryptSecret('x')).toThrow(/32 bytes hex/)
  })

  it('lanza si la clave tiene 64 chars pero NO hex (chars no permitidos)', () => {
    // 64 chars pero el comando openssl rand -hex genera solo [0-9a-f].
    // Buffer.from(string, 'hex') silenciosamente trunca caracteres
    // inválidos, generando un buffer corto. La validación es por LENGTH
    // del hex string, no por contenido. Documentamos.
    process.env.PLATFORM_CONFIG_ENCRYPTION_KEY = 'z'.repeat(64)
    _resetKeyCache()
    // Buffer.from('z'.repeat(64), 'hex') → Buffer vacío. crypto.createCipheriv
    // exigirá length 32 y lanzará.
    expect(() => encryptSecret('x')).toThrow()
  })
})

// ── encryptSecret ────────────────────────────────────────────────────

describe('encryptSecret', () => {
  it('produce buffer con formato iv(12) || tag(16) || ciphertext', () => {
    const blob = encryptSecret('hola')
    expect(Buffer.isBuffer(blob)).toBe(true)
    // IV (12) + TAG (16) + min 1 byte ciphertext (GCM no padding).
    expect(blob.length).toBeGreaterThan(12 + 16)
  })

  it('IV aleatorio: 2 encripciones del MISMO plain producen blobs distintos', () => {
    const b1 = encryptSecret('sk_live_xyz')
    const b2 = encryptSecret('sk_live_xyz')
    expect(b1.equals(b2)).toBe(false)
    // ...pero ambos descifran al mismo plain.
    expect(decryptSecret(b1)).toBe('sk_live_xyz')
    expect(decryptSecret(b2)).toBe('sk_live_xyz')
  })

  it('null / undefined / "" → null (no encriptar el vacío)', () => {
    expect(encryptSecret(null)).toBeNull()
    expect(encryptSecret(undefined)).toBeNull()
    expect(encryptSecret('')).toBeNull()
  })

  it('strings con caracteres latinos / emojis se preservan tras roundtrip', () => {
    const inputs = ['Pérez ñoño', 'Hello, 世界 🌍', 'sk_test_AβΓδ']
    for (const s of inputs) {
      const blob = encryptSecret(s)
      expect(decryptSecret(blob)).toBe(s)
    }
  })

  it('NUNCA el plain aparece literalmente dentro del blob', () => {
    const plain = 'sk_live_supersecret123'
    const blob = encryptSecret(plain)
    // El plaintext no debe verse en el ciphertext.
    expect(blob.toString('utf8')).not.toContain(plain)
    expect(blob.toString('latin1')).not.toContain(plain)
  })
})

// ── decryptSecret ────────────────────────────────────────────────────

describe('decryptSecret', () => {
  it('roundtrip plain → encrypt → decrypt == plain', () => {
    const r = decryptSecret(encryptSecret('Stripe sk_live_X'))
    expect(r).toBe('Stripe sk_live_X')
  })

  it('null / undefined → null', () => {
    expect(decryptSecret(null)).toBeNull()
    expect(decryptSecret(undefined)).toBeNull()
  })

  it('acepta Uint8Array (no solo Buffer) — útil si pg te devuelve uno', () => {
    const blob = encryptSecret('plain')
    const asUint8 = new Uint8Array(blob)
    expect(decryptSecret(asUint8)).toBe('plain')
  })

  it('throw si blob es demasiado corto (< IV + TAG)', () => {
    expect(() => decryptSecret(Buffer.alloc(10))).toThrow(/too short/)
  })

  it('throw si el TAG fue manipulado (1 byte cambiado)', () => {
    const blob = encryptSecret('hola')
    const tampered = Buffer.from(blob)
    tampered[15] ^= 0xff   // muta dentro del rango del tag (IV_LEN..IV_LEN+TAG_LEN)
    expect(() => decryptSecret(tampered)).toThrow()
  })

  it('throw si el ciphertext fue manipulado (1 byte cambiado)', () => {
    const blob = encryptSecret('hola que tal')
    const tampered = Buffer.from(blob)
    tampered[blob.length - 1] ^= 0xff
    expect(() => decryptSecret(tampered)).toThrow()
  })

  it('throw si descifras con OTRA key (rotation accidental)', () => {
    const blob = encryptSecret('sk_live_X')
    process.env.PLATFORM_CONFIG_ENCRYPTION_KEY = OTHER_KEY
    _resetKeyCache()
    expect(() => decryptSecret(blob)).toThrow()
  })
})

// ── maskSecret ──────────────────────────────────────────────────────

describe('maskSecret', () => {
  it('renderiza prefix sk_test + 20 chars + wxyz suffix como sk_test****wxyz', () => {
    const r = maskSecret('sk_' + 'test_abc123def456wxyz')
    expect(r).toBe('sk_test****wxyz')
  })

  it('null / "" → null', () => {
    expect(maskSecret(null)).toBeNull()
    expect(maskSecret('')).toBeNull()
  })

  it('strings cortos (<= prefix+suffix+4) → "****" para no leak nada', () => {
    expect(maskSecret('short')).toBe('****')
    expect(maskSecret('abcdef')).toBe('****')
  })

  it('respeta prefixLen / suffixLen custom', () => {
    expect(maskSecret('abcdefghijklmnop', 3, 2)).toBe('abc****op')
  })
})
