// Small, dependency-free helpers for inbound email hygiene:
//   extractReply      — strip quoted history + signature, keep the new text
//   detectAutoReply   — out-of-office / auto-submitted detection (loop guard)
//   parseAddress      — '"Name" <a@b>' → { name, address }
//   parsePlusAddress  — 'reply+tok@d' → { local, token, domain } | null

// Lines that mark the start of quoted history in the common clients.
const QUOTE_MARKERS = [
  /^-{2,}\s*Original Message\s*-{2,}/i,
  /^On .{1,200} wrote:\s*$/i,            // Gmail/Apple Mail
  /^El .{1,200} escribió:\s*$/i,         // Gmail (es)
  /^Le .{1,200} a écrit\s*:\s*$/i,       // Gmail (fr)
  /^-{2,}\s*Mensaje original\s*-{2,}/i,
  /^_{10,}\s*$/,                          // Outlook divider
  /^From:\s.+$/,                          // Outlook top-posting header block
  /^De:\s.+$/,
  /^Sent from my (iPhone|iPad|Android)/i,
  /^Enviado desde mi /i,
]

export function extractReply(text) {
  if (!text) return ''
  const lines = String(text).replace(/\r\n/g, '\n').split('\n')
  const kept = []
  for (const line of lines) {
    // RFC 3676 signature separator: everything after '-- ' is signature.
    if (/^--\s?$/.test(line)) break
    if (line.startsWith('>')) break
    if (QUOTE_MARKERS.some((re) => re.test(line.trim()))) break
    kept.push(line)
  }
  return kept.join('\n').trim()
}

// Headers may arrive as an object map or an array of { name, value }.
export function headerValue(headers, name) {
  if (!headers) return null
  const lower = name.toLowerCase()
  if (Array.isArray(headers)) {
    const h = headers.find((x) => String(x?.name ?? '').toLowerCase() === lower)
    return h?.value ?? null
  }
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return v
  }
  return null
}

// True for vacation responders, delivery notifications and list automation.
// Auto-replies are archived without firing domain events — answering an
// auto-reply with another notification is how mail loops start.
export function detectAutoReply({ headers, fromAddress, subject } = {}) {
  const auto = headerValue(headers, 'auto-submitted')
  if (auto && String(auto).toLowerCase() !== 'no') return true
  if (headerValue(headers, 'x-autoreply') || headerValue(headers, 'x-autorespond')) return true
  const precedence = String(headerValue(headers, 'precedence') ?? '').toLowerCase()
  if (['auto_reply', 'bulk', 'junk', 'list'].includes(precedence)) return true
  if (headerValue(headers, 'list-id') || headerValue(headers, 'list-unsubscribe')) return true
  const from = String(fromAddress ?? '').toLowerCase()
  if (/^(mailer-daemon|postmaster|no-?reply|do-?not-?reply)@/.test(from)) return true
  if (/^(auto(matic)?[ -]?(reply|response)|out of (the )?office|respuesta automática)/i.test(String(subject ?? ''))) return true
  return false
}

export function parseAddress(raw) {
  if (!raw) return { name: null, address: null }
  const s = String(raw).trim()
  const m = s.match(/^"?([^"<]*)"?\s*<([^>]+)>$/)
  if (m) return { name: m[1].trim() || null, address: m[2].trim().toLowerCase() }
  return { name: null, address: s.toLowerCase() }
}

// reply+<token>@domain → { local: 'reply', token, domain }; null when the
// address has no plus tag.
export function parsePlusAddress(address) {
  const m = String(address ?? '').toLowerCase().match(/^([^+@]+)\+([^@]+)@(.+)$/)
  if (!m) return null
  return { local: m[1], token: m[2], domain: m[3] }
}
