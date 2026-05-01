import Stripe from 'stripe'
import { env } from './env.js'
import { pool } from './db.js'
import * as configRepo from '../repositories/config.repository.js'
import { logger } from './logger.js'

let _stripe = null
let _secretKey = null

// Try to load the secret key from the DB. Falls back to env. Stored in
// _secretKey for the synchronous ensureStripe() call below. Safe to call
// at register() time and again after a config PATCH.
export async function reloadStripeFromDb() {
  const client = await pool.connect()
  try {
    const fromDb = await configRepo.getValue(client, 'stripe_secret_key')
    _secretKey = fromDb ?? env.SPLITPAY_STRIPE_SECRET_KEY ?? null
  } finally {
    client.release()
  }
  _stripe = null
  if (_secretKey) {
    _stripe = new Stripe(_secretKey, {
      apiVersion: '2024-06-20',
      appInfo: { name: 'SplitPay Platform', version: '0.1.0' },
    })
  } else {
    logger.warn('Stripe secret key not configured — set splitpay_core.config.stripe_secret_key via voragine-console')
  }
}

function ensureStripe() {
  if (_stripe) return _stripe
  // Synchronous boot fallback: env-only path. The async reload at register()
  // time is preferred; this handles the (unusual) case where ensureStripe()
  // is called before reloadStripeFromDb() has finished.
  const sk = env.SPLITPAY_STRIPE_SECRET_KEY
  if (!sk) throw new Error('Stripe is not configured (no env, no DB row, reloadStripeFromDb() not yet called)')
  _stripe = new Stripe(sk, {
    apiVersion: '2024-06-20',
    appInfo: { name: 'SplitPay Platform', version: '0.1.0' },
  })
  return _stripe
}

// Reset cached client+key — call after a config PATCH so the next call
// re-reads the DB.
export function resetStripeClient() {
  _stripe = null
  _secretKey = null
}

// Resolve the webhook secret on each call (cheap; webhooks are infrequent).
// Returns null if neither DB nor env is configured.
export async function getWebhookSecret() {
  const client = await pool.connect()
  try {
    const fromDb = await configRepo.getValue(client, 'stripe_webhook_secret')
    return fromDb ?? env.SPLITPAY_STRIPE_WEBHOOK_SECRET ?? null
  } finally {
    client.release()
  }
}

export const stripe = new Proxy({}, {
  get(_t, key) {
    const s = ensureStripe()
    const value = s[key]
    return typeof value === 'function' ? value.bind(s) : value
  },
})
