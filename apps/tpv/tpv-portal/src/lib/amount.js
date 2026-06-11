// Lógica pura del teclado (copia de apps/tpv/tpv-app/src/lib/amount.js — el
// monorepo no comparte código con la app Expo, que está fuera del workspace).
export const MAX_CENTS = 99_999_999

export function pressDigit(cents, digit) {
  const d = Number(digit)
  if (!Number.isInteger(d) || d < 0 || d > 9) return cents
  const next = cents * 10 + d
  return next > MAX_CENTS ? cents : next
}

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

export function formatAmount(cents) {
  const c = Math.max(0, Math.trunc(cents))
  const euros = Math.floor(c / 100)
  const frac = String(c % 100).padStart(2, '0')
  return `${euros.toLocaleString('es-ES')},${frac}`
}

export function formatEur(cents) {
  return `${formatAmount(cents)} €`
}
