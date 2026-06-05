// resend-inbound.service — Receiving API client: stub mode, field
// normalisation, attachment download (direct URL vs listed).
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { fetchReceivedEmail, downloadAttachment } from '../services/resend-inbound.service.js'

beforeEach(() => {
  vi.clearAllMocks()
  global.fetch = vi.fn()
})

describe('fetchReceivedEmail', () => {
  it('stub mode (no apiKey) → null, no network', async () => {
    expect(await fetchReceivedEmail({ apiKey: null, emailId: 'e1' })).toBe(null)
    expect(global.fetch).not.toHaveBeenCalled()
  })
  it('normalises the Receiving API response', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        message_id: '<m1@r>', from: 'Ana <ana@x.com>', to: ['soporte@reply.h.com'],
        reply_to: ['ana@x.com'], subject: 'Hola', text: 'cuerpo', html: '<p>cuerpo</p>',
        headers: { 'in-reply-to': '<o@r>' },
        attachments: [{ id: 'a1', filename: 'doc.pdf', content_type: 'application/pdf', content_id: null, download_url: 'https://dl/a1' }],
      }),
    })
    const e = await fetchReceivedEmail({ apiKey: 're_k', emailId: 're_abc' })
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.resend.com/emails/receiving/re_abc',
      expect.objectContaining({ headers: { Authorization: 'Bearer re_k' } }),
    )
    expect(e).toMatchObject({
      messageId: '<m1@r>', replyTo: 'ana@x.com', text: 'cuerpo',
      attachments: [expect.objectContaining({ id: 'a1', contentType: 'application/pdf', downloadUrl: 'https://dl/a1' })],
    })
  })
  it('throws on non-2xx', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 404 })
    await expect(fetchReceivedEmail({ apiKey: 're_k', emailId: 'x' })).rejects.toThrow('404')
  })
})

describe('downloadAttachment', () => {
  it('uses the attachment download_url directly', async () => {
    global.fetch.mockResolvedValue({ ok: true, arrayBuffer: async () => Buffer.from('BYTES').buffer })
    const buf = await downloadAttachment({ apiKey: 're_k', emailId: 'e1', attachment: { id: 'a1', downloadUrl: 'https://dl/a1' } })
    expect(global.fetch).toHaveBeenCalledWith('https://dl/a1')
    expect(Buffer.isBuffer(buf)).toBe(true)
  })
  it('falls back to listing attachments for a download_url', async () => {
    global.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ id: 'a1', download_url: 'https://dl/listed' }] }) })
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => Buffer.from('X').buffer })
    await downloadAttachment({ apiKey: 're_k', emailId: 'e1', attachment: { id: 'a1' } })
    expect(global.fetch).toHaveBeenNthCalledWith(1,
      'https://api.resend.com/emails/receiving/e1/attachments',
      expect.anything())
    expect(global.fetch).toHaveBeenNthCalledWith(2, 'https://dl/listed')
  })
  it('throws when no download_url can be resolved', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ data: [] }) })
    await expect(downloadAttachment({ apiKey: 're_k', emailId: 'e1', attachment: { id: 'a1' } }))
      .rejects.toThrow('no download_url')
  })
})
