// Lógica pura del teclado del TPV — sin React Native, testeable con node.
// El importe se representa en CÉNTIMOS (entero) y se construye dígito a dígito
// como una calculadora de caja: cada tecla desplaza a la izquierda.

// Tope: 999.999,99 € → evita overflow y números absurdos en el display.
export const MAX_CENTS = 99_999_999

export function pressDigit(cents, digit) {
  const d = Number(digit)
  if (!Number.isInteger(d) || d < 0 || d > 9) return cents
  const next = cents * 10 + d
  return next > MAX_CENTS ? cents : next
}

// Tecla "00": desplaza dos posiciones. Si se pasara del tope, no hace nada
// (no truncamos a un valor intermedio para no confundir al cajero).
export function pressDoubleZero(cents) {
  const next = cents * 100
  return next > MAX_CENTS ? cents : next
}

export function backspace(cents) {
  return Math.floor(cents / 10)
}

export function clear() {
  return 0
}

// 1250 → "12,50" (formato es-ES, sin símbolo). El símbolo lo pone la UI.
export function formatAmount(cents) {
  const c = Math.max(0, Math.trunc(cents))
  const euros = Math.floor(c / 100)
  const frac = String(c % 100).padStart(2, '0')
  return `${euros.toLocaleString('es-ES')},${frac}`
}

export function formatEur(cents) {
  return `${formatAmount(cents)} €`
}
