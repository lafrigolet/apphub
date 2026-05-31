import { createHash } from 'node:crypto'

// Huella (hash) encadenada de los registros VERI·FACTU.
//
// ⚠️ VERIFICAR CONTRA FUENTE OFICIAL — el orden EXACTO de campos, los nombres
// de clave, el tratamiento de importes/fechas y el separador deben replicar el
// documento "Algoritmo de cálculo de codificación de la huella o hash" de la
// AEAT. El orden de abajo se reconstruyó de la página AEAT + el ejemplo oficial
// + resúmenes de terceros; debe blindarse con el VECTOR DE TEST OFICIAL
// (digest esperado) antes de producción. Cualquier desviación rompe la
// verificación y la AEAT rechaza el registro.
// https://sede.agenciatributaria.gob.es/.../algoritmo-calculo-codificacion-huella-hash.html

export const TIPO_HUELLA = '01' // 01 = SHA-256

// Reglas de formato oficiales:
//  - valor recortado de espacios (trim)
//  - campo vacío/ausente → se incluye igualmente como `clave=`
//  - pares `clave=valor` unidos por `&`
//  - SHA-256 sobre la cadena en UTF-8, salida hex en MAYÚSCULAS
function val(v) {
  if (v === null || v === undefined) return ''
  return String(v).trim()
}

function compose(pairs) {
  return pairs.map(([k, v]) => `${k}=${val(v)}`).join('&')
}

function sha256Upper(cadena) {
  return createHash('sha256').update(cadena, 'utf8').digest('hex').toUpperCase()
}

// ── RegistroAlta ──────────────────────────────────────────────────────
export function cadenaAlta(r, huellaAnterior) {
  return compose([
    ['IDEmisorFactura',          r.idEmisor],
    ['NumSerieFactura',          r.numSerie],
    ['FechaExpedicionFactura',   r.fechaExpedicion],
    ['TipoFactura',              r.tipoFactura],
    ['CuotaTotal',               r.cuotaTotal],
    ['ImporteTotal',             r.importeTotal],
    ['Huella',                   huellaAnterior], // huella del registro anterior (vacía en el primer registro)
    ['FechaHoraHusoGenRegistro', r.generadoEn],
  ])
}
export function huellaAlta(r, huellaAnterior) {
  return sha256Upper(cadenaAlta(r, huellaAnterior))
}

// ── RegistroAnulacion ─────────────────────────────────────────────────
export function cadenaAnulacion(r, huellaAnterior) {
  return compose([
    ['IDEmisorFacturaAnulada',        r.idEmisor],
    ['NumSerieFacturaAnulada',        r.numSerie],
    ['FechaExpedicionFacturaAnulada', r.fechaExpedicion],
    ['Huella',                        huellaAnterior],
    ['FechaHoraHusoGenRegistro',      r.generadoEn],
  ])
}
export function huellaAnulacion(r, huellaAnterior) {
  return sha256Upper(cadenaAnulacion(r, huellaAnterior))
}

// ── RegistroEvento ────────────────────────────────────────────────────
// ⚠️ Las claves del evento son especialmente inciertas (SistemaInformatico vs
// ObligadoEmision comparten "NIF" en la fuente) — VERIFICAR antes de usar.
export function cadenaEvento(e, huellaAnterior) {
  return compose([
    ['NIF',                    e.sifNif],
    ['ID',                     e.sifId],
    ['IdSistemaInformatico',   e.idSistemaInformatico],
    ['Version',                e.version],
    ['NumeroInstalacion',      e.numeroInstalacion],
    ['NIFObligado',            e.nifObligado],
    ['TipoEvento',             e.tipoEvento],
    ['HuellaEvento',           huellaAnterior],
    ['FechaHoraHusoGenEvento', e.generadoEn],
  ])
}
export function huellaEvento(e, huellaAnterior) {
  return sha256Upper(cadenaEvento(e, huellaAnterior))
}

// Dispatcher usado por el servicio. `registro.tipo` ∈ {alta, anulacion}.
export function calcularHuella(registro, huellaAnterior) {
  if (registro.tipo === 'anulacion') return huellaAnulacion(registro, huellaAnterior)
  return huellaAlta(registro, huellaAnterior)
}
