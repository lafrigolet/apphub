// Genera una referencia legible para una consulta: "INQ-20260524-A3B7K2".
// 6 chars base36 ≈ 2.2B combinaciones — anti-collision suficiente para
// muchos miles de consultas por día. La UNIQUE constraint en la DB lo
// captura como reintento si llega a chocar.
import crypto from 'node:crypto'

const PREFIX = 'INQ'
const RANDOM_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'    // sin 0/O/1/I/L (legibilidad por teléfono)
const RANDOM_LEN = 6

export function generateReference(now = new Date()) {
  const y = now.getUTCFullYear()
  const m = String(now.getUTCMonth() + 1).padStart(2, '0')
  const d = String(now.getUTCDate()).padStart(2, '0')
  const ymd = `${y}${m}${d}`

  const bytes = crypto.randomBytes(RANDOM_LEN)
  let suffix = ''
  for (let i = 0; i < RANDOM_LEN; i++) {
    suffix += RANDOM_CHARS[bytes[i] % RANDOM_CHARS.length]
  }
  return `${PREFIX}-${ymd}-${suffix}`
}
