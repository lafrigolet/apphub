// AES-256-GCM helper for at-rest encryption of module-level config secrets
// (Stripe keys, OAuth client_secret, SendGrid API keys, S3 access keys, …).
//
// The plaintext is never persisted. We store one BYTEA column per secret as
// `iv (12) || tag (16) || ciphertext`. The master key lives in the env var
// PLATFORM_CONFIG_ENCRYPTION_KEY (32 bytes hex = 64 chars).
//
// Rotation is intentionally out of scope for V1 — when needed, write a job
// that decrypts every row with the old key and re-encrypts with the new one.
import crypto from 'node:crypto'

const ALGO = 'aes-256-gcm'
const IV_LEN = 12
const TAG_LEN = 16
const KEY_LEN = 32

let cachedKey = null

function loadKey() {
  if (cachedKey) return cachedKey
  const hex = process.env.PLATFORM_CONFIG_ENCRYPTION_KEY
  if (!hex || hex.length !== KEY_LEN * 2) {
    throw new Error(
      'PLATFORM_CONFIG_ENCRYPTION_KEY must be 32 bytes hex (64 chars). Generate with: openssl rand -hex 32',
    )
  }
  cachedKey = Buffer.from(hex, 'hex')
  return cachedKey
}

export function encryptSecret(plaintext) {
  if (plaintext == null || plaintext === '') return null
  const key = loadKey()
  const iv = crypto.randomBytes(IV_LEN)
  const cipher = crypto.createCipheriv(ALGO, key, iv)
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, enc])
}

export function decryptSecret(buf) {
  if (buf == null) return null
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf)
  if (buf.length < IV_LEN + TAG_LEN) throw new Error('encrypted blob too short')
  const key = loadKey()
  const iv = buf.subarray(0, IV_LEN)
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN)
  const enc = buf.subarray(IV_LEN + TAG_LEN)
  const decipher = crypto.createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
}

// Renders a secret like "sk_live_****wxyz" so it can be displayed in the UI
// without leaking the full value. Returns null on null/empty.
export function maskSecret(plaintext, prefixLen = 7, suffixLen = 4) {
  if (!plaintext) return null
  if (plaintext.length <= prefixLen + suffixLen + 4) return '****'
  return plaintext.slice(0, prefixLen) + '****' + plaintext.slice(-suffixLen)
}

// Reset the cached key — only useful from tests.
export function _resetKeyCache() {
  cachedKey = null
}
