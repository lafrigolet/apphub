// Redacción de PII y señales de off-platform en el cuerpo de los mensajes
// buyer↔vendor (anti-disintermediation): emails, teléfonos, URLs/handles de
// apps de mensajería externas y redes sociales se enmascaran para evitar que
// las partes se salgan de la plataforma. Conservador en el lado de
// over-redaction: mejor ocultar de más que filtrar un contacto.

const EMAIL_RE = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g
// Candidato a teléfono: dígito inicial (con + o paréntesis opcional), seguido
// de dígitos/separadores. El recuento real de dígitos se valida en el callback
// (≥ 9) para no enmascarar cifras sueltas como "tengo 3 gatos".
const PHONE_CANDIDATE_RE = /[+(]?\d[\d\s.\-()]{6,}\d/g

// URLs (http/https o "www."): cualquier enlace externo es una vía de escape.
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s]+/gi

// Apps de mensajería externas: nombre de la app posiblemente seguido de un
// handle/usuario (whatsapp, telegram, signal, wechat, viber, line, skype).
// Captura tanto la mención suelta ("escríbeme por WhatsApp") como con handle
// ("telegram: @juan").
const MESSAGING_APP_RE =
  /\b(whats[\s.]?app|telegram|signal|wechat|we[\s.]?chat|viber|line|skype)\b(?:\s*[:#-]?\s*@?[\w.+-]+)?/gi

// Handles de redes sociales: "@usuario" suelto o "instagram/IG: @user".
const SOCIAL_PLATFORM_RE =
  /\b(instagram|insta|ig|facebook|fb|twitter|tiktok|snapchat|snap)\b(?:\s*[:#-]?\s*@?[\w.+-]+)?/gi
// "@handle" suelto (≥ 2 chars), pero no parte de un email (esos ya se redactan).
const BARE_HANDLE_RE = /(^|[\s(])@[a-z0-9_.]{2,}/gi

export function redactPii(text) {
  if (text == null) return text
  let out = String(text).replace(EMAIL_RE, '[email oculto]')
  out = out.replace(PHONE_CANDIDATE_RE, (m) => {
    const digits = (m.match(/\d/g) ?? []).length
    return digits >= 9 ? '[teléfono oculto]' : m
  })
  out = out.replace(URL_RE, '[enlace oculto]')
  out = out.replace(MESSAGING_APP_RE, '[contacto externo oculto]')
  out = out.replace(SOCIAL_PLATFORM_RE, '[contacto externo oculto]')
  out = out.replace(BARE_HANDLE_RE, (m, pre) => `${pre}[contacto externo oculto]`)
  return out
}
