// Verificación del ENLACE de la cadena de huellas (tamper-evident).
//
// Comprueba que cada registro referencia la huella del inmediatamente anterior
// y que el primero no tiene huella anterior. NO recalcula la huella de cada
// registro (eso exige el modelo completo de campos + el FechaHoraHusoGenRegistro
// exacto — futuro, con A1); valida la integridad del encadenamiento declarado.
//
// `registros`: [{ numero, huella, huellaAnterior }]. Se ordenan por `numero` asc.
export function verificarEnlace(registros = []) {
  const orden = [...registros].sort((a, b) => (a.numero ?? 0) - (b.numero ?? 0))
  const rotos = []

  for (let i = 0; i < orden.length; i++) {
    const declarada = orden[i].huellaAnterior ?? null
    if (i === 0) {
      if (declarada) rotos.push({ numero: orden[i].numero, motivo: 'primer registro con huella anterior' })
    } else {
      const anterior = orden[i - 1].huella ?? null
      if (declarada !== anterior) {
        rotos.push({ numero: orden[i].numero, motivo: 'la huella anterior no enlaza con el registro previo' })
      }
    }
  }

  return { ok: rotos.length === 0, total: orden.length, rotos }
}
