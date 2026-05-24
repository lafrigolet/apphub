// Test DB ephemeral (docker-compose.test.yml) — postgres on 5433.
process.env.DATABASE_URL           ??= 'postgresql://svc_platform_inquiries:platform_inquiries_secret@localhost:5433/splitpay'
process.env.MIGRATION_DATABASE_URL ??= 'postgresql://splitpay:splitpay@localhost:5433/splitpay'
process.env.REDIS_URL              ??= 'redis://localhost:6380'
process.env.EXPECTED_APP_ID         = 'platform'
process.env.PLATFORM_JWT_SECRET     = 'platform_dev_secret_at_least_32_characters_long_ok'
process.env.NODE_ENV                = 'test'
process.env.LOG_LEVEL               = 'error'
