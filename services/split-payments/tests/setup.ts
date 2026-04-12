import { vi } from 'vitest'

// Set required environment variables for tests
process.env.NODE_ENV = 'test'
process.env.DATABASE_URL = 'postgresql://localhost:5432/test'
process.env.REDIS_URL = 'redis://localhost:6379/0'
process.env.PAYMENTS_STRIPE_SECRET_KEY = 'sk_test_123'
process.env.PAYMENTS_STRIPE_WEBHOOK_SECRET = 'whsec_123'
process.env.PAYMENTS_STRIPE_PUBLISHABLE_KEY = 'pk_test_123'
process.env.JWT_SECRET = 'a'.repeat(32) // Must be at least 32 chars
process.env.LOG_LEVEL = 'error'
