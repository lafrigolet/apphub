import { huellaAlta, huellaAnulacion } from './huella.js'

// Recálculo COMPLETO de la cadena de huellas (full re-hash) — auditoría de
// inalterabilidad (recomendación #9 / TODO A1).
//
// A diferencia de verificarEnlace (que solo comprueba que `huella_anterior`
// apunta a la huella del registro previo, sin recalcular nada), aquí se RECALCULA
// la huella SHA-256 de cada registro a partir de sus campos canónicos
// persistidos (id_emisor, num_serie, fecha_expedicion, tipo_factura, cuota_total,
// importe_total, gen_registro) encadenando con la huella RECALCULADA del registro
// anterior. Detecta:
//   - registros manipulados (cualquier campo cambiado → huella recalculada ≠ persistida)
//   - registros interpolados/insertados retroactivamente (rompen el encadenamiento
//     recalculado, no solo el declarado)
//
// El algoritmo de huella está blindado contra el VECTOR DE TEST OFICIAL de la AEAT
// (ver src/__tests__/huella.test.js). Las filas SIN campos canónicos (p.ej. seed
// de demo previo a la migración 0007) no se pueden recalcular → se marcan
// `no_verificable` (ni ok ni rota) para no producir falsos positivos.
//
// `registros`: filas de listRegistrosParaRehash, ascendente por número.
//   { numero, num_serie, tipo, tipo_factura, id_emisor, fecha_expedicion,
//     cuota_total, importe_total, gen_registro, huella, huella_anterior }
//
// El importe/cuota deben formatearse igual que cuando se calculó la huella
// original. El servicio pasa los valores tal cual se persistieron; pg devuelve
// NUMERIC como string ("121.00"), que es el mismo formato que entró al hash.

function tieneCanonicos(r) {
  return r.id_emisor != null && r.gen_registro != null && r.num_serie != null
}

function recomputar(r, huellaAnteriorRecalculada) {
  const campos = {
    idEmisor: r.id_emisor,
    numSerie: r.num_serie,
    fechaExpedicion: r.fecha_expedicion,
    tipoFactura: r.tipo_factura,
    cuotaTotal: r.cuota_total,
    importeTotal: r.importe_total,
    generadoEn: r.gen_registro,
  }
  return r.tipo === 'anulacion'
    ? huellaAnulacion(campos, huellaAnteriorRecalculada)
    : huellaAlta(campos, huellaAnteriorRecalculada)
}

export function recalcularCadena(registros = []) {
  const orden = [...registros].sort((a, b) => (a.numero ?? 0) - (b.numero ?? 0))
  const rotos = []
  let noVerificables = 0
  let verificados = 0
  // Huella RECALCULADA del último registro verificable (el eslabón con el que
  // debe encadenar el siguiente). null = primer eslabón.
  let huellaPrevRecalc = null

  for (const r of orden) {
    if (!tieneCanonicos(r)) {
      noVerificables++
      // No podemos recalcular; tomamos su huella persistida como eslabón previo
      // para no romper artificialmente la verificación de los siguientes.
      huellaPrevRecalc = r.huella ?? huellaPrevRecalc
      continue
    }

    // Comprueba que el registro declara como anterior la huella del eslabón previo.
    const declarada = r.huella_anterior ?? null
    if (declarada !== huellaPrevRecalc) {
      rotos.push({ numero: r.numero, motivo: 'huella_anterior no enlaza con el registro previo' })
    }

    const recalculada = recomputar(r, huellaPrevRecalc)
    const persistida = r.huella ? String(r.huella).toUpperCase() : null
    if (recalculada !== persistida) {
      rotos.push({ numero: r.numero, motivo: 'la huella recalculada no coincide con la persistida (registro manipulado)' })
    } else {
      verificados++
    }
    huellaPrevRecalc = recalculada
  }

  return { ok: rotos.length === 0, total: orden.length, verificados, noVerificables, rotos }
}
