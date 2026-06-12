// EasyPost REST client — the outbound side of shipping (rate-shopping, label
// purchase, address verification, pickups). EasyPost is a multi-carrier
// aggregator: one API fronts UPS/FedEx/DHL/USPS/Correos/SEUR/… so we integrate
// once and every tenant's preferred carrier is reachable.
//
// We use a thin `fetch` client (Resend pattern) rather than the @easypost/api
// SDK — the REST surface we need is small and this keeps the dependency tree
// flat. Auth is HTTP Basic with the API key as username + empty password.
//
// Credentials live in platform_shipping.settings (easypost_api_key, encrypted;
// easypost_enabled). reloadEasyPostFromDb() is called at register() and again
// after a config PATCH — mirrors payments' reloadStripeFromDb(). When no key is
// configured (or disabled) the module runs in DEV-STUB mode and every outbound
// route fails soft with a clear error instead of hitting the network.
import { pool } from './db.js'
import * as configRepo from '../repositories/settings.repository.js'
import { logger } from './logger.js'
import { AppError } from '../utils/errors.js'

const BASE = 'https://api.easypost.com/v2'
const REQUEST_TIMEOUT_MS = 20000

let _apiKey = null
let _enabled = false

// 502 — the carrier aggregator failed or is unreachable. Distinct from a 4xx
// caused by our own bad input (those surface EasyPost's message verbatim).
export class EasyPostError extends AppError {
  constructor(message, statusCode = 502, details = undefined) {
    super('EASYPOST_ERROR', message, statusCode, details)
    this.name = 'EasyPostError'
  }
}

export class EasyPostNotConfiguredError extends AppError {
  constructor() {
    super('EASYPOST_NOT_CONFIGURED',
      'EasyPost is not configured — set easypost_api_key + easypost_enabled via /v1/shipping/admin/config', 503)
    this.name = 'EasyPostNotConfiguredError'
  }
}

// Load the API key + enabled flag from the DB. Env (EASYPOST_API_KEY) is a
// fallback for local/dev only. Safe to call at register() and after a PATCH.
export async function reloadEasyPostFromDb() {
  const client = await pool.connect()
  try {
    const enabled = await configRepo.getValue(client, 'easypost_enabled')
    _enabled = enabled === 'true' || enabled === true
    _apiKey = (await configRepo.getValue(client, 'easypost_api_key'))
      ?? process.env.EASYPOST_API_KEY
      ?? null
  } finally {
    client.release()
  }
  if (_apiKey && _enabled) logger.info('EasyPost client (re)loaded')
  else logger.warn('EasyPost not configured — shipping outbound integration in DEV-STUB mode (no live rates/labels)')
}

// True when no usable EasyPost credentials are configured. Callers take the
// stub path (or 503) instead of hitting the API.
export function isStubbed() {
  return !_apiKey || !_enabled
}

export function resetEasyPostClient() {
  _apiKey = null
  _enabled = false
}

function authHeader() {
  return 'Basic ' + Buffer.from(`${_apiKey}:`).toString('base64')
}

async function epFetch(path, { method = 'GET', body } = {}) {
  if (isStubbed()) throw new EasyPostNotConfiguredError()
  let res
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
    // Network error / timeout — upstream unreachable.
    throw new EasyPostError(`EasyPost ${method} ${path} unreachable: ${err.message}`)
  }
  const text = await res.text()
  let json
  try { json = text ? JSON.parse(text) : {} } catch { json = { raw: text } }
  if (!res.ok) {
    const msg = json?.error?.message ?? json?.error ?? `EasyPost ${method} ${path} → ${res.status}`
    // 4xx (bad input) is the caller's fault → surface as 422; 5xx → 502.
    const statusCode = res.status >= 400 && res.status < 500 ? 422 : 502
    throw new EasyPostError(typeof msg === 'string' ? msg : JSON.stringify(msg), statusCode, json?.error)
  }
  return json
}

// ── Address verification ──────────────────────────────────────────────────
// EasyPost verifies deliverability and normalizes the address. Returns the
// created address object (with id + verifications).
export async function verifyAddress(address) {
  // EasyPost expects `verify` as an array of checks nested inside the address.
  return epFetch('/addresses', { method: 'POST', body: { address: { ...address, verify: ['delivery'] } } })
}

// ── Rate-shopping ─────────────────────────────────────────────────────────
// Create a (draft) EasyPost Shipment from to/from addresses + a parcel; the
// response carries `rates[]` across every carrier on the account. We don't buy
// here — the caller picks a rate and calls buyShipment().
export async function createShipment({ toAddress, fromAddress, parcel, options, carrierAccounts }) {
  const body = {
    shipment: {
      to_address: toAddress,
      from_address: fromAddress,
      parcel,
      ...(options ? { options } : {}),
      ...(carrierAccounts ? { carrier_accounts: carrierAccounts } : {}),
    },
  }
  return epFetch('/shipments', { method: 'POST', body })
}

// Buy a previously-created shipment's chosen rate → returns the shipment with
// postage_label, tracking_code, tracker, and selected_rate populated.
export async function buyShipment(shipmentId, rateId, insurance) {
  const body = { rate: { id: rateId } }
  if (insurance != null) body.insurance = insurance
  return epFetch(`/shipments/${shipmentId}/buy`, { method: 'POST', body })
}

// ── Pickups ─────────────────────────────────────────────────────────────────
export async function createPickup(pickup) {
  return epFetch('/pickups', { method: 'POST', body: { pickup } })
}

export async function buyPickup(pickupId, { carrier, service }) {
  return epFetch(`/pickups/${pickupId}/buy`, { method: 'POST', body: { carrier, service } })
}

export async function cancelPickup(pickupId) {
  return epFetch(`/pickups/${pickupId}/cancel`, { method: 'POST' })
}

// Fetch the raw bytes of a carrier label (PDF/PNG) so we can archive a copy in
// S3. EasyPost hosts labels at a signed URL with no auth required.
export async function downloadLabel(labelUrl) {
  let res
  try {
    res = await fetch(labelUrl, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  } catch (err) {
    throw new EasyPostError(`label download unreachable: ${err.message}`)
  }
  if (!res.ok) throw new EasyPostError(`label download → ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const contentType = res.headers.get('content-type') ?? 'application/pdf'
  return { buf, contentType }
}
