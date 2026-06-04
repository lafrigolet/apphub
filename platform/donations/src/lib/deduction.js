// Cálculo de la deducción IRPF por donativos a entidades acogidas a la
// Ley 49/2002, y conteo de años consecutivos de donación (fidelización).
// Funciones puras — la persistencia / consulta SQL vive en el service.
//
// Tramos IRPF vigentes (art. 19 Ley 49/2002, redacción tras RDL 6/2023):
//   * 80 % sobre los primeros 250 € de la base de deducción anual.
//   * Sobre el exceso de 250 €:
//       - 40 % si el donante mantiene o incrementa su donativo al mismo
//         beneficiario durante los dos ejercicios anteriores (es decir,
//         ≥ 3 años consecutivos) — tramo de fidelización.
//       - 35 % en otro caso.
//
// Todo en céntimos para evitar errores de coma flotante.

const FIRST_BRACKET_CENTS = 25000        // 250 €
const RATE_FIRST = 0.80
const RATE_EXCESS_LOYAL = 0.40
const RATE_EXCESS_BASE = 0.35

// La fidelización exige el donativo en los DOS ejercicios anteriores
// (además del actual) — 3 años consecutivos en total.
const LOYALTY_MIN_CONSECUTIVE_YEARS = 3

/**
 * Calcula la deducción IRPF estimada para una base anual en céntimos.
 *
 * @param {number} baseCents  base de deducción (total donado en el año)
 * @param {boolean} loyal     true si aplica el tramo de fidelización (40 %)
 * @returns {{ baseCents:number, firstBracketCents:number, excessCents:number,
 *             excessRate:number, deductibleCents:number, loyal:boolean }}
 */
export function computeIrpfDeduction(baseCents, loyal = false) {
  const base = Math.max(0, Math.round(Number(baseCents) || 0))
  const firstBracketCents = Math.min(base, FIRST_BRACKET_CENTS)
  const excessCents = Math.max(0, base - FIRST_BRACKET_CENTS)
  const excessRate = loyal ? RATE_EXCESS_LOYAL : RATE_EXCESS_BASE

  const deductibleCents = Math.round(
    firstBracketCents * RATE_FIRST + excessCents * excessRate,
  )

  return {
    baseCents: base,
    firstBracketCents,
    excessCents,
    excessRate,
    deductibleCents,
    loyal: !!loyal,
  }
}

/**
 * Dada la lista de años (enteros) en que un donante (por NIF) realizó
 * donativos pagados, y el ejercicio objetivo, determina:
 *   - consecutiveYears: nº de años consecutivos terminando en `targetYear`.
 *   - loyal: si cumple el tramo de fidelización para `targetYear`.
 *
 * @param {number[]} years   años con donativo pagado (cualquier orden, con dups)
 * @param {number} targetYear
 */
export function consecutiveYearsForLoyalty(years, targetYear) {
  const present = new Set(
    (years || []).map((y) => Number(y)).filter((y) => Number.isInteger(y)),
  )
  if (!present.has(targetYear)) {
    return { consecutiveYears: 0, loyal: false }
  }
  let count = 0
  let y = targetYear
  while (present.has(y)) {
    count++
    y--
  }
  return {
    consecutiveYears: count,
    loyal: count >= LOYALTY_MIN_CONSECUTIVE_YEARS,
  }
}

export const DEDUCTION_CONSTANTS = {
  FIRST_BRACKET_CENTS,
  RATE_FIRST,
  RATE_EXCESS_LOYAL,
  RATE_EXCESS_BASE,
  LOYALTY_MIN_CONSECUTIVE_YEARS,
}
