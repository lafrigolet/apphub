import { createHash } from 'node:crypto'

// ⚠️ STUB — orden/formato de campos NO oficial.
//
// El cálculo real de la huella debe replicar EXACTAMENTE el documento
// "Algoritmo de cálculo de la huella o hash" de la AEAT: el subconjunto de
// campos, su orden, separador, tratamiento de mayúsculas y formato de
// importes/fechas. Cualquier desviación rompe la verificación y la AEAT
// rechaza el registro. Hasta tener esa fuente oficial esto produce una
// huella DETERMINISTA pero NO conforme, suficiente para encadenar la demo.
//
// TODO(fuente-oficial): sustituir composeCadena() por el orden real.
// https://sede.agenciatributaria.gob.es/.../algoritmo-calculo-codificacion-huella-hash.html
function composeCadena(registro, huellaAnterior) {
  // Estructura ILUSTRATIVA — ver aviso arriba.
  return [
    `IDEmisorFactura=${registro.clienteNif ?? ''}`,
    `NumSerieFactura=${registro.numSerie ?? ''}`,
    `FechaExpedicionFactura=${registro.fechaExpedicion ?? ''}`,
    `TipoFactura=${registro.tipoFactura ?? ''}`,
    `CuotaTotal=${registro.cuotaTotal ?? ''}`,
    `ImporteTotal=${registro.importeTotal ?? ''}`,
    `Huella anterior=${huellaAnterior ?? ''}`,
    `FechaHoraHusoGenRegistro=${registro.generadoEn ?? ''}`,
  ].join('&')
}

export function calcularHuella(registro, huellaAnterior) {
  const cadena = composeCadena(registro, huellaAnterior)
  return createHash('sha256').update(cadena, 'utf8').digest('hex').toUpperCase()
}
