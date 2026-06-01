// Configuración de cobertura compartida por todos los microservicios de
// platform/*. Mide la LÓGICA de negocio (services, routes, repositories,
// libs con lógica) y excluye el plumbing que no es unit-testable o que se
// cubre por integration:
//   - entry/composition roots: server.js, bootstrap.js, index.js (register)
//   - adaptadores de infra idénticos en todos los módulos y ya testeados en
//     @apphub/platform-sdk: lib/{env,logger,db,redis,migrate}.js
//   - plugins (re-exports del SDK) y ficheros de config.
export const coverage = {
  provider: 'v8',
  include: ['src/**/*.js'],
  exclude: [
    '**/__tests__/**',
    '**/*.config.js',
    'src/server.js',
    'src/bootstrap.js',
    'src/index.js',
    'src/lib/env.js',
    'src/lib/logger.js',
    'src/lib/db.js',
    'src/lib/redis.js',
    'src/lib/migrate.js',
    'src/plugins/**',
  ],
  reporter: ['text', 'text-summary'],
}
