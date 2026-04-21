// Sets process.env BEFORE env.js validation runs.
// Vitest executes setupFiles before importing any test module.
process.env.DATABASE_URL            ??= 'postgresql://svc_platform_auth:platform_auth_secret@localhost:5432/splitpay'
process.env.MIGRATION_DATABASE_URL  ??= 'postgresql://splitpay:splitpay@localhost:5432/splitpay'
process.env.REDIS_URL               ??= 'redis://localhost:6379'
process.env.PLATFORM_JWT_SECRET      = 'integration_test_secret_at_least_32_characters_long'
process.env.PLATFORM_JWT_REFRESH_DAYS = '30'
process.env.EXPECTED_APP_ID          = 'platform'
process.env.NODE_ENV                 = 'test'
process.env.LOG_LEVEL                = 'error'
