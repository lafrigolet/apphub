// Thin wrapper over Resend's Domains API.
// Docs: https://resend.com/docs/api-reference/domains
//
// In dev / no api key we run in stub mode: synthesise plausible Resend
// CNAMEs so the wizard works end-to-end without contacting the API, and
// validate() returns valid:true. Same dev-bypass convention as email.service.js.
import crypto from 'node:crypto'
import { logger } from '../lib/logger.js'

const BASE = 'https://api.resend.com'

function isStubKey(apiKey) {
  return !apiKey
}

function stubCreateDomain(domain) {
  const tag = crypto.randomBytes(3).toString('hex')
  return {
    providerDomainId: `stub_${tag}`,
    dnsRecords: [
      { key: 'spf',   type: 'txt',   host: `send.${domain}`,          data: 'v=spf1 include:amazonses.com ~all',    valid: false },
      { key: 'dkim1', type: 'cname', host: `resend._domainkey.${domain}`, data: `resend-${tag}.dkim.amazonses.com`, valid: false },
      { key: 'dmarc', type: 'txt',   host: `_dmarc.${domain}`,         data: 'v=DMARC1; p=none;',                    valid: false },
    ],
  }
}

async function rs(apiKey, method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: body != null ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`resend ${method} ${path} → ${res.status}: ${text}`)
  }
  return res.status === 204 ? null : res.json()
}

// Resend returns records as an array of { record, name, type, value, ttl, status, priority? }
// Adapt to the shape we store ({ key, type, host, data, valid }).
function adaptRecords(records) {
  if (!Array.isArray(records)) return []
  return records.map((r, idx) => ({
    key:   r.record ?? `dns${idx}`,
    type:  (r.type ?? 'cname').toLowerCase(),
    host:  r.name,
    data:  r.value,
    valid: r.status === 'verified',
  })).filter((r) => r.host)
}

export async function createBrandedDomain({ apiKey, domain }) {
  if (isStubKey(apiKey)) {
    logger.info({ domain }, '[stub] resend createBrandedDomain — no real API key')
    return stubCreateDomain(domain)
  }
  const r = await rs(apiKey, 'POST', '/domains', { name: domain })
  return {
    providerDomainId: String(r.id),
    dnsRecords:       adaptRecords(r.records),
  }
}

export async function validateBrandedDomain({ apiKey, providerDomainId }) {
  if (isStubKey(apiKey)) {
    logger.info({ providerDomainId }, '[stub] resend validateBrandedDomain — auto-pass')
    return { valid: true, dnsRecords: null }
  }
  // Resend separa POST /verify (dispara la verificación async) y GET /{id}
  // (estado actual). Hacemos los dos: pedimos verificación y leemos estado.
  await rs(apiKey, 'POST', `/domains/${providerDomainId}/verify`).catch(() => null)
  const r = await rs(apiKey, 'GET', `/domains/${providerDomainId}`)
  return {
    valid:      r.status === 'verified',
    dnsRecords: r.records ? adaptRecords(r.records) : null,
  }
}

export async function deleteBrandedDomain({ apiKey, providerDomainId }) {
  if (isStubKey(apiKey)) {
    logger.info({ providerDomainId }, '[stub] resend deleteBrandedDomain')
    return
  }
  await rs(apiKey, 'DELETE', `/domains/${providerDomainId}`)
}
