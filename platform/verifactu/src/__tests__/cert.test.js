import { describe, it, expect } from 'vitest'
import { generarP12Autofirmado, cargarP12 } from '../lib/cert.js'

describe('cert PKCS#12', () => {
  it('genera y carga un p12 autofirmado', () => {
    const p12 = generarP12Autofirmado({ commonName: 'SIF TEST', passphrase: 'pw', bits: 1024 })
    expect(Buffer.isBuffer(p12)).toBe(true)
    const loaded = cargarP12(p12, 'pw')
    expect(loaded.privateKeyPem).toContain('PRIVATE KEY')
    expect(loaded.certPem).toContain('BEGIN CERTIFICATE')
    expect(loaded.subjectCN).toBe('SIF TEST')
    expect(loaded.notAfter instanceof Date).toBe(true)
  })

  it('passphrase incorrecta lanza', () => {
    const p12 = generarP12Autofirmado({ passphrase: 'right', bits: 1024 })
    expect(() => cargarP12(p12, 'wrong')).toThrow()
  })

  it('respeta notBefore/notAfter explícitos', () => {
    const notBefore = new Date('2027-01-01T00:00:00Z')
    const notAfter = new Date('2028-01-01T00:00:00Z')
    const p12 = generarP12Autofirmado({ passphrase: 'pw', bits: 1024, notBefore, notAfter })
    const loaded = cargarP12(p12, 'pw')
    expect(loaded.notAfter.getUTCFullYear()).toBe(2028)
  })
})
