// nginx-config render (1.5 · P0) — el server block generado para cada app /
// tenant debe ser estructuralmente válido. No hay binario `nginx` en el
// sandbox para `nginx -t`, así que validamos por contrato: directivas
// requeridas presentes, llaves balanceadas y CERO placeholders `{{...}}` sin
// sustituir (un placeholder colgado rompería la recarga de nginx).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { redisMock, loggerMock } = vi.hoisted(() => ({
  redisMock: { hset: vi.fn().mockResolvedValue(1), hdel: vi.fn().mockResolvedValue(1), publish: vi.fn().mockResolvedValue(0) },
  loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('../lib/redis.js', () => ({ redis: redisMock }))
vi.mock('../lib/logger.js', () => ({ logger: loggerMock }))

import {
  writeAppNginxConfig, deleteAppNginxConfig,
  writeTenantNginxConfig, deleteTenantNginxConfig,
} from '../services/nginx-config.service.js'

// Conf escrita a Redis = 3er argumento del HSET (key, field, value).
const writtenConf = () => redisMock.hset.mock.calls[0][2]
const balancedBraces = (s) => (s.match(/\{/g) ?? []).length === (s.match(/\}/g) ?? []).length
const noUnsubstituted = (s) => !/\{\{\w+\}\}/.test(s)

beforeEach(() => vi.clearAllMocks())

describe('writeAppNginxConfig', () => {
  it('renderiza un server block válido: directivas, llaves balanceadas, sin placeholders', async () => {
    await writeAppNginxConfig({ appId: 'aikikan', subdomain: 'aikikan' })
    const conf = writtenConf()
    expect(conf).toMatch(/server \{/)
    expect(conf).toMatch(/listen 80;/)
    expect(conf).toMatch(/server_name aikikan\.hulkstein\.local aikikan\.hulkstein\.com;/)
    expect(conf).toMatch(/include \/etc\/nginx\/snippets\/platform-routes\.conf;/)
    expect(conf).toMatch(/proxy_pass http:\/\/aikikan_portal;/)
    expect(balancedBraces(conf)).toBe(true)
    expect(noUnsubstituted(conf)).toBe(true)
  })

  it('subdomain con guiones → upstream alias con guiones bajos', async () => {
    await writeAppNginxConfig({ appId: 'split-pay', subdomain: 'split-pay' })
    expect(writtenConf()).toMatch(/proxy_pass http:\/\/split_pay_portal;/)
  })

  it('hasServer:false (default) → NO añade el bloque /api/<appId>/', async () => {
    await writeAppNginxConfig({ appId: 'aikikan', subdomain: 'aikikan' })
    expect(writtenConf()).not.toMatch(/location \/api\/aikikan\//)
  })

  it('hasServer:true → añade /api/<appId>/ → <app>_server y sigue balanceado/sin placeholders', async () => {
    await writeAppNginxConfig({ appId: 'aikikan', subdomain: 'aikikan', hasServer: true })
    const conf = writtenConf()
    expect(conf).toMatch(/location \/api\/aikikan\/ \{/)
    expect(conf).toMatch(/proxy_pass http:\/\/aikikan_server\/v1\/aikikan\/;/)
    expect(balancedBraces(conf)).toBe(true)
    expect(noUnsubstituted(conf)).toBe(true)
  })

  it('persiste en Redis (HSET por subdomain) y emite PUBLISH de reload', async () => {
    await writeAppNginxConfig({ appId: 'aikikan', subdomain: 'aikikan' })
    expect(redisMock.hset).toHaveBeenCalledWith('nginx:configs', 'aikikan', expect.any(String))
    expect(redisMock.publish).toHaveBeenCalledWith('nginx:reload', 'aikikan')
  })
})

describe('writeTenantNginxConfig', () => {
  it('server block de tenant → upstream compartido tenant_console_portal, key namespaced', async () => {
    await writeTenantNginxConfig({ tenantId: 't-1', subdomain: 'tienda-ana' })
    const conf = writtenConf()
    expect(conf).toMatch(/proxy_pass http:\/\/tenant_console_portal;/)
    expect(conf).toMatch(/server_name tienda-ana\.hulkstein\.local/)
    expect(balancedBraces(conf)).toBe(true)
    expect(noUnsubstituted(conf)).toBe(true)
    // namespaced bajo `tenant--<subdomain>` para no colisionar con apps
    expect(redisMock.hset).toHaveBeenCalledWith('nginx:configs', 'tenant--tienda-ana', expect.any(String))
  })

  it('sin subdomain → warn y no escribe nada (no rompe el boot/backfill)', async () => {
    await writeTenantNginxConfig({ tenantId: 't-1', subdomain: null })
    expect(redisMock.hset).not.toHaveBeenCalled()
    expect(loggerMock.warn).toHaveBeenCalled()
  })
})

describe('delete helpers', () => {
  it('deleteAppNginxConfig → HDEL del subdomain + PUBLISH', async () => {
    await deleteAppNginxConfig({ subdomain: 'aikikan' })
    expect(redisMock.hdel).toHaveBeenCalledWith('nginx:configs', 'aikikan')
    expect(redisMock.publish).toHaveBeenCalledWith('nginx:reload', 'aikikan')
  })

  it('deleteTenantNginxConfig → HDEL con la key namespaced', async () => {
    await deleteTenantNginxConfig({ subdomain: 'tienda-ana' })
    expect(redisMock.hdel).toHaveBeenCalledWith('nginx:configs', 'tenant--tienda-ana')
  })

  it('deleteTenantNginxConfig sin subdomain → early return (no HDEL)', async () => {
    await deleteTenantNginxConfig({ subdomain: '' })
    expect(redisMock.hdel).not.toHaveBeenCalled()
    expect(redisMock.publish).not.toHaveBeenCalled()
  })
})
