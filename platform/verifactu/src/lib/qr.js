import QRCode from 'qrcode'

// Genera el QR de la URL de cotejo como data URI PNG.
//
// ⚠️ VERIFICAR — nivel de corrección de errores M (15%) según la spec del QR;
// el tamaño/versión exactos del módulo no están confirmados en la fuente.
export function generarQrDataUri(text, opts = {}) {
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 220,
    ...opts,
  })
}
