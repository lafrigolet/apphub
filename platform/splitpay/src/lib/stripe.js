import Stripe from 'stripe'
import { env } from './env.js'

let _stripe = null

function ensureStripe() {
  if (_stripe) return _stripe
  _stripe = new Stripe(env.SPLITPAY_STRIPE_SECRET_KEY, {
    apiVersion: '2024-06-20',
    appInfo: { name: 'SplitPay Platform', version: '0.1.0' },
  })
  return _stripe
}

export const stripe = new Proxy({}, {
  get(_t, key) {
    const s = ensureStripe()
    const value = s[key]
    return typeof value === 'function' ? value.bind(s) : value
  },
})
