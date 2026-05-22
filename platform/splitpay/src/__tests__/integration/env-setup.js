// Test DB ephemeral — postgres on 5433.
process.env.DATABASE_URL                ??= 'postgresql://svc_splitpay_core:splitpay_core_secret@localhost:5433/splitpay'
process.env.MIGRATION_DATABASE_URL      ??= 'postgresql://splitpay:splitpay@localhost:5433/splitpay'
process.env.REDIS_URL                   ??= 'redis://localhost:6380'
process.env.SPLITPAY_STRIPE_SECRET_KEY   = 'sk_test_dummy_for_tests'
process.env.SPLITPAY_STRIPE_WEBHOOK_SECRET = 'whsec_dummy_for_tests'
process.env.PLATFORM_CONFIG_ENCRYPTION_KEY = '0'.repeat(64)
process.env.PLATFORM_JWT_SECRET          = 'platform_dev_secret_at_least_32_characters_long_ok'
process.env.NODE_ENV                     = 'test'
process.env.LOG_LEVEL                    = 'error'
