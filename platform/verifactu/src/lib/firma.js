import { SignedXml } from 'xml-crypto'

// Firma electrónica de los registros (modalidad NO_VERIFACTU).
//
// ⚠️ SCAFFOLD — implementa una firma **XMLDSIG enveloped** RSA-SHA256 + c14n,
// que es la BASE de XAdES. Las propiedades cualificadas de **XAdES-EPES**
// (SignedProperties: SigningTime, SigningCertificate digest, SignaturePolicy
// identifier) están PENDIENTES y dependen de la spec oficial de firma de la
// AEAT (TODO C2/C3 · verificar perfil exacto). Sin esas propiedades la AEAT no
// aceptaría la firma — esto solo ejercita el plumbing con un cert (autofirmado
// en dev). https://www.agenciatributaria.es/.../Especificaciones_tecnicas_..._firma_...html

const RSA_SHA256 = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256'
const SHA256     = 'http://www.w3.org/2001/04/xmlenc#sha256'
const C14N       = 'http://www.w3.org/2001/10/xml-exc-c14n#' // exclusive c14n (la usa XAdES)
const ENVELOPED  = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature'

// Firma un XML (enveloped) con la clave/cert PEM dados. Devuelve el XML con el
// nodo <Signature> añadido al final del raíz.
export function firmarXml(xml, { privateKeyPem, certPem }) {
  const sig = new SignedXml({
    privateKey: privateKeyPem,
    signatureAlgorithm: RSA_SHA256,
    canonicalizationAlgorithm: C14N,
  })
  // Incrusta el certificado en <KeyInfo><X509Data><X509Certificate>.
  sig.getKeyInfoContent = () => {
    const body = certPem
      .replace(/-----(BEGIN|END) CERTIFICATE-----/g, '')
      .replace(/\s+/g, '')
    return `<X509Data><X509Certificate>${body}</X509Certificate></X509Data>`
  }
  sig.addReference({
    xpath: "/*",
    digestAlgorithm: SHA256,
    transforms: [ENVELOPED, C14N],
  })
  sig.computeSignature(xml)
  return sig.getSignedXml()
}

// Verifica una firma enveloped. `certPem` es el certificado con el que validar.
// Devuelve true/false (no lanza ante firma inválida).
export function verificarXml(signedXml, certPem) {
  const verifier = new SignedXml()
  verifier.publicCert = certPem
  // Extrae el primer nodo Signature del documento.
  const m = signedXml.match(/<(?:\w+:)?Signature[\s>][\s\S]*<\/(?:\w+:)?Signature>/)
  if (!m) return false
  verifier.loadSignature(m[0])
  try {
    return verifier.checkSignature(signedXml)
  /* c8 ignore next 3 -- defensivo: ante manipulación checkSignature ya devuelve false */
  } catch {
    return false
  }
}
