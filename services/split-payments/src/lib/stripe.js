import Stripe from 'stripe'
import { env } from './env.js'

export const stripe = new Stripe(env.PAYMENTS_STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
  appInfo: {
    name: 'SplitPay Platform',
    version: '0.1.0',
  },
})
