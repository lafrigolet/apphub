import forge from 'node-forge'

// Carga y gestión de certificados PKCS#12 (.p12/.pfx).
//
// ⚠️ En producción la clave privada vive en vault/HSM, NUNCA en el repo ni en
// disco en claro (TODO C1/C6/L4). Aquí solo parseamos el material que el
// obligado aporta y exponemos su clave/cert en PEM para firmar (firma.js) o
// para el agente mTLS (remision.js).

// Carga un PKCS#12 → { privateKeyPem, certPem, subjectCN, notAfter }.
export function cargarP12(p12Buffer, passphrase) {
  const der = forge.util.createBuffer(p12Buffer.toString('binary'))
  const asn1 = forge.asn1.fromDer(der)
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, passphrase)

  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag]
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag]

  /* c8 ignore next 2 -- guardas defensivas: PKCS#12 malformado (sin clave/cert) */
  if (!keyBags?.length) throw new Error('PKCS#12 sin clave privada')
  if (!certBags?.length) throw new Error('PKCS#12 sin certificado')

  const key = keyBags[0].key
  const cert = certBags[0].cert
  const cn = cert.subject.getField('CN')

  return {
    privateKeyPem: forge.pki.privateKeyToPem(key),
    certPem: forge.pki.certificateToPem(cert),
    /* c8 ignore next -- defensivo: el cert siempre lleva CN en nuestros flujos */
    subjectCN: cn ? cn.value : null,
    notAfter: cert.validity.notAfter,
  }
}

// Genera un PKCS#12 AUTOFIRMADO para DESARROLLO/TESTS. La AEAT lo RECHAZARÁ
// (no está en la Trusted List) — solo sirve para ejercitar el código de firma
// y el cliente mTLS. `bits=1024` por defecto para tests rápidos.
export function generarP12Autofirmado({ commonName = 'SIF DEV', passphrase = 'dev', bits = 1024, notBefore, notAfter } = {}) {
  const keys = forge.pki.rsa.generateKeyPair(bits)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = '01'
  cert.validity.notBefore = notBefore ?? new Date()
  cert.validity.notAfter = notAfter ?? new Date(cert.validity.notBefore.getTime() + 365 * 24 * 60 * 60 * 1000)
  const attrs = [{ name: 'commonName', value: commonName }]
  cert.setSubject(attrs)
  cert.setIssuer(attrs)
  cert.sign(keys.privateKey, forge.md.sha256.create())

  const asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], passphrase, { algorithm: '3des' })
  const der = forge.asn1.toDer(asn1).getBytes()
  return Buffer.from(der, 'binary')
}
