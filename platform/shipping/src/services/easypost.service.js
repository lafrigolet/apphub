// EasyPost orchestration: the outbound side of shipping.
//   * rateShop      — live multi-carrier rates for a parcel to a destination.
//   * buyLabel      — buy a label per package, archive the PDF in S3, persist
//                     carrier + tracking + label artifacts, transition status.
//   * schedulePickup / cancelPickup — carrier pickup requests for an origin.
//
// Carrier credentials are global (one operator's contracts); tenant isolation
// applies to addresses, shipments, packages and pickups. Everything that hits
// EasyPost first checks isStubbed() so a tenant without configured credentials
// gets a clear 503 rather than a crash.
import { pool, withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import { logger } from '../lib/logger.js'
import * as repo from '../repositories/shipping.repository.js'
import * as addrRepo from '../repositories/addresses.repository.js'
import * as pickupRepo from '../repositories/pickups.repository.js'
import * as easypost from '../lib/easypost.js'
import * as storage from '../lib/storage.js'
import { toEpAddress } from './addresses.service.js'
import { NotFoundError, ValidationError } from '../utils/errors.js'

// ── unit conversions (our DB is metric; EasyPost parcels are imperial) ──────
const G_PER_OZ = 28.3495
const MM_PER_IN = 25.4
const gramsToOz = (g) => g != null ? Math.round((Number(g) / G_PER_OZ) * 100) / 100 : undefined
const mmToIn = (mm) => mm != null ? Math.round((Number(mm) / MM_PER_IN) * 100) / 100 : undefined

function toEpParcel({ weightG, lengthMm, widthMm, heightMm }) {
  const parcel = { weight: gramsToOz(weightG) }
  if (lengthMm != null) parcel.length = mmToIn(lengthMm)
  if (widthMm != null) parcel.width = mmToIn(widthMm)
  if (heightMm != null) parcel.height = mmToIn(heightMm)
  return parcel
}

function parcelFromPackage(pkg) {
  return toEpParcel({
    weightG: pkg.weight_grams, lengthMm: pkg.length_mm,
    widthMm: pkg.width_mm, heightMm: pkg.height_mm,
  })
}

// Pick a rate from EasyPost's rates[] by strategy + optional carrier/service
// filter. 'cheapest' (default) → lowest rate.rate; 'fastest' → lowest
// delivery_days (nulls last), tie-break on price.
function selectRate(rates, { strategy = 'cheapest', carrier, service } = {}) {
  let pool_ = rates ?? []
  if (carrier) pool_ = pool_.filter((r) => r.carrier?.toLowerCase() === carrier.toLowerCase())
  if (service) pool_ = pool_.filter((r) => r.service?.toLowerCase() === service.toLowerCase())
  if (pool_.length === 0) return null
  const byPrice = (a, b) => Number(a.rate) - Number(b.rate)
  if (strategy === 'fastest') {
    return [...pool_].sort((a, b) => {
      const da = a.delivery_days ?? Infinity, db = b.delivery_days ?? Infinity
      return da !== db ? da - db : byPrice(a, b)
    })[0]
  }
  return [...pool_].sort(byPrice)[0]
}

// Resolve the EasyPost address shape from either an inline address or a stored
// address id (tenant-scoped).
async function resolveAddress(c, ctx, { addressId, inline }) {
  if (inline) return inline
  if (!addressId) return null
  const row = await addrRepo.findAddressById(c, ctx.appId, ctx.tenantId, addressId)
  if (!row) throw new NotFoundError('address')
  return toEpAddress(row)
}

// ── rate-shopping ───────────────────────────────────────────────────────────
// Live multi-carrier rates for a single parcel. `to` is an inline destination
// (checkout: not yet persisted) or `toAddressId`; `fromAddressId` defaults to
// the tenant's default origin. Does NOT buy — returns the rates[] for the
// caller to present and pick from.
export async function rateShop(ctx, input) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const toAddress = await resolveAddress(c, ctx, { addressId: input.toAddressId, inline: input.to })
    if (!toAddress) throw new ValidationError('rate-shop requires a destination (to or toAddressId)')

    let fromAddress = await resolveAddress(c, ctx, { addressId: input.fromAddressId, inline: input.from })
    if (!fromAddress) {
      const origin = await addrRepo.findDefaultOrigin(c, ctx.appId, ctx.tenantId)
      if (!origin) throw new ValidationError('no origin address configured (set a default origin or pass fromAddressId/from)')
      fromAddress = toEpAddress(origin)
    }

    const parcel = toEpParcel(input.parcel ?? {})
    if (parcel.weight == null) throw new ValidationError('parcel.weightG is required to rate-shop')

    const ep = await easypost.createShipment({ toAddress, fromAddress, parcel })
    const rates = (ep.rates ?? []).map((r) => ({
      easypost_rate_id: r.id,
      easypost_shipment_id: ep.id,
      carrier: r.carrier,
      service: r.service,
      rate_cents: Math.round(Number(r.rate) * 100),
      currency: r.currency,
      delivery_days: r.delivery_days ?? null,
      delivery_date: r.delivery_date ?? null,
      est_delivery_days: r.est_delivery_days ?? null,
    })).sort((a, b) => a.rate_cents - b.rate_cents)

    return { easypost_shipment_id: ep.id, rates }
  })
}

// ── label purchase ──────────────────────────────────────────────────────────
// Buy a carrier label for every package of a shipment. For each package we
// create a fresh EasyPost shipment (from/to addresses + the package's parcel),
// select a rate by strategy/carrier/service, buy it, archive the label PDF in
// S3, and persist the artifacts on the package row. The first package's
// carrier+tracking is mirrored onto the shipment, status → in_transit.
export async function buyLabel(ctx, shipmentId, opts = {}) {
  // 1. Load shipment + packages + resolve addresses inside one tenant tx.
  const prepared = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const shipment = await repo.findShipmentById(c, ctx.appId, ctx.tenantId, shipmentId)
    if (!shipment) throw new NotFoundError('shipment')
    const packages = await repo.listPackages(c, ctx.appId, ctx.tenantId, shipmentId)
    if (packages.length === 0) {
      throw new ValidationError('shipment has no packages to label — add a package with weight/dimensions first')
    }

    // Allow overriding addresses on the buy call; otherwise use the shipment's
    // linked from/to, otherwise the tenant default origin.
    const toAddrId = opts.toAddressId ?? shipment.to_address_id
    const fromAddrId = opts.fromAddressId ?? shipment.from_address_id

    const toAddress = await resolveAddress(c, ctx, { addressId: toAddrId, inline: opts.to })
    if (!toAddress) throw new ValidationError('label purchase requires a destination address (to / toAddressId)')

    let fromAddress = await resolveAddress(c, ctx, { addressId: fromAddrId, inline: opts.from })
    let resolvedFromId = fromAddrId ?? null
    if (!fromAddress) {
      const origin = await addrRepo.findDefaultOrigin(c, ctx.appId, ctx.tenantId)
      if (!origin) throw new ValidationError('no origin address configured (set a default origin or pass fromAddressId/from)')
      fromAddress = toEpAddress(origin)
      resolvedFromId = origin.id
    }

    // Persist the resolved address links up front (idempotent re-link).
    await repo.updateShipmentFulfillment(c, ctx.appId, ctx.tenantId, shipmentId, {
      fromAddressId: resolvedFromId ?? undefined,
      toAddressId: toAddrId ?? undefined,
    })

    return { shipment, packages, toAddress, fromAddress }
  })

  // 2. Hit EasyPost per package OUTSIDE the DB tx (network I/O), then persist.
  const selector = { strategy: opts.strategy, carrier: opts.carrier, service: opts.service }
  const bought = []
  for (const pkg of prepared.packages) {
    const parcel = parcelFromPackage(pkg)
    if (parcel.weight == null) {
      throw new ValidationError(`package ${pkg.package_number} has no weight — set weight_grams before buying a label`)
    }
    const options = prepared.shipment.signature_required ? { delivery_confirmation: 'SIGNATURE' } : undefined
    const epShipment = await easypost.createShipment({
      toAddress: prepared.toAddress, fromAddress: prepared.fromAddress, parcel, options,
    })
    const rate = selectRate(epShipment.rates, selector)
    if (!rate) throw new ValidationError(`no carrier rate available for package ${pkg.package_number} with the given filters`)

    const insurance = prepared.shipment.insurance_amount_cents != null
      ? (prepared.shipment.insurance_amount_cents / 100).toFixed(2)
      : undefined
    const purchased = await easypost.buyShipment(epShipment.id, rate.id, insurance)

    // Archive the label PDF (best-effort — keep going if S3 is down/absent).
    let labelS3Key = null
    const labelUrl = purchased?.postage_label?.label_url ?? null
    if (labelUrl) {
      try {
        const { buf, contentType } = await easypost.downloadLabel(labelUrl)
        labelS3Key = await storage.archiveLabel({
          appId: ctx.appId, tenantId: ctx.tenantId, packageId: pkg.id, buf, contentType,
        })
      } catch (err) {
        logger.warn({ err, packageId: pkg.id }, 'label archive to S3 failed — keeping carrier-hosted URL')
      }
    }

    bought.push({
      packageId: pkg.id,
      packageNumber: pkg.package_number,
      carrier: purchased.selected_rate?.carrier ?? rate.carrier,
      service: purchased.selected_rate?.service ?? rate.service,
      trackingCode: purchased.tracking_code ?? null,
      trackingUrl: purchased.tracker?.public_url ?? null,
      easypostShipmentId: epShipment.id,
      easypostRateId: rate.id,
      labelUrl,
      labelS3Key,
      rateCents: Math.round(Number(purchased.selected_rate?.rate ?? rate.rate) * 100),
      rateCurrency: purchased.selected_rate?.currency ?? rate.currency ?? null,
    })
  }

  // 3. Persist label artifacts + mirror first package onto the shipment.
  const result = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    for (const b of bought) {
      await repo.updatePackageLabel(c, ctx.appId, ctx.tenantId, b.packageId, {
        carrier: b.carrier, trackingCode: b.trackingCode, status: 'in_transit',
        easypostShipmentId: b.easypostShipmentId, easypostRateId: b.easypostRateId,
        labelUrl: b.labelUrl, labelS3Key: b.labelS3Key, trackingUrl: b.trackingUrl,
        rateCents: b.rateCents, rateCurrency: b.rateCurrency,
      })
    }
    const first = bought[0]
    await repo.updateShipmentFulfillment(c, ctx.appId, ctx.tenantId, shipmentId, {
      carrier: first.carrier, trackingCode: first.trackingCode,
      easypostShipmentId: first.easypostShipmentId,
    })
    const shipment = await repo.updateShipmentStatus(c, ctx.appId, ctx.tenantId, shipmentId, 'in_transit', {
      shippedAt: new Date(),
    })
    await repo.insertShipmentEvent(c, ctx.appId, ctx.tenantId, shipmentId, {
      code: 'label_purchased', description: `${bought.length} label(s) via ${first.carrier}`, location: null,
    })
    return shipment
  })

  await publish({
    type: 'shipping.label.purchased',
    payload: {
      shipmentId, orderId: result.order_id, appId: ctx.appId, tenantId: ctx.tenantId,
      carrier: bought[0].carrier, packages: bought.length,
      totalRateCents: bought.reduce((s, b) => s + (b.rateCents ?? 0), 0),
    },
  })
  await publish({
    type: 'shipping.shipment.shipped',
    payload: { shipmentId, orderId: result.order_id, appId: ctx.appId, tenantId: ctx.tenantId },
  })

  return { shipment: result, packages: bought }
}

// ── pickups ──────────────────────────────────────────────────────────────────
export async function schedulePickup(ctx, input) {
  // Resolve origin address (defaults to the tenant default origin).
  const prepared = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    let origin = null
    if (input.addressId) {
      origin = await addrRepo.findAddressById(c, ctx.appId, ctx.tenantId, input.addressId)
      if (!origin) throw new NotFoundError('address')
    } else {
      origin = await addrRepo.findDefaultOrigin(c, ctx.appId, ctx.tenantId)
      if (!origin) throw new ValidationError('no origin address configured (pass addressId or set a default origin)')
    }
    return { origin }
  })

  // EasyPost pickup needs a reference shipment id for the carrier; use the
  // first provided shipment's EasyPost shipment id when available.
  const epPickupBody = {
    address: toEpAddress(prepared.origin),
    min_datetime: input.minDatetime,
    max_datetime: input.maxDatetime,
    instructions: input.instructions ?? undefined,
    is_account_address: true,
  }
  if (input.easypostShipmentId) epPickupBody.shipment = { id: input.easypostShipmentId }

  const epPickup = await easypost.createPickup(epPickupBody)
  let status = 'scheduled', confirmation = null, rate = null, carrier = input.carrier ?? null, service = input.service ?? null
  // Buy the pickup when a carrier+service is provided (otherwise it stays a
  // scheduled request the staff can confirm later).
  if (carrier && service) {
    try {
      const boughtPickup = await easypost.buyPickup(epPickup.id, { carrier, service })
      status = 'confirmed'
      confirmation = boughtPickup?.confirmation ?? null
      rate = boughtPickup?.pickup_rates?.find((r) => r.carrier === carrier && r.service === service) ?? null
    } catch (err) {
      logger.warn({ err, pickupId: epPickup.id }, 'pickup buy failed — leaving as scheduled')
      status = 'failed'
    }
  }

  const saved = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    pickupRepo.insertPickup(c, ctx.appId, ctx.tenantId, {
      addressId: prepared.origin.id, easypostPickupId: epPickup.id, status,
      carrier, service, confirmation, minDatetime: input.minDatetime, maxDatetime: input.maxDatetime,
      instructions: input.instructions ?? null, shipmentIds: input.shipmentIds ?? [], rate,
    }),
  )

  await publish({
    type: 'shipping.pickup.scheduled',
    payload: { pickupId: saved.id, appId: ctx.appId, tenantId: ctx.tenantId, status, carrier, confirmation },
  })
  return saved
}

export async function listPickups(ctx, filters) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    pickupRepo.listPickups(c, ctx.appId, ctx.tenantId, filters),
  )
}

export async function getPickup(ctx, id) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const p = await pickupRepo.findPickupById(c, ctx.appId, ctx.tenantId, id)
    if (!p) throw new NotFoundError('pickup')
    return p
  })
}

export async function cancelPickup(ctx, id) {
  const pickup = await getPickup(ctx, id)
  if (pickup.easypost_pickup_id && pickup.status !== 'cancelled') {
    try { await easypost.cancelPickup(pickup.easypost_pickup_id) }
    catch (err) { logger.warn({ err, pickupId: id }, 'EasyPost pickup cancel failed — marking cancelled locally') }
  }
  const updated = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    pickupRepo.updatePickup(c, ctx.appId, ctx.tenantId, id, { status: 'cancelled' }),
  )
  await publish({
    type: 'shipping.pickup.cancelled',
    payload: { pickupId: id, appId: ctx.appId, tenantId: ctx.tenantId },
  })
  return updated
}
