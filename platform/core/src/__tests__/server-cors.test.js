import { describe, it, expect, beforeEach, vi } from 'vitest'

// Cubre la rama ALLOWED_ORIGINS?.split(',') de server.js (línea 85): cuando
// ALLOWED_ORIGINS está presente, cors recibe el array; cuando ausente, '*'.
// El resto de server.test.js sólo ejercita la rama '*' (env-setup no setea
// ALLOWED_ORIGINS), así que aquí lo seteamos ANTES de importar env.js.
process.env.MIGRATION_DATABASE_URL  ??= 'postgresql://x:y@localhost:5432/test'
process.env.REDIS_URL               ??= 'redis://localhost:6379'
process.env.PLATFORM_JWT_SECRET     ??= 'test_secret_at_least_32_characters_long_ok'
for (const m of [
  'AUTH','NOTIFICATIONS','PAYMENTS','TENANT_CONFIG','SPLITPAY','STORAGE','LEADS','DONATIONS','INQUIRIES','VERIFACTU','CHAT','TPV','COMMERCE',
  'ORDERS','INVENTORY','REVIEWS','MESSAGING','SHIPPING','DISPUTES','CATALOG',
  'MENU','RESERVATIONS','FLOOR_PLAN','KDS','POS','DELIVERY_DISPATCH',
  'SERVICES','RESOURCES','BOOKINGS','AVAILABILITY','INTAKE_FORMS','TELEHEALTH','PACKAGES','PRACTITIONER_PAYOUTS',
]) {
  process.env[`DATABASE_URL_${m}`]  ??= `postgresql://${m.toLowerCase()}:s@localhost:5432/test`
}
process.env.S3_ENDPOINT             ??= 'http://minio:9000'
process.env.S3_ACCESS_KEY           ??= 'k'
process.env.S3_SECRET_KEY           ??= 's'
process.env.PLATFORM_CORE_PORT      ??= '3000'
process.env.ALLOWED_ORIGINS         = 'https://a.com,https://b.com'

const { fastifyApp, fastifyFactory, helmetMock, corsMock, rateLimitMock, swaggerMock, swaggerUiMock, zodMocks, appGuardMock, errorsMock, createPoolMock, ensureModuleRoleMock, createRedisMock, modulesMock } = vi.hoisted(() => {
  const fastifyApp = {
    register: vi.fn().mockResolvedValue(undefined),
    addHook:  vi.fn(),
    get:      vi.fn(),
    setNotFoundHandler:  vi.fn(),
    setErrorHandler:     vi.fn(),
    setValidatorCompiler: vi.fn(),
    setSerializerCompiler: vi.fn(),
    listen:   vi.fn().mockResolvedValue(undefined),
    close:    vi.fn().mockResolvedValue(undefined),
  }
  const fastifyFactory = vi.fn(() => fastifyApp)
  const helmetMock = vi.fn(), corsMock = vi.fn(), rateLimitMock = vi.fn()
  const swaggerMock = vi.fn(), swaggerUiMock = vi.fn()
  const zodMocks = { serializerCompiler: vi.fn(), validatorCompiler: vi.fn(), jsonSchemaTransform: vi.fn() }
  const appGuardMock = vi.fn()
  class AppError extends Error {
    constructor(code, msg, status, details) { super(msg); this.code = code; this.statusCode = status; this.details = details }
  }
  const errorsMock = { AppError }
  const createPoolMock = vi.fn(() => ({ on: vi.fn(), end: vi.fn().mockResolvedValue(undefined) }))
  const ensureModuleRoleMock = vi.fn().mockResolvedValue(undefined)
  const createRedisMock = vi.fn(() => ({ on: vi.fn(), quit: vi.fn().mockResolvedValue(undefined) }))
  const mkModule = (name) => ({ register: vi.fn().mockResolvedValue(undefined), runMigrations: vi.fn().mockResolvedValue(undefined), enforceGrants: null, __name: name })
  const modulesMock = {
    auth: mkModule('auth'), notifications: mkModule('notifications'), payments: mkModule('payments'),
    tenantConfig: mkModule('tenant-config'), splitpay: mkModule('splitpay'), storage: mkModule('storage'),
    leads: mkModule('leads'), donations: mkModule('donations'), inquiries: mkModule('inquiries'),
    verifactu: mkModule('verifactu'), chat: mkModule('chat'), tpv: mkModule('tpv'), commerce: mkModule('commerce'),
    orders: mkModule('orders'), inventory: mkModule('inventory'), reviews: mkModule('reviews'),
    messaging: mkModule('messaging'), shipping: mkModule('shipping'), disputes: mkModule('disputes'),
    catalog: mkModule('catalog'), basket: mkModule('basket'),
    menu: mkModule('menu'), reservations: mkModule('reservations'), floorPlan: mkModule('floor-plan'),
    kds: mkModule('kds'), pos: mkModule('pos'), deliveryDispatch: mkModule('delivery-dispatch'),
    services: mkModule('services'), resources: mkModule('resources'), bookings: mkModule('bookings'),
    availability: mkModule('availability'), intakeForms: mkModule('intake-forms'), telehealth: mkModule('telehealth'),
    packages: mkModule('packages'), practitionerPayouts: mkModule('practitioner-payouts'),
  }
  return { fastifyApp, fastifyFactory, helmetMock, corsMock, rateLimitMock, swaggerMock, swaggerUiMock, zodMocks, appGuardMock, errorsMock, createPoolMock, ensureModuleRoleMock, createRedisMock, modulesMock }
})

vi.mock('fastify',                () => ({ default: fastifyFactory }))
vi.mock('@fastify/helmet',        () => ({ default: helmetMock }))
vi.mock('@fastify/cors',          () => ({ default: corsMock }))
vi.mock('@fastify/rate-limit',    () => ({ default: rateLimitMock }))
vi.mock('@fastify/swagger',       () => ({ default: swaggerMock }))
vi.mock('@fastify/swagger-ui',    () => ({ default: swaggerUiMock }))
vi.mock('fastify-type-provider-zod', () => zodMocks)
vi.mock('@apphub/platform-sdk/app-guard', () => ({ appGuard: appGuardMock }))
vi.mock('@apphub/platform-sdk/errors',    () => errorsMock)
vi.mock('@apphub/platform-sdk/db',        () => ({ createPool: createPoolMock, ensureModuleRole: ensureModuleRoleMock }))
vi.mock('@apphub/platform-sdk/redis',     () => ({ createRedis: createRedisMock }))
vi.mock('@apphub/platform-auth',          () => modulesMock.auth)
vi.mock('@apphub/platform-notifications', () => modulesMock.notifications)
vi.mock('@apphub/platform-payments',      () => modulesMock.payments)
vi.mock('@apphub/platform-tenant-config', () => modulesMock.tenantConfig)
vi.mock('@apphub/platform-splitpay',      () => modulesMock.splitpay)
vi.mock('@apphub/platform-storage',       () => modulesMock.storage)
vi.mock('@apphub/platform-leads',         () => modulesMock.leads)
vi.mock('@apphub/platform-donations',     () => modulesMock.donations)
vi.mock('@apphub/platform-inquiries',     () => modulesMock.inquiries)
vi.mock('@apphub/platform-verifactu',     () => modulesMock.verifactu)
vi.mock('@apphub/platform-chat',          () => modulesMock.chat)
vi.mock('@apphub/platform-tpv',           () => modulesMock.tpv)
vi.mock('@apphub/platform-commerce',      () => modulesMock.commerce)
vi.mock('@apphub/platform-orders',        () => modulesMock.orders)
vi.mock('@apphub/platform-inventory',     () => modulesMock.inventory)
vi.mock('@apphub/platform-reviews',       () => modulesMock.reviews)
vi.mock('@apphub/platform-messaging',     () => modulesMock.messaging)
vi.mock('@apphub/platform-shipping',      () => modulesMock.shipping)
vi.mock('@apphub/platform-disputes',      () => modulesMock.disputes)
vi.mock('@apphub/platform-catalog',       () => modulesMock.catalog)
vi.mock('@apphub/platform-basket',        () => modulesMock.basket)
vi.mock('@apphub/platform-menu',                () => modulesMock.menu)
vi.mock('@apphub/platform-reservations',        () => modulesMock.reservations)
vi.mock('@apphub/platform-floor-plan',          () => modulesMock.floorPlan)
vi.mock('@apphub/platform-kds',                 () => modulesMock.kds)
vi.mock('@apphub/platform-pos',                 () => modulesMock.pos)
vi.mock('@apphub/platform-delivery-dispatch',   () => modulesMock.deliveryDispatch)
vi.mock('@apphub/platform-services',            () => modulesMock.services)
vi.mock('@apphub/platform-resources',           () => modulesMock.resources)
vi.mock('@apphub/platform-bookings',            () => modulesMock.bookings)
vi.mock('@apphub/platform-availability',        () => modulesMock.availability)
vi.mock('@apphub/platform-intake-forms',        () => modulesMock.intakeForms)
vi.mock('@apphub/platform-telehealth',          () => modulesMock.telehealth)
vi.mock('@apphub/platform-packages',            () => modulesMock.packages)
vi.mock('@apphub/platform-practitioner-payouts',() => modulesMock.practitionerPayouts)
vi.mock('@fastify/websocket',             () => ({ default: vi.fn() }))

let exitSpy
beforeEach(() => {
  vi.clearAllMocks()
  fastifyFactory.mockReturnValue(fastifyApp)
  fastifyApp.register.mockResolvedValue(undefined)
  fastifyApp.listen.mockResolvedValue(undefined)
  fastifyApp.close.mockResolvedValue(undefined)
  createPoolMock.mockImplementation(() => ({ on: vi.fn(), end: vi.fn().mockResolvedValue(undefined) }))
  for (const m of Object.values(modulesMock)) {
    m.register.mockResolvedValue(undefined)
    m.runMigrations.mockResolvedValue(undefined)
  }
  exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => { throw new Error(`process.exit(${code})`) })
})

describe('cors origin desde ALLOWED_ORIGINS', () => {
  it('split(",") cuando ALLOWED_ORIGINS está presente → array de orígenes', async () => {
    const { start } = await import('../server.js')
    await start()
    const corsEntry = fastifyApp.register.mock.calls.find((c) => c[0] === corsMock)
    expect(corsEntry).toBeDefined()
    expect(corsEntry[1]).toEqual({ origin: ['https://a.com', 'https://b.com'] })
  })
})
