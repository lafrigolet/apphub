import { describe, it, expect, beforeAll } from 'vitest'
import forge from 'node-forge'

// La clave de cifrado debe existir antes de importar crypto (la cachea al primer uso).
process.env.PLATFORM_CONFIG_ENCRYPTION_KEY ??= '0'.repeat(64)

import { parsePkcs12, metaResumen, CertificadoError } from '../lib/pkcs12.js'
import * as certRepo from '../repositories/certificados.repository.js'

// Genera un PKCS#12 autofirmado real (CN sujeto + CN emisor) para los tests.
function makeP12(passphrase, { cn = 'ACME SL', issuer = 'FNMT-RCM' } = {}) {
  const keys = forge.pki.rsa.generateKeyPair(1024)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = '0ABC123'
  cert.validity.notBefore = new Date('2026-01-01T00:00:00Z')
  cert.validity.notAfter = new Date('2028-09-14T00:00:00Z')
  cert.setSubject([{ name: 'commonName', value: cn }])
  cert.setIssuer([{ name: 'commonName', value: issuer }])
  cert.sign(keys.privateKey, forge.md.sha256.create())
  const asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], passphrase, { algorithm: '3des' })
  return Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'binary')
}

describe('lib/pkcs12 — parseo y metadatos', () => {
  let der
  beforeAll(() => { der = makeP12('s3cr3t') })

  it('extrae CN, emisor, nº de serie, caducidad y PEMs', () => {
    const m = parsePkcs12(der, 's3cr3t')
    expect(m.cn).toBe('ACME SL')
    expect(m.emisor).toBe('FNMT-RCM')
    expect(m.numeroSerie).toBe('ABC123')               // hex en mayúsculas sin cero a la izquierda
    expect(m.caducaEn.getUTCFullYear()).toBe(2028)
    expect(m.certPem).toContain('BEGIN CERTIFICATE')
    expect(m.keyPem).toContain('PRIVATE KEY')
  })

  it('passphrase incorrecta → CertificadoError (422)', () => {
    expect(() => parsePkcs12(der, 'mala')).toThrow(CertificadoError)
    try { parsePkcs12(der, 'mala') } catch (e) { expect(e.statusCode).toBe(422) }
  })

  it('metaResumen formatea la caducidad', () => {
    expect(metaResumen({ caducaEn: new Date('2028-09-14T00:00:00Z') })).toBe('PKCS#12 · caduca 14-09-2028')
  })
})

describe('certificados.repository — cifrado at-rest round-trip', () => {
  it('persiste el PKCS#12 cifrado (base64) y lo recupera descifrado', async () => {
    const der = makeP12('pw')
    let stored
    // Fake client: captura los params del INSERT y los devuelve en el SELECT.
    const insertClient = { query: async (_sql, params) => {
      stored = params
      return { rows: [{ id: 'cert-1', nombre: 'C', meta: null, estado: 'Vigente', tone: 'ok',
        icon_tone: 'emerald', cn: 'ACME SL', emisor: 'FNMT-RCM', numero_serie: 'ABC123',
        uso: 'firma', activo: true, caduca_en: null }] }
    } }
    await certRepo.insertCertificado(insertClient, {
      appId: 'tpv', tenantId: 't', nombre: 'C', uso: 'firma', pkcs12: der, passphrase: 'pw',
    })
    // pkcs12_cifrado es el 15º placeholder ($15), passphrase_cifrada el 16º ($16).
    const pkcs12Cifrado = stored[14]
    const passphraseCifrada = stored[15]
    expect(Buffer.isBuffer(pkcs12Cifrado)).toBe(true)
    expect(pkcs12Cifrado.equals(der)).toBe(false)       // está cifrado, no en claro

    const selectClient = { query: async () => ({ rows: [{
      id: 'cert-1', cn: 'ACME SL', emisor: 'FNMT-RCM', caduca_en: null,
      pkcs12_cifrado: pkcs12Cifrado, passphrase_cifrada: passphraseCifrada,
    }] }) }
    const material = await certRepo.getCertificadoActivoMaterial(selectClient, { uso: 'firma' })
    expect(material.pkcs12.equals(der)).toBe(true)       // round-trip exacto
    expect(material.passphrase).toBe('pw')
    // y el material descifrado vuelve a parsear
    expect(parsePkcs12(material.pkcs12, material.passphrase).cn).toBe('ACME SL')
  })
})
