// Setup compartido — corre antes de cualquier fichero de test. Asegura
// que las required env vars de env.js estén presentes para tests que
// importan logger.js u otros módulos sin manipular env directamente.
process.env.MIGRATION_DATABASE_URL  ??= 'postgresql://x:y@localhost:5432/test'
process.env.REDIS_URL               ??= 'redis://localhost:6379'
process.env.PLATFORM_JWT_SECRET     ??= 'test_secret_at_least_32_characters_long_ok'
for (const m of ['AUTH','NOTIFICATIONS','PAYMENTS','TENANT_CONFIG','SPLITPAY','STORAGE','LEADS','DONATIONS','INQUIRIES','VERIFACTU','CHAT','TPV']) {
  process.env[`DATABASE_URL_${m}`]  ??= `postgresql://${m.toLowerCase()}:s@localhost:5432/test`
}
process.env.S3_ENDPOINT             ??= 'http://minio:9000'
process.env.S3_ACCESS_KEY           ??= 'k'
process.env.S3_SECRET_KEY           ??= 's'
process.env.PLATFORM_CORE_PORT      ??= '3000'
