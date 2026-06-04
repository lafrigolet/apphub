import { pool, withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import { logger } from '../lib/logger.js'
import * as repo from '../repositories/kds.repository.js'
import { ConflictError, NotFoundError } from '../utils/errors.js'

const STATUS_TS = {
  in_progress: 'acked_at',
  ready:       'ready_at',
  picked_up:   'picked_up_at',
  cancelled:   'cancelled_at',
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

export async function updateStation(ctx, id, patch) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (client) => {
    const updated = await repo.updateStation(client, ctx.appId, ctx.tenantId, id, patch)
    if (!updated) throw new NotFoundError('station')
    return updated
  })
}

// Deleting a station first reassigns its open tickets so cooks never lose work:
// if reassignTo is given the tickets move there, otherwise they fall back to
// station_id = null (unrouted) and can be picked up from the active queue.
export async function deleteStation(ctx, id, { reassignTo = null } = {}) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (client) => {
    const reassigned = await repo.reassignTicketsStation(client, ctx.appId, ctx.tenantId, id, reassignTo)
    const removed = await repo.deleteStation(client, ctx.appId, ctx.tenantId, id)
    if (!removed) throw new NotFoundError('station')
    return { deleted: true, reassignedTicketIds: reassigned }
  })
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

const eventNameFor = (status) =>
  status === 'in_progress' ? 'acked'
    : status === 'ready' ? 'ready'
      : status === 'picked_up' ? 'picked_up'
        : status

// The natural "advance one step" transition for a one-touch bump button.
const NEXT_STATUS = {
  fired:       'in_progress',
  in_progress: 'ready',
  ready:       'picked_up',
}

async function bumpTicketTx(client, ctx, t, toStatus, reason = null) {
  if (!transitionAllowed(t.status, toStatus)) {
    throw new ConflictError(`cannot transition ticket from ${t.status} to ${toStatus}`)
  }
  const tsCol = STATUS_TS[toStatus] ?? 'acked_at'
  const updated = await repo.setTicketStatus(client, ctx.appId, ctx.tenantId, t.id, toStatus, tsCol, reason)
  await publish({
    type: `kds.ticket.${eventNameFor(toStatus)}`,
    payload: {
      appId: ctx.appId, tenantId: ctx.tenantId,
      ticketId: t.id, orderId: t.order_id, stationId: t.station_id, course: t.course,
    },
  })
  return updated
}

export async function bumpTicket(ctx, id, toStatus, reason = null) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (client) => {
    const t = await repo.findTicketById(client, ctx.appId, ctx.tenantId, id)
    if (!t) throw new NotFoundError('ticket')
    return bumpTicketTx(client, ctx, t, toStatus, reason)
  })
}

// One-touch bump: advance the ticket to the next state in the FSM without a body.
export async function advanceTicket(ctx, id) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (client) => {
    const t = await repo.findTicketById(client, ctx.appId, ctx.tenantId, id)
    if (!t) throw new NotFoundError('ticket')
    const next = NEXT_STATUS[t.status]
    if (!next) throw new ConflictError(`ticket in terminal state ${t.status} cannot advance`)
    return bumpTicketTx(client, ctx, t, next)
  })
}

export async function listTicketsByOrder(ctx, orderId) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (client) => {
    const tickets = await repo.listTicketsByOrder(client, ctx.appId, ctx.tenantId, orderId)
    const withItems = await Promise.all(tickets.map(async (t) => ({
      ...t,
      items: await repo.findItemsByTicket(client, ctx.appId, ctx.tenantId, t.id),
    })))
    return { orderId, aggregateStatus: aggregateOrderStatus(withItems), tickets: withItems }
  })
}

// Derives an order-level status from its tickets (ignoring cancelled ones).
function aggregateOrderStatus(tickets) {
  const live = tickets.filter((t) => t.status !== 'cancelled')
  if (!live.length) return 'cancelled'
  if (live.every((t) => t.status === 'picked_up')) return 'picked_up'
  if (live.every((t) => ['ready', 'picked_up'].includes(t.status))) return 'all_ready'
  if (live.some((t) => t.status === 'ready')) return 'partial_ready'
  if (live.some((t) => t.status === 'in_progress')) return 'in_progress'
  return 'fired'
}

// Mass bump: advance every ticket of an order that can legally transition to
// `toStatus`. Tickets already in (or past) the target are skipped, not errored.
export async function bumpOrderTickets(ctx, orderId, toStatus, reason = null) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (client) => {
    const tickets = await repo.listTicketsByOrder(client, ctx.appId, ctx.tenantId, orderId)
    if (!tickets.length) throw new NotFoundError('order tickets')
    const bumped = []
    for (const t of tickets) {
      if (!transitionAllowed(t.status, toStatus)) continue
      bumped.push(await bumpTicketTx(client, ctx, t, toStatus, reason))
    }
    return { orderId, bumped: bumped.length, tickets: bumped }
  })
}

// Partial bump: set the status of an individual line item inside a ticket.
const ITEM_TRANSITIONS = { fired: ['in_progress', 'ready'], in_progress: ['ready'], ready: [] }
export async function bumpItem(ctx, itemId, toStatus) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (client) => {
    const item = await repo.findItemById(client, ctx.appId, ctx.tenantId, itemId)
    if (!item) throw new NotFoundError('ticket item')
    if (!(ITEM_TRANSITIONS[item.status] ?? []).includes(toStatus)) {
      throw new ConflictError(`cannot transition item from ${item.status} to ${toStatus}`)
    }
    return repo.setItemStatus(client, ctx.appId, ctx.tenantId, itemId, toStatus)
  })
}

export async function allDay(ctx, opts) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (client) =>
    repo.allDayTotals(client, ctx.appId, ctx.tenantId, opts),
  )
}

export async function metrics(ctx, opts) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (client) =>
    repo.metrics(client, ctx.appId, ctx.tenantId, opts),
  )
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

// Auto-cancel every open ticket of an order when the order is cancelled / voided
// upstream, so cooks never work on a dead order (avoids "ghost tickets").
async function cancelTicketsForOrder(event) {
  const { appId, tenantId, orderId } = event.payload ?? {}
  if (!appId || !tenantId || !orderId) return
  const ctx = { appId, tenantId, subTenantId: null }
  const reason = event.payload.reason ?? `auto-cancel: ${event.type}`
  await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (client) => {
    const cancelled = await repo.cancelTicketsByOrder(client, ctx.appId, ctx.tenantId, orderId, reason)
    for (const t of cancelled) {
      await publish({
        type: 'kds.ticket.cancelled',
        payload: {
          appId, tenantId, ticketId: t.id, orderId, stationId: t.station_id, course: t.course,
          reason,
        },
      })
    }
  })
}

export async function handleEvent(event) {
  try {
    if (event.type === 'order.paid' || event.type === 'pos.bill.paid') {
      await fireTicketsForOrder(event)
    } else if (event.type === 'order.cancelled' || event.type === 'pos.bill.voided') {
      await cancelTicketsForOrder(event)
    }
  } catch (err) {
    logger.warn({ err, type: event.type }, 'kds event handler error')
  }
}
