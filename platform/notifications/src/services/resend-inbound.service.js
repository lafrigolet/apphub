// Resend Receiving API client — the webhook only carries metadata; the full
// message (text/html/headers) and the attachment bytes are pulled on demand.
// Same conventions as resend-domains.service.js: raw fetch (no SDK), throw on
// non-2xx, dev-stub when no API key.
import { logger } from '../lib/logger.js'

const BASE = 'https://api.resend.com'

async function rs(apiKey, path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!res.ok) throw new Error(`resend GET ${path} → ${res.status}`)
  return res.json()
}

// GET /emails/receiving/{id} → normalised content object. Returns null in stub
// mode (no API key) — the pipeline then proceeds with the webhook metadata only.
export async function fetchReceivedEmail({ apiKey, emailId }) {
  if (!apiKey) {
    logger.info({ emailId }, '[dev] resend inbound fetch stubbed (no API key)')
    return null
  }
  const e = await rs(apiKey, `/emails/receiving/${emailId}`)
  return {
    messageId: e.message_id ?? null,
    from: e.from ?? null,
    to: Array.isArray(e.to) ? e.to : (e.to ? [e.to] : []),
    cc: Array.isArray(e.cc) ? e.cc : (e.cc ? [e.cc] : []),
    replyTo: Array.isArray(e.reply_to) ? e.reply_to[0] ?? null : e.reply_to ?? null,
    subject: e.subject ?? null,
    text: e.text ?? null,
    html: e.html ?? null,
    headers: e.headers ?? {},
    attachments: (e.attachments ?? []).map((a) => ({
      id: a.id ?? null,
      filename: a.filename ?? null,
      contentType: a.content_type ?? null,
      contentDisposition: a.content_disposition ?? null,
      contentId: a.content_id ?? null,
      downloadUrl: a.download_url ?? null,
    })),
  }
}

// Attachment bytes. Prefer the download_url already present on the retrieve
// response; otherwise list attachments to obtain one (the Attachments API
// returns metadata + a signed download_url per attachment).
export async function downloadAttachment({ apiKey, emailId, attachment }) {
  let url = attachment.downloadUrl
  if (!url) {
    const listed = await rs(apiKey, `/emails/receiving/${emailId}/attachments`)
    const items = Array.isArray(listed) ? listed : listed?.data ?? []
    const match = items.find((a) => a.id === attachment.id)
    url = match?.download_url ?? null
  }
  if (!url) throw new Error(`no download_url for attachment ${attachment.id}`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`attachment download → ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}
