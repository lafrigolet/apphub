import forge from 'node-forge'

// Parseo de un certificado PKCS#12 (.p12/.pfx) cualificado para Veri*Factu.
//
// Extrae los metadatos reales del certificado (CN del sujeto, CA emisora, nº de
// serie, caducidad) y devuelve el cert + la clave privada en PEM, que es lo que
// consume la firma XAdES (lib/xades.js) y el agente mTLS de remisión
// (lib/remision.js). La clave privada NUNCA se loguea ni se persiste en claro:
// quien llame guarda el PKCS#12 entero cifrado (AES-256-GCM) y sólo descifra en
// memoria para firmar/remitir.

export class CertificadoError extends Error {
  constructor(message) {
    super(message)
    this.code = 'CERTIFICADO_INVALIDO'
    this.statusCode = 422
    this.name = 'CertificadoError'
  }
}

// Buffer DER → binary string que node-forge espera (latin1 preserva los bytes).
function toForgeBuffer(der) {
  return forge.util.createBuffer(der.toString('binary'))
}

const cnOf = (dn) => dn?.getField?.('CN')?.value ?? null

// PEM (texto) → Buffer PKCS#12 DER es lo que guardamos; aquí hacemos el inverso.
export function parsePkcs12(derBuffer, passphrase = '') {
  let p12
  try {
    const asn1 = forge.asn1.fromDer(toForgeBuffer(derBuffer))
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, passphrase)
  } catch (err) {
    // forge lanza un Error genérico tanto si el fichero no es un PKCS#12 como si
    // la passphrase es incorrecta — no distinguimos para no filtrar información.
    throw new CertificadoError(`PKCS#12 ilegible o passphrase incorrecta: ${err.message}`)
  }

  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? []
  const keyBags = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? []),
  ]
  const cert = certBags[0]?.cert
  const key = keyBags[0]?.key
  if (!cert) throw new CertificadoError('el PKCS#12 no contiene certificado')
  if (!key) throw new CertificadoError('el PKCS#12 no contiene clave privada (¿sólo cadena pública?)')

  return {
    cn: cnOf(cert.subject),
    emisor: cnOf(cert.issuer),
    // serialNumber viene en hex; lo normalizamos en mayúsculas sin ceros sobrantes.
    numeroSerie: (cert.serialNumber || '').toUpperCase().replace(/^0+(?=.)/, '') || null,
    validoDesde: cert.validity?.notBefore ?? null,
    caducaEn: cert.validity?.notAfter ?? null,
    certPem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(key),
  }
}

// Resumen legible para la columna `meta` / la UI: "PKCS#12 · caduca 14-09-2027".
export function metaResumen({ caducaEn }) {
  if (!caducaEn) return 'PKCS#12'
  const d = caducaEn instanceof Date ? caducaEn : new Date(caducaEn)
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `PKCS#12 · caduca ${dd}-${mm}-${d.getUTCFullYear()}`
}
