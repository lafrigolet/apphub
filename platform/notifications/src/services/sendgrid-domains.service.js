// Thin wrapper over SendGrid's "Domain Authentication" REST API.
// Docs: https://docs.sendgrid.com/api-reference/domain-authentication
//
// In dev (no api key configured) we run in stub mode: we synthesise plausible
// CNAMEs so the wizard works end-to-end without contacting SendGrid, and the
// validate() call always returns valid:true. The same email.service.js
// already follows this dev-bypass convention.
import crypto from 'node:crypto'
import { logger } from '../lib/logger.js'

const BASE = 'https://api.sendgrid.com/v3'

function isStubKey(apiKey) {
  return !apiKey || apiKey === 'dev_no_sendgrid'
}

function stubCreateDomain(domain) {
  const tag = crypto.randomBytes(3).toString('hex')
  return {
    providerDomainId: `stub_${tag}`,
    dnsRecords: [
      { type: 'cname', host: `em${tag}.${domain}`,            data: `u${tag}.wl.sendgrid.net`,                  valid: false },
      { type: 'cname', host: `s1._domainkey.${domain}`,        data: `s1.domainkey.u${tag}.wl.sendgrid.net`,    valid: false },
      { type: 'cname', host: `s2._domainkey.${domain}`,        data: `s2.domainkey.u${tag}.wl.sendgrid.net`,    valid: false },
    ],
  }
}

async function sg(apiKey, method, path, body) {
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
    throw new Error(`sendgrid ${method} ${path} → ${res.status}: ${text}`)
  }
  return res.status === 204 ? null : res.json()
}

function flattenSendGridDns(dns) {
  // SendGrid returns { mail_cname:{...}, dkim1:{...}, dkim2:{...} } each with
  // { host, data, valid, type }. Flatten to the array shape we store.
  const out = []
  for (const [k, r] of Object.entries(dns ?? {})) {
    if (!r?.host) continue
    out.push({ key: k, type: r.type ?? 'cname', host: r.host, data: r.data, valid: !!r.valid })
  }
  return out
}

export async function createBrandedDomain({ apiKey, domain }) {
  if (isStubKey(apiKey)) {
    logger.info({ domain }, '[stub] sendgrid createBrandedDomain — no real API key')
    return stubCreateDomain(domain)
  }
  const body = { domain, automatic_security: true }
  const r = await sg(apiKey, 'POST', '/whitelabel/domains', body)
  return {
    providerDomainId: String(r.id),
    dnsRecords: flattenSendGridDns(r.dns),
  }
}

export async function validateBrandedDomain({ apiKey, providerDomainId }) {
  if (isStubKey(apiKey)) {
    logger.info({ providerDomainId }, '[stub] sendgrid validateBrandedDomain — auto-pass')
    return { valid: true, dnsRecords: null }
  }
  const r = await sg(apiKey, 'POST', `/whitelabel/domains/${providerDomainId}/validate`, {})
  return {
    valid: !!r.valid,
    dnsRecords: r.validation_results ? flattenSendGridDns(r.validation_results) : null,
  }
}

export async function deleteBrandedDomain({ apiKey, providerDomainId }) {
  if (isStubKey(apiKey)) {
    logger.info({ providerDomainId }, '[stub] sendgrid deleteBrandedDomain')
    return
  }
  await sg(apiKey, 'DELETE', `/whitelabel/domains/${providerDomainId}`)
}
