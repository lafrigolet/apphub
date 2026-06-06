import Stripe from 'stripe'
import { env } from './env.js'
import { pool } from './db.js'
import * as configRepo from '../repositories/config.repository.js'
import { logger } from './logger.js'

let _stripe = null
let _secretKey = null
let _mode = 'test'

// Load the active mode + that mode's secret key from the DB. The
// SPLITPAY_STRIPE_* env vars remain a fallback for the TEST set only — what
// lives in env are test credentials, and silently promoting them to live
// would mean real charges. Live mode resolves exclusively from the DB.
// Stored in _secretKey for the synchronous ensureStripe() call below. Safe to
// call at register() time and again after a config PATCH.
export async function reloadStripeFromDb() {
  const client = await pool.connect()
  try {
    _mode = (await configRepo.getValue(client, 'stripe_mode')) === 'live' ? 'live' : 'test'
    const fromDb = await configRepo.getValue(client, `stripe_${_mode}_secret_key`)
    _secretKey = fromDb
      ?? (_mode === 'test' ? env.SPLITPAY_STRIPE_SECRET_KEY : null)
      ?? null
  } finally {
    client.release()
  }
  _stripe = null
  if (_secretKey) {
    _stripe = new Stripe(_secretKey, {
      apiVersion: '2024-06-20',
      appInfo: { name: 'SplitPay Platform', version: '0.1.0' },
    })
    logger.info({ mode: _mode }, 'Stripe client (re)loaded')
  } else {
    logger.warn({ mode: _mode }, 'Stripe secret key not configured — set splitpay_core.config via console')
  }
}

// Active mode as resolved by the last reloadStripeFromDb().
export function getStripeMode() {
  return _mode
}

function ensureStripe() {
  if (_stripe) return _stripe
  // Synchronous boot fallback: env-only path (test credentials by definition —
  // see reloadStripeFromDb). The async reload at register() time is preferred;
  // this handles the (unusual) case where ensureStripe() is called before
  // reloadStripeFromDb() has finished.
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
  _mode = 'test'
}

// Resolve the ACTIVE mode's webhook secret on each call (cheap; webhooks are
// infrequent). Env fallback only applies to the test set — see
// reloadStripeFromDb. Returns null when nothing is configured.
export async function getWebhookSecret() {
  const client = await pool.connect()
  try {
    const mode = (await configRepo.getValue(client, 'stripe_mode')) === 'live' ? 'live' : 'test'
    const fromDb = await configRepo.getValue(client, `stripe_${mode}_webhook_secret`)
    return fromDb
      ?? (mode === 'test' ? env.SPLITPAY_STRIPE_WEBHOOK_SECRET : null)
      ?? null
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
