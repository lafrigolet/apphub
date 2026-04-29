/**
 * Integration tests for platform/kds — require a running Postgres + Redis.
 * Start dependencies:  docker compose up postgres redis -d
 * Run:                 pnpm --filter @apphub/platform-kds test:integration
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import pg from 'pg'
import Redis from 'ioredis'
import { v4 as uuidv4 } from 'uuid'

import { runMigrations } from '../../lib/migrate.js'
import {
  createStation, listStations, listTickets, getTicket, bumpTicket, handleEvent,
} from '../../services/kds.service.js'
import { ConflictError, NotFoundError } from '../../utils/errors.js'

const APP_ID    = 'int-test-kds'
const TENANT_ID = '00000000-0000-0000-0000-0000000000d1'

let adminPool
let redis

beforeAll(async () => {
  await runMigrations(process.env.MIGRATION_DATABASE_URL)
  adminPool = new pg.Pool({ connectionString: process.env.MIGRATION_DATABASE_URL })
  redis = new Redis(process.env.REDIS_URL)
  await adminPool.query('SELECT 1')
  await redis.ping()
})

afterAll(async () => {
  await adminPool.end()
  redis.disconnect()
})

afterEach(async () => {
  await adminPool.query(`DELETE FROM platform_kds.ticket_items WHERE app_id = $1`, [APP_ID])
  await adminPool.query(`DELETE FROM platform_kds.tickets      WHERE app_id = $1`, [APP_ID])
  await adminPool.query(`DELETE FROM platform_kds.stations     WHERE app_id = $1`, [APP_ID])
})

const ctx = (overrides = {}) => ({
  appId: APP_ID, tenantId: TENANT_ID, subTenantId: null,
  userId: '11111111-1111-1111-1111-111111111111', role: 'kitchen', ...overrides,
})

describe('stations', () => {
  it('creates and lists stations', async () => {
    const s = await createStation(ctx(), { name: 'Caliente', routesCourses: ['main', 'starter'], displayOrder: 1 })
    expect(s.app_id).toBe(APP_ID)
    expect(s.routes_courses).toEqual(['main', 'starter'])
    const list = await listStations(ctx())
    expect(list.find((x) => x.id === s.id)).toBeTruthy()
  })
})

describe('handleEvent — fires tickets from order.paid', () => {
  it('creates one ticket per course, routes by station, persists items', async () => {
    const caliente = await createStation(ctx(), { name: 'Caliente', routesCourses: ['main'] })
    await createStation(ctx(), { name: 'Bar', routesCourses: ['drink'] })

    const orderId = uuidv4()
    await handleEvent({
      type: 'order.paid',
      payload: {
        appId: APP_ID, tenantId: TENANT_ID, orderId, tableCode: '5',
        items: [
          { sku: 'BURG', name: 'Burger', qty: 1, course: 'main' },
          { sku: 'COKE', name: 'Coke',   qty: 2, course: 'drink' },
        ],
      },
    })

    const tickets = await listTickets(ctx(), {})
    const forOrder = tickets.filter((t) => t.order_id === orderId)
    expect(forOrder).toHaveLength(2)

    const main = forOrder.find((t) => t.course === 'main')
    expect(main.station_id).toBe(caliente.id)
    expect(main.items).toHaveLength(1)
    expect(main.items[0].sku).toBe('BURG')

    const drink = forOrder.find((t) => t.course === 'drink')
    expect(drink.items[0].qty).toBe(2)
  })

  it('falls back to course=main when item has no course', async () => {
    const orderId = uuidv4()
    await handleEvent({
      type: 'order.paid',
      payload: {
        appId: APP_ID, tenantId: TENANT_ID, orderId,
        items: [{ sku: 'X', name: 'X', qty: 1 }],
      },
    })
    const tickets = await listTickets(ctx(), {})
    expect(tickets.find((t) => t.order_id === orderId).course).toBe('main')
  })

  it('also reacts to pos.bill.paid', async () => {
    const orderId = uuidv4()
    await handleEvent({
      type: 'pos.bill.paid',
      payload: {
        appId: APP_ID, tenantId: TENANT_ID, orderId,
        items: [{ sku: 'PIZZA', name: 'Pizza', qty: 1, course: 'main' }],
      },
    })
    const tickets = await listTickets(ctx(), {})
    expect(tickets.find((t) => t.order_id === orderId)).toBeTruthy()
  })
})

describe('bumpTicket FSM', () => {
  it('walks fired → in_progress → ready → picked_up and stamps timestamps', async () => {
    const station = await createStation(ctx(), { name: 'Caliente', routesCourses: ['main'] })
    const orderId = uuidv4()
    await handleEvent({
      type: 'order.paid',
      payload: { appId: APP_ID, tenantId: TENANT_ID, orderId, items: [{ sku: 'X', name: 'X', qty: 1, course: 'main' }] },
    })
    const tickets = await listTickets(ctx(), { stationId: station.id })
    const t = tickets[0]

    await bumpTicket(ctx(), t.id, 'in_progress')
    await bumpTicket(ctx(), t.id, 'ready')
    const final = await bumpTicket(ctx(), t.id, 'picked_up')
    expect(final.status).toBe('picked_up')
    expect(final.acked_at).toBeTruthy()
    expect(final.ready_at).toBeTruthy()
    expect(final.picked_up_at).toBeTruthy()
  })

  it('rejects fired → ready', async () => {
    await createStation(ctx(), { name: 'Caliente', routesCourses: ['main'] })
    const orderId = uuidv4()
    await handleEvent({
      type: 'order.paid',
      payload: { appId: APP_ID, tenantId: TENANT_ID, orderId, items: [{ sku: 'X', name: 'X', qty: 1, course: 'main' }] },
    })
    const tickets = await listTickets(ctx(), {})
    await expect(bumpTicket(ctx(), tickets[0].id, 'ready')).rejects.toThrow(ConflictError)
  })

  it('getTicket throws NotFoundError on unknown id', async () => {
    await expect(getTicket(ctx(), uuidv4())).rejects.toThrow(NotFoundError)
  })
})

describe('redis events', () => {
  it('emits kds.ticket.fired when a ticket is fired and kds.ticket.ready when bumped', async () => {
    await createStation(ctx(), { name: 'Caliente', routesCourses: ['main'] })

    const sub = new Redis(process.env.REDIS_URL)
    const events = []
    await sub.subscribe('platform.events')
    sub.on('message', (_c, raw) => { try { events.push(JSON.parse(raw)) } catch {} })
    await new Promise((r) => setTimeout(r, 50))

    try {
      const orderId = uuidv4()
      await handleEvent({
        type: 'order.paid',
        payload: { appId: APP_ID, tenantId: TENANT_ID, orderId, items: [{ sku: 'X', name: 'X', qty: 1, course: 'main' }] },
      })

      const deadline = Date.now() + 2000
      while (Date.now() < deadline && !events.some((e) => e.type === 'kds.ticket.fired')) {
        await new Promise((r) => setTimeout(r, 50))
      }
      const fired = events.find((e) => e.type === 'kds.ticket.fired')
      expect(fired).toBeTruthy()
      expect(fired.payload.orderId).toBe(orderId)

      // bump to ready
      const tickets = await listTickets(ctx(), {})
      const t = tickets.find((x) => x.order_id === orderId)
      await bumpTicket(ctx(), t.id, 'in_progress')
      await bumpTicket(ctx(), t.id, 'ready')
      const deadline2 = Date.now() + 2000
      while (Date.now() < deadline2 && !events.some((e) => e.type === 'kds.ticket.ready')) {
        await new Promise((r) => setTimeout(r, 50))
      }
      expect(events.find((e) => e.type === 'kds.ticket.ready')).toBeTruthy()
    } finally {
      sub.disconnect()
    }
  })
})
