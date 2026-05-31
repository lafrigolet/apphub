import { describe, it, expect, beforeAll } from 'vitest'
import { generarP12Autofirmado, cargarP12 } from '../lib/cert.js'
import { firmarXml, verificarXml } from '../lib/firma.js'

describe('firma XMLDSIG enveloped', () => {
  let privateKeyPem, certPem
  const xml = '<RegistroAlta><IDFactura>2027-A/000128</IDFactura></RegistroAlta>'

  beforeAll(() => {
    const p12 = generarP12Autofirmado({ bits: 1024, passphrase: 'pw' })
    ;({ privateKeyPem, certPem } = cargarP12(p12, 'pw'))
  })

  it('añade un nodo Signature con X509Certificate y SignatureValue', () => {
    const signed = firmarXml(xml, { privateKeyPem, certPem })
    expect(signed).toContain('Signature')
    expect(signed).toContain('X509Certificate')
    expect(signed).toContain('SignatureValue')
  })

  it('la firma verifica con el certificado', () => {
    const signed = firmarXml(xml, { privateKeyPem, certPem })
    expect(verificarXml(signed, certPem)).toBe(true)
  })

  it('la verificación falla si el XML se altera', () => {
    const signed = firmarXml(xml, { privateKeyPem, certPem })
    const tampered = signed.replace('000128', '999999')
    expect(verificarXml(tampered, certPem)).toBe(false)
  })

  it('verificarXml devuelve false si no hay nodo Signature', () => {
    expect(verificarXml('<x/>', certPem)).toBe(false)
  })
})
