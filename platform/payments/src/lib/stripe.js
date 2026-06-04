import Stripe from 'stripe'
import { pool } from './db.js'
import * as configRepo from '../repositories/config.repository.js'
import { logger } from './logger.js'

const STRIPE_API_VERSION = '2024-06-20'

let _stripe = null
let _secretKey = null

// Load the secret key from the DB (env fallback handled by config.repository
// via PLATFORM_STRIPE_* in the caller path). Safe to call at register() time
// and again after a config PATCH. When no key is configured we leave _stripe
// null and the dev-stub takes over (see ensureStripe / isStubbed).
export async function reloadStripeFromDb() {
  const client = await pool.connect()
  try {
    _secretKey = await configRepo.getValue(client, 'stripe_secret_key')
      ?? process.env.PLATFORM_STRIPE_SECRET_KEY
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
  } else {
    logger.warn('Stripe secret key not configured — payments running in DEV-STUB mode (no real charges)')
  }
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
}

export async function getWebhookSecret() {
  const client = await pool.connect()
  try {
    return await configRepo.getValue(client, 'stripe_webhook_secret')
      ?? process.env.PLATFORM_STRIPE_WEBHOOK_SECRET
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
