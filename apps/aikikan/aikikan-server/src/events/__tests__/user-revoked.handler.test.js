// Subscriber a `user.revoked` (de platform-auth) + `auth.signup.rejected`.
// Contrato:
//   - Solo procesa eventos cuyo `payload.appId === EXPECTED_APP_ID`.
//   - Ignora eventos de tipos no esperados, payloads malformados.
//   - Llama a members.deleteMember con (appId, tenantId, subTenantId, userId).
//   - Errores del service NO propagan (no rompen el subscriber).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { redisSubscribeMock, redisConnectMock, redisOnMock, redisSubMock, capturedHandlers } = vi.hoisted(() => {
  const handlers = {}
  return {
    capturedHandlers: handlers,
    redisConnectMock:   vi.fn().mockResolvedValue(undefined),
    redisSubscribeMock: vi.fn((_chan, cb) => cb && cb(null)),
    redisOnMock:        vi.fn((evt, h) => { handlers[evt] = h }),
    redisSubMock:       null,
  }
})

vi.mock('../../lib/env.js', () => ({
  env: { REDIS_URL: 'redis://localhost:6379', EXPECTED_APP_ID: 'aikikan' },
}))
vi.mock('../../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('ioredis', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      connect:    redisConnectMock,
      on:         redisOnMock,
      subscribe:  redisSubscribeMock,
      quit:       vi.fn().mockResolvedValue(undefined),
    })),
  }
})

const { deleteMemberMock } = vi.hoisted(() => ({ deleteMemberMock: vi.fn() }))
vi.mock('../../services/members.service.js', () => ({ deleteMember: deleteMemberMock }))

import { startUserRevokedSubscriber } from '../user-revoked.handler.js'

beforeEach(() => {
  vi.clearAllMocks()
  for (const k of Object.keys(capturedHandlers)) delete capturedHandlers[k]
})

afterEach(() => {})

const APP = 'aikikan'
const TENANT = '00000000-0000-0000-0000-000000000001'
const USER   = '11111111-1111-1111-1111-111111111111'

async function emit(event) {
  startUserRevokedSubscriber()
  await capturedHandlers.message('platform:events', JSON.stringify(event))
}

describe('user-revoked handler — subscribe', () => {
  it('se conecta a Redis, suscribe a "platform:events", registra handler "message"', () => {
    startUserRevokedSubscriber()
    expect(redisConnectMock).toHaveBeenCalled()
    expect(redisSubscribeMock).toHaveBeenCalledWith('platform:events', expect.any(Function))
    expect(redisOnMock).toHaveBeenCalledWith('message', expect.any(Function))
    expect(redisOnMock).toHaveBeenCalledWith('error', expect.any(Function))
  })
})

describe('user-revoked handler — filtering', () => {
  it('user.revoked con appId correcto → deleteMember', async () => {
    deleteMemberMock.mockResolvedValue(true)
    await emit({ type: 'user.revoked', payload: { appId: APP, tenantId: TENANT, userId: USER } })
    expect(deleteMemberMock).toHaveBeenCalledWith({
      appId: APP, tenantId: TENANT, subTenantId: null, userId: USER,
    })
  })

  it('auth.signup.rejected con appId correcto → deleteMember', async () => {
    deleteMemberMock.mockResolvedValue(true)
    await emit({ type: 'auth.signup.rejected', payload: { appId: APP, tenantId: TENANT, userId: USER } })
    expect(deleteMemberMock).toHaveBeenCalledTimes(1)
  })

  it('event con appId distinto → ignora (no deleteMember)', async () => {
    await emit({ type: 'user.revoked', payload: { appId: 'aulavera', tenantId: TENANT, userId: USER } })
    expect(deleteMemberMock).not.toHaveBeenCalled()
  })

  it('event de tipo no esperado → ignora', async () => {
    await emit({ type: 'user.registered', payload: { appId: APP, tenantId: TENANT, userId: USER } })
    expect(deleteMemberMock).not.toHaveBeenCalled()
  })

  it('event malformado (sin userId) → ignora silenciosamente', async () => {
    await emit({ type: 'user.revoked', payload: { appId: APP, tenantId: TENANT } })
    expect(deleteMemberMock).not.toHaveBeenCalled()
  })

  it('event malformado (sin tenantId) → ignora silenciosamente', async () => {
    await emit({ type: 'user.revoked', payload: { appId: APP, userId: USER } })
    expect(deleteMemberMock).not.toHaveBeenCalled()
  })

  it('JSON corrupto en el mensaje → no throw, no deleteMember', async () => {
    startUserRevokedSubscriber()
    await expect(capturedHandlers.message('platform:events', 'not-json')).resolves.toBeUndefined()
    expect(deleteMemberMock).not.toHaveBeenCalled()
  })

  it('payload con subTenantId → se propaga al service', async () => {
    deleteMemberMock.mockResolvedValue(true)
    await emit({
      type: 'user.revoked',
      payload: { appId: APP, tenantId: TENANT, subTenantId: 'st-1', userId: USER },
    })
    expect(deleteMemberMock).toHaveBeenCalledWith({
      appId: APP, tenantId: TENANT, subTenantId: 'st-1', userId: USER,
    })
  })
})

describe('user-revoked handler — error resilience', () => {
  it('si deleteMember throw, NO propaga (subscriber sigue vivo)', async () => {
    deleteMemberMock.mockRejectedValueOnce(new Error('DB down'))
    await expect(emit({ type: 'user.revoked', payload: { appId: APP, tenantId: TENANT, userId: USER } })).resolves.toBeUndefined()
  })

  it('aún después de error en un evento, siguientes mensajes se procesan', async () => {
    deleteMemberMock.mockRejectedValueOnce(new Error('transient'))
    deleteMemberMock.mockResolvedValueOnce(true)

    startUserRevokedSubscriber()
    await capturedHandlers.message('platform:events',
      JSON.stringify({ type: 'user.revoked', payload: { appId: APP, tenantId: TENANT, userId: 'u-fail' } }))
    await capturedHandlers.message('platform:events',
      JSON.stringify({ type: 'user.revoked', payload: { appId: APP, tenantId: TENANT, userId: 'u-ok' } }))

    expect(deleteMemberMock).toHaveBeenCalledTimes(2)
    expect(deleteMemberMock).toHaveBeenLastCalledWith(expect.objectContaining({ userId: 'u-ok' }))
  })
})
