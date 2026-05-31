// URL del servicio de cotejo de la AEAT (la que codifica el QR de la factura).
//
// ⚠️ VERIFICAR CONTRA FUENTE OFICIAL — el dominio del servicio, los parámetros,
// su ORDEN, los formatos (fecha DD-MM-AAAA, importe con punto decimal) y el
// nivel de corrección del QR se toman del documento "Características del QR y
// especificaciones del servicio de cotejo" de la AEAT. Las bases de abajo se
// reconstruyeron de la doc + terceros; confirmar antes de producción.
// https://sede.agenciatributaria.gob.es/.../caracteristicas-qr-especificaciones-servicio-cotejo-factura.html

export const COTEJO_BASE = {
  test: 'https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR',
  prod: 'https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR',
}

// Importe: punto decimal, tal cual (pg devuelve NUMERIC como string "121.00").
function fmtImporte(v) {
  if (v === null || v === undefined) return ''
  return String(v).trim()
}

// Orden de parámetros FIJO: nif, numserie, fecha, importe.
export function buildCotejoUrl({ nif, numSerie, fecha, importe, entorno = 'test' }) {
  const base = COTEJO_BASE[entorno] ?? COTEJO_BASE.test
  const qs = [
    ['nif',      nif ?? ''],
    ['numserie', numSerie ?? ''],
    ['fecha',    fecha ?? ''],
    ['importe',  fmtImporte(importe)],
  ]
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&')
  return `${base}?${qs}`
}

// Extrae los parámetros de una URL de cotejo (lo que el receptor pega/escanea).
export function parseCotejoUrl(url) {
  const u = new URL(url)
  const p = u.searchParams
  return {
    nif:      p.get('nif') ?? null,
    numSerie: p.get('numserie') ?? null,
    fecha:    p.get('fecha') ?? null,
    importe:  p.get('importe') ?? null,
  }
}
