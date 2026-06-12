import { SignedXml } from 'xml-crypto'
import { parsePkcs12 } from './pkcs12.js'

// Firma electrónica del RegistroAlta/RegistroAnulacion.
//
// Alcance y matiz legal: en modalidad VERI*FACTU (la única de este módulo, ver
// migración 0006) la firma electrónica del registro NO es obligatoria — los
// registros se remiten a la AEAT, que actúa de tercero de confianza, y el
// elemento `Signature` del XSD es OPCIONAL. La firma XAdES sólo es obligatoria
// para SIF en modalidad NO VERI*FACTU (registros que quedan en local). Aun así
// exponemos la capacidad de firma (útil para NO-Veri*Factu y para sellar la
// exportación legal): firma XML-DSig *enveloped* RSA-SHA256 con canonicalización
// exclusiva y KeyInfo con el X509 del firmante — criptográficamente válida y
// verificable. La capa de propiedades cualificadas XAdES-EPES (identificador de
// política de firma de la AEAT) es el único resto dependiente de la spec de firma
// y se añade encima de esta base cuando se persiga NO-Veri*Factu.

const ALGO = {
  signature: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
  canon:     'http://www.w3.org/2001/10/xml-exc-c14n#',
  digest:    'http://www.w3.org/2001/04/xmlenc#sha256',
  enveloped: 'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
}

// Firma un fragmento XML que contiene un RegistroAlta/RegistroAnulacion. El
// `<ds:Signature>` se añade como hijo del elemento raíz (enveloped). Devuelve el
// XML firmado. `keyPem`/`certPem` salen de un PKCS#12 descifrado.
export function firmarRegistro(xml, { keyPem, certPem, elemento = 'RegistroAlta' } = {}) {
  if (!keyPem || !certPem) throw new Error('firma: certificado (keyPem + certPem) requerido')
  const xpath = `//*[local-name(.)='${elemento}']`

  const sig = new SignedXml({
    privateKey: keyPem,
    publicCert: certPem,
    signatureAlgorithm: ALGO.signature,
    canonicalizationAlgorithm: ALGO.canon,
  })
  sig.addReference({
    xpath,
    transforms: [ALGO.enveloped, ALGO.canon],
    digestAlgorithm: ALGO.digest,
  })
  sig.computeSignature(xml, { location: { reference: xpath, action: 'append' } })
  return sig.getSignedXml()
}

// Conveniencia: firma a partir del material de un PKCS#12 (Buffer DER + passphrase).
export function firmarConPkcs12(xml, { pkcs12, passphrase = '', elemento = 'RegistroAlta' }) {
  const { certPem, keyPem } = parsePkcs12(pkcs12, passphrase)
  return firmarRegistro(xml, { keyPem, certPem, elemento })
}

// Verifica una firma enveloped contra el cert embebido en KeyInfo. Para tests y
// para validar la respuesta/echo de firma. Devuelve { valida, errores }.
export function verificarFirma(signedXml, { certPem } = {}) {
  const doc = signedXml
  const sig = new SignedXml(certPem ? { publicCert: certPem } : {})
  // Localiza el primer <Signature> del documento.
  const match = /<([a-zA-Z0-9]+:)?Signature[ >][\s\S]*?<\/([a-zA-Z0-9]+:)?Signature>/.exec(doc)
  if (!match) return { valida: false, errores: ['sin elemento Signature'] }
  sig.loadSignature(match[0])
  let valida = false
  try { valida = sig.checkSignature(doc) } catch (err) { return { valida: false, errores: [err.message] } }
  return { valida, errores: valida ? [] : ['firma no válida'] }
}
