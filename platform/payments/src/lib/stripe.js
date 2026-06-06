import Stripe from 'stripe'
import { pool } from './db.js'
import * as configRepo from '../repositories/config.repository.js'
import { logger } from './logger.js'

const STRIPE_API_VERSION = '2024-06-20'

let _stripe = null
let _secretKey = null
let _mode = 'test'

// Load the active mode + that mode's secret key from the DB. The PLATFORM_STRIPE_*
// env vars remain a fallback for the TEST set only — what lives in env today are
// test credentials, and silently promoting them to live would mean real charges
// with keys never meant for it. Live mode resolves exclusively from the DB.
// Safe to call at register() time and again after a config PATCH. When no key
// is configured we leave _stripe null and the dev-stub takes over.
export async function reloadStripeFromDb() {
  const client = await pool.connect()
  try {
    _mode = (await configRepo.getValue(client, 'stripe_mode')) === 'live' ? 'live' : 'test'
    _secretKey = await configRepo.getValue(client, `stripe_${_mode}_secret_key`)
      ?? (_mode === 'test' ? process.env.PLATFORM_STRIPE_SECRET_KEY : null)
      ?? null
  } finally {
    client.release()
  }
  _stripe = null
  if (_secretKey) {
    _stripe = new Stripe(_secretKey, {
      apiVersion: STRIPE_API_VERSION,
      maxNetworkRetries: 2, // retry transient 429/5xx (CLAUDE.md §3 resilience)
      appInfo: { name: 'AppHub Payments', version: '0.1.0' },
    })
    logger.info({ mode: _mode }, 'Stripe client (re)loaded')
  } else {
    logger.warn({ mode: _mode }, 'Stripe secret key not configured — payments running in DEV-STUB mode (no real charges)')
  }
}

// Active mode as resolved by the last reloadStripeFromDb().
export function getStripeMode() {
  return _mode
}

// True when no Stripe credentials are configured. Callers use this to take the
// dev-stub path instead of hitting the Stripe API (mirrors splitpay behaviour
// of failing soft until staff sets credentials via console).
export function isStubbed() {
  return !_secretKey
}

export function resetStripeClient() {
  _stripe = null
  _secretKey = null
  _mode = 'test'
}

// Webhook signing secret for the ACTIVE mode (Stripe issues a distinct whsec_
// per endpoint/mode). Env fallback only applies to the test set — see
// reloadStripeFromDb for the rationale.
export async function getWebhookSecret() {
  const client = await pool.connect()
  try {
    const mode = (await configRepo.getValue(client, 'stripe_mode')) === 'live' ? 'live' : 'test'
    return await configRepo.getValue(client, `stripe_${mode}_webhook_secret`)
      ?? (mode === 'test' ? process.env.PLATFORM_STRIPE_WEBHOOK_SECRET : null)
      ?? null
  } finally {
    client.release()
  }
}

function ensureStripe() {
  if (_stripe) return _stripe
  throw new Error('Stripe is not configured (no DB row, no env, reloadStripeFromDb() not yet called)')
}

export const stripe = new Proxy({}, {
  get(_t, key) {
    const s = ensureStripe()
    const value = s[key]
    return typeof value === 'function' ? value.bind(s) : value
  },
})

// Expose the constructed Stripe error class for instanceof checks in handlers.
export const StripeErrors = Stripe.errors
