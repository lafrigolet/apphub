import { calcularHuella } from './huella.js'

// Validación ESTRUCTURAL + de integridad de un registro.
//
// ⚠️ NO es la validación contra el XSD oficial (E2, requiere los XSD de la
// AEAT no descargables automáticamente). Comprueba campos obligatorios,
// coherencia básica de importes y, si el registro declara huella, la recalcula
// y compara. Útil como pre-chequeo antes de firmar/remitir.

const REQUERIDOS = ['idEmisor', 'numSerie', 'fechaExpedicion', 'importeTotal']

export function validarRegistro(reg = {}) {
  const checks = []

  for (const campo of REQUERIDOS) {
    const v = reg[campo]
    if (v === undefined || v === null || String(v).trim() === '') {
      checks.push({ level: 'error', campo, mensaje: `Campo obligatorio ausente: ${campo}` })
    }
  }

  if (reg.cuotaTotal != null && reg.importeTotal != null) {
    const cuota = Number(reg.cuotaTotal)
    const importe = Number(reg.importeTotal)
    if (Number.isFinite(cuota) && Number.isFinite(importe) && cuota > importe) {
      checks.push({ level: 'error', campo: 'cuotaTotal', mensaje: 'CuotaTotal no puede superar ImporteTotal' })
    }
  }

  if (reg.huella) {
    const recomputada = calcularHuella(reg, reg.huellaAnterior ?? null)
    if (recomputada === String(reg.huella).toUpperCase()) {
      checks.push({ level: 'ok', campo: 'huella', mensaje: 'Huella conforme al recálculo' })
    } else {
      checks.push({ level: 'error', campo: 'huella', mensaje: 'La huella no coincide con el recálculo' })
    }
  } else {
    checks.push({ level: 'warn', campo: 'huella', mensaje: 'Sin huella declarada para verificar' })
  }

  const ok = !checks.some((c) => c.level === 'error')
  if (ok) {
    checks.unshift({ level: 'ok', campo: null, mensaje: 'Estructura conforme (validación estructural, no XSD oficial)' })
  }
  return { ok, checks }
}
