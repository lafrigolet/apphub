import { pool, withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import { logger } from '../lib/logger.js'
import * as repo from '../repositories/kds.repository.js'
import { ConflictError, NotFoundError } from '../utils/errors.js'

const STATUS_TS = {
  in_progress: 'acked_at',
  ready:       'ready_at',
  picked_up:   'picked_up_at',
  cancelled:   'picked_up_at',
}

const TRANSITIONS = {
  fired:       ['in_progress','cancelled'],
  in_progress: ['ready','cancelled'],
  ready:       ['picked_up','cancelled'],
  picked_up:   [],
  cancelled:   [],
}
const transitionAllowed = (f, t) => TRANSITIONS[f]?.includes(t) ?? false

export async function createStation(ctx, body) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (client) =>
    repo.insertStation(client, { ...body, appId: ctx.appId, tenantId: ctx.tenantId }),
  )
}

export async function listStations(ctx) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (client) =>
    repo.listStations(client, ctx.appId, ctx.tenantId),
  )
}

export async function listTickets(ctx, opts) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (client) => {
    const tickets = await repo.listTickets(client, ctx.appId, ctx.tenantId, opts)
    return Promise.all(tickets.map(async (t) => ({
      ...t,
      items: await repo.findItemsByTicket(client, ctx.appId, ctx.tenantId, t.id),
    })))
  })
}

export async function getTicket(ctx, id) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (client) => {
    const t = await repo.findTicketById(client, ctx.appId, ctx.tenantId, id)
    if (!t) throw new NotFoundError('ticket')
    const items = await repo.findItemsByTicket(client, ctx.appId, ctx.tenantId, id)
    return { ...t, items }
  })
}

export async function bumpTicket(ctx, id, toStatus) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (client) => {
    const t = await repo.findTicketById(client, ctx.appId, ctx.tenantId, id)
    if (!t) throw new NotFoundError('ticket')
    if (!transitionAllowed(t.status, toStatus)) {
      throw new ConflictError(`cannot transition ticket from ${t.status} to ${toStatus}`)
    }
    const tsCol = STATUS_TS[toStatus] ?? 'acked_at'
    const updated = await repo.setTicketStatus(client, ctx.appId, ctx.tenantId, id, toStatus, tsCol)
    await publish({
      type: `kds.ticket.${toStatus === 'in_progress' ? 'acked' : toStatus === 'ready' ? 'ready' : toStatus === 'picked_up' ? 'picked_up' : toStatus}`,
      payload: {
        appId: ctx.appId, tenantId: ctx.tenantId,
        ticketId: id, orderId: t.order_id, stationId: t.station_id, course: t.course,
      },
    })
    return updated
  })
}

// Build a ticket per (course, station) when an order arrives.
async function fireTicketsForOrder(event) {
  const { appId, tenantId, orderId, items = [] } = event.payload ?? {}
  if (!appId || !tenantId || !orderId || !items.length) return

  const ctx = { appId, tenantId, subTenantId: null, userId: null, role: 'system' }

  await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (client) => {
    // Group items by course (fall back to 'main' if unspecified).
    const byCourse = new Map()
    for (const it of items) {
      const course = it.course ?? 'main'
      if (!byCourse.has(course)) byCourse.set(course, [])
      byCourse.get(course).push(it)
    }

    for (const [course, courseItems] of byCourse.entries()) {
      const station = await repo.findStationByCourse(client, ctx.appId, ctx.tenantId, course)
      const ticket  = await repo.insertTicket(client, {
        appId: ctx.appId, tenantId: ctx.tenantId,
        orderId, stationId: station?.id ?? null, course, status: 'fired',
        tableCode: event.payload.tableCode ?? null,
      })
      for (const it of courseItems) {
        await repo.insertTicketItem(client, {
          appId: ctx.appId, tenantId: ctx.tenantId, ticketId: ticket.id,
          sku: it.sku, name: it.name ?? it.sku, qty: it.qty,
          modifiers: it.modifiers ?? [], notes: it.notes,
        })
      }
      await publish({
        type: 'kds.ticket.fired',
        payload: {
          appId: ctx.appId, tenantId: ctx.tenantId,
          ticketId: ticket.id, orderId, stationId: ticket.station_id, course,
        },
      })
    }
  })
}

export async function handleEvent(event) {
  try {
    if (event.type === 'order.paid' || event.type === 'pos.bill.paid') {
      await fireTicketsForOrder(event)
    }
  } catch (err) {
    logger.warn({ err, type: event.type }, 'kds event handler error')
  }
}
