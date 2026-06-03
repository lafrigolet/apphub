// Redacción opcional de PII en el cuerpo de los mensajes. A diferencia del
// módulo `messaging` (donde la redacción es anti-disintermediation y siempre
// activa), en el chat de miembros está DESACTIVADA por defecto y se habilita
// por tenant via settings.redaction_enabled. Conservador hacia over-redaction.

const EMAIL_RE = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g
// Candidato a teléfono: dígito inicial (con + o paréntesis opcional) seguido de
// dígitos/separadores. El recuento real de dígitos se valida en el callback
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
