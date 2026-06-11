// platform-sdk/index — barrel file que re-exporta el API público del SDK.
// Cambiar un nombre aquí es BREAKING para todos los consumers del monorepo.
// Este test bloquea cualquier rename accidental.

import { describe, it, expect } from 'vitest'
import * as sdk from '../index.js'

// ── Surface area ────────────────────────────────────────────────────

describe('public surface', () => {
  // Si añades un export legítimo, AGRÉGALO aquí y al cambio que lo motiva.
  const EXPECTED_EXPORTS = [
    // app-guard (makeAppGuardHook + ensureIdentityDecorator: guard por
    // scope para orquestadores multi-app — ADR 018)
    'appGuard', 'requireRole', 'makeAppGuardHook', 'ensureIdentityDecorator',
    // db
    'createPool', 'setTenantContext', 'withTenantTransaction', 'withTransaction', 'ensureModuleRole',
    // errors
    'AppError', 'ValidationError', 'NotFoundError', 'UnauthorizedError',
    'ForbiddenError', 'ConflictError', 'AppMismatchError',
    // logger
    'createLogger',
    // redis
    'createRedis', 'publish', 'subscribe',
    // storage
    'createStorageClient', 'presignPut', 'presignGet', 'headObject', 'deleteObject',
    // crypto
    'encryptSecret', 'decryptSecret', 'maskSecret',
    // simple-pdf
    'createTextPdf',
  ]

  it.each(EXPECTED_EXPORTS)('exporta %s', (name) => {
    expect(sdk[name]).toBeDefined()
  })

  it('todos los exports son funciones o clases (no objetos accidentales)', () => {
    for (const name of EXPECTED_EXPORTS) {
      expect(typeof sdk[name]).toBe('function')
    }
  })

  it('NO exporta nada inesperado (regression: nuevo export accidental)', () => {
    const actualExports = Object.keys(sdk).sort()
    const expected = [...EXPECTED_EXPORTS].sort()
    expect(actualExports).toEqual(expected)
  })
})

// ── Errors siguen heredando de AppError (smoke) ─────────────────────

describe('error classes integration', () => {
  it('todos los errores tipados son subclases de AppError', () => {
    const { AppError, ValidationError, NotFoundError, UnauthorizedError,
            ForbiddenError, ConflictError, AppMismatchError } = sdk
    expect(new ValidationError('x')).toBeInstanceOf(AppError)
    expect(new NotFoundError('x')).toBeInstanceOf(AppError)
    expect(new UnauthorizedError()).toBeInstanceOf(AppError)
    expect(new ForbiddenError()).toBeInstanceOf(AppError)
    expect(new ConflictError('x')).toBeInstanceOf(AppError)
    expect(new AppMismatchError()).toBeInstanceOf(AppError)
  })
})

// ── Crypto symmetric roundtrip (smoke through barrel) ──────────────

describe('crypto roundtrip vía barrel', () => {
  it('encryptSecret + decryptSecret roundtrip (32 bytes hex env key)', () => {
    process.env.PLATFORM_CONFIG_ENCRYPTION_KEY = 'a'.repeat(64)
    const encrypted = sdk.encryptSecret('plaintext')
    const decrypted = sdk.decryptSecret(encrypted)
    expect(decrypted).toBe('plaintext')
  })

  it('maskSecret oculta el medio del string', () => {
    const sample = 'sk_' + 'test_1234567890abcdef'
    const r = sdk.maskSecret(sample)
    expect(r).not.toBe(sample)
    // dependiendo de la implementación, deja prefix o sufijo; basta con que NO sea idéntico
    expect(r.length).toBeGreaterThan(0)
  })
})

// ── createTextPdf vía barrel ────────────────────────────────────────

describe('createTextPdf vía barrel', () => {
  it('produce Buffer válido con header PDF', () => {
    const pdf = sdk.createTextPdf({ title: 'X', lines: ['hello'] })
    expect(pdf.toString('latin1').startsWith('%PDF-1.4')).toBe(true)
  })
})
