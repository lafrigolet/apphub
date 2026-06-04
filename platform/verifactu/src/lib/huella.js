import { createHash } from 'node:crypto'

// Huella (hash) encadenada de los registros VERI·FACTU.
//
// ✅ El orden de campos, nombres de clave, separador y reglas de formato de
// RegistroAlta están BLINDADOS contra el VECTOR DE TEST OFICIAL de la AEAT
// (documento "Algoritmo de cálculo de codificación de la huella o hash"):
// el ejemplo `IDEmisorFactura=89890001K&NumSerieFactura=12345678/G33&…` produce
// el digest `3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60`
// (ver src/__tests__/huella.test.js · "vector oficial AEAT"). Cualquier
// desviación rompe ese test y la AEAT rechazaría el registro.
// https://sede.agenciatributaria.gob.es/.../algoritmo-calculo-codificacion-huella-hash.html
//
// ⚠️ Pendiente de blindar con vector oficial: RegistroAnulacion y RegistroEvento
// (el documento AEAT publica el ejemplo de alta; los demás se infieren del
// esquema y deben confirmarse antes de prod).

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
