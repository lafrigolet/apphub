// Redacción de PII en el cuerpo de los mensajes buyer↔vendor
// (anti-disintermediation): emails y teléfonos se enmascaran para evitar que
// las partes se salgan de la plataforma. Conservador en el lado de
// over-redaction: mejor ocultar de más que filtrar un contacto.

const EMAIL_RE = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g
// Candidato a teléfono: dígito inicial (con + o paréntesis opcional), seguido
// de dígitos/separadores. El recuento real de dígitos se valida en el callback
// (≥ 9) para no enmascarar cifras sueltas como "tengo 3 gatos".
const PHONE_CANDIDATE_RE = /[+(]?\d[\d\s.\-()]{6,}\d/g

export function redactPii(text) {
  if (text == null) return text
  let out = String(text).replace(EMAIL_RE, '[email oculto]')
  out = out.replace(PHONE_CANDIDATE_RE, (m) => {
    const digits = (m.match(/\d/g) ?? []).length
    return digits >= 9 ? '[teléfono oculto]' : m
  })
  return out
}
