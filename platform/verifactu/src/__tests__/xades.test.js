import { describe, it, expect, beforeAll } from 'vitest'
import forge from 'node-forge'
import { firmarRegistro, verificarFirma } from '../lib/xades.js'

// Genera un par cert+clave autofirmado (PEM) para firmar/verificar en test.
function makeMaterial() {
  const keys = forge.pki.rsa.generateKeyPair(1024)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = '01'
  cert.validity.notBefore = new Date('2026-01-01T00:00:00Z')
  cert.validity.notAfter = new Date('2028-01-01T00:00:00Z')
  cert.setSubject([{ name: 'commonName', value: 'ACME SL' }])
  cert.setIssuer([{ name: 'commonName', value: 'ACME SL' }])
  cert.sign(keys.privateKey, forge.md.sha256.create())
  return { certPem: forge.pki.certificateToPem(cert), keyPem: forge.pki.privateKeyToPem(keys.privateKey) }
}

const XML = `<RegistroAlta xmlns="urn:x"><IDVersion>1.0</IDVersion><Huella>ABC123</Huella></RegistroAlta>`

describe('lib/xades — firma enveloped RSA-SHA256', () => {
  let mat
  beforeAll(() => { mat = makeMaterial() })

  it('firma el RegistroAlta y embebe un <Signature> con el X509', () => {
    const signed = firmarRegistro(XML, { ...mat, elemento: 'RegistroAlta' })
    expect(signed).toMatch(/<(\w+:)?Signature/)
    expect(signed).toMatch(/<(\w+:)?X509Certificate>/)
    expect(signed).toContain('rsa-sha256')
  })

  it('la firma producida verifica contra su certificado', () => {
    const signed = firmarRegistro(XML, { ...mat, elemento: 'RegistroAlta' })
    const { valida } = verificarFirma(signed, { certPem: mat.certPem })
    expect(valida).toBe(true)
  })

  it('detecta manipulación del contenido firmado', () => {
    const signed = firmarRegistro(XML, { ...mat, elemento: 'RegistroAlta' })
    const tampered = signed.replace('ABC123', 'HACKED')
    const { valida } = verificarFirma(tampered, { certPem: mat.certPem })
    expect(valida).toBe(false)
  })

  it('sin certificado lanza', () => {
    expect(() => firmarRegistro(XML, { keyPem: null, certPem: null })).toThrow(/certificado/)
  })
})
