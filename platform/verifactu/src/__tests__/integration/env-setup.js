// Test DB ephemeral (docker-compose.test.yml) — postgres en 5433.
process.env.DATABASE_URL           ??= 'postgresql://svc_platform_verifactu:platform_verifactu_secret@localhost:5433/splitpay'
process.env.MIGRATION_DATABASE_URL ??= 'postgresql://splitpay:splitpay@localhost:5433/splitpay'
process.env.NODE_ENV                = 'test'
process.env.LOG_LEVEL               = 'error'
