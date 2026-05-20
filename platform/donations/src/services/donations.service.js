import { withTenantTransaction, withStaffBypass } from '../lib/db.js'
import { env } from '../lib/env.js'
import { logger } from '../lib/logger.js'
import * as repo       from '../repositories/donations.repository.js'
import * as causesRepo from '../repositories/causes.repository.js'
import * as subsRepo   from '../repositories/donation-subscriptions.repository.js'
import {
  AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError,
} from '@apphub/platform-sdk/errors'

const ADMIN_ROLES = new Set(['owner', 'admin', 'staff', 'super_admin'])
const MIN_AMOUNT_CENTS = 100  // 1€

function requireAdmin(identity) {
  if (!identity?.userId) throw new ForbiddenError()
  if (!ADMIN_ROLES.has(identity.role)) throw new ForbiddenError('Only admin/staff')
}

// ── Checkout público ───────────────────────────────────────────────────
//
// Flujo:
//  1) Valida importe y, si es necesario, la causa.
//  2) INSERT row en donations con status='pending', sin stripe_session_id.
//  3) Llama POST /v1/splitpay/checkout-sessions con price_data ad-hoc
//     (one-shot) o price_data + recurring (mensual).
//  4) UPDATE donations SET stripe_session_id = result.sessionId.
//  5) Devuelve { sessionUrl, donationId }.
//
// La detección de "pagada" la hace el subscriber de splitpay events
// más tarde, no este endpoint.

export async function createCheckout(input, { bearerToken } = {}) {
  const {
    appId, tenantId, subTenantId,
    causeId, amountCents, currency = 'EUR',
    donorUserId, donorEmail, donorName, donorNif,
    donorAddress, donorPostalCode, donorCountry,
    kind, anonymous = false, message,
    successUrl, cancelUrl,
  } = input

  if (!appId || !tenantId) throw new ValidationError('appId y tenantId requeridos')
  if (!donorEmail)         throw new ValidationError('donorEmail requerido')
  if (!successUrl || !cancelUrl) throw new ValidationError('successUrl y cancelUrl requeridos')
  if (!['one_shot', 'recurring_monthly'].includes(kind)) {
    throw new ValidationError("kind debe ser 'one_shot' o 'recurring_monthly'")
  }
  if (!Number.isInteger(amountCents) || amountCents < MIN_AMOUNT_CENTS) {
    throw new ValidationError(`amountCents debe ser entero ≥ ${MIN_AMOUNT_CENTS}`)
  }

  // 1) Crea el row pending y obtiene su id ANTES de Stripe, para
  //    metérselo en metadata y poder reconciliar en el webhook.
  let donation
  let causeName = null
  await withTenantTransaction(appId, tenantId, subTenantId ?? null, async (c) => {
    if (causeId) {
      const cause = await causesRepo.findById(c, causeId)
      if (!cause) throw new NotFoundError('Cause')
      if (!cause.active) throw new ConflictError('La causa no está activa')
      causeName = cause.name
    }
    donation = await repo.insert(c, {
      appId, tenantId, subTenantId: subTenantId ?? null, causeId: causeId ?? null,
      donorUserId: donorUserId ?? null, donorEmail, donorName: donorName ?? null,
      donorNif: donorNif ?? null,
      donorAddress: donorAddress ?? null,
      donorPostalCode: donorPostalCode ?? null,
      donorCountry: donorCountry ?? null,
      amountCents, currency, status: 'pending', kind,
      anonymous: !!anonymous, message: message ?? null,
    })
  })

  // 2) Pide checkout a splitpay vía loopback HTTP. Llevamos el JWT del
  //    caller (si lo hubiera) para que splitpay aplique el appGuard
  //    igual que cualquier otro consumidor. Sin JWT, splitpay debe
  //    poder consumirlo igual — el endpoint /v1/splitpay/checkout-sessions
  //    valida appId/tenantId del body.
  const productName = causeName
    ? `Donación — ${causeName}`
    : 'Donación a fondo general'
  const lineItems = [
    kind === 'one_shot'
      ? {
          price_data: {
            currency: String(currency).toLowerCase(),
            unit_amount: amountCents,
            product_data: { name: productName },
          },
          quantity: 1,
        }
      : {
          price_data: {
            currency: String(currency).toLowerCase(),
            unit_amount: amountCents,
            product_data: { name: productName },
            recurring: { interval: 'month' },
          },
          quantity: 1,
        },
  ]

  const splitpayPayload = {
    mode:          kind === 'one_shot' ? 'payment' : 'subscription',
    lineItems,
    successUrl,
    cancelUrl,
    customerEmail: donorEmail,
    currency:      String(currency).toLowerCase(),
    metadata: {
      purpose:     'donation',
      donation_id: donation.id,
      cause_id:    causeId ?? '',
      app_id:      appId,
      tenant_id:   tenantId,
    },
  }

  const url = `${env.PLATFORM_CORE_BASE_URL}/v1/splitpay/checkout-sessions`
  const headers = { 'Content-Type': 'application/json' }
  if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`
  let session
  try {
    const res  = await fetch(url, { method: 'POST', headers, body: JSON.stringify(splitpayPayload) })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      logger.warn({ status: res.status, json }, 'splitpay rejected donation checkout')
      throw new AppError(
        json?.error?.code ?? 'SPLITPAY_ERROR',
        json?.error?.message ?? 'No se pudo crear la sesión de pago',
        res.status,
      )
    }
    session = json.data ?? json
  } catch (err) {
    if (err instanceof AppError) throw err
    logger.error({ err }, 'splitpay loopback fetch failed')
    throw new AppError('SPLITPAY_UNREACHABLE', 'Servicio de pagos no disponible', 502)
  }

  const sessionId  = session.stripeSessionId ?? session.sessionId ?? session.id
  const sessionUrl = session.url

  // 3) Persiste el stripe_session_id en el row pending — el webhook
  //    busca por session_id o por donation_id en metadata; cualquiera
  //    de los dos basta para reconciliar.
  await withTenantTransaction(appId, tenantId, subTenantId ?? null, (c) =>
    repo.attachSession(c, donation.id, sessionId),
  )

  return { sessionUrl, donationId: donation.id }
}

// ── Lectura — donante autenticado ──────────────────────────────────────

export async function listMyDonations(identity) {
  if (!identity?.userId) throw new ForbiddenError()
  return withTenantTransaction(identity.appId, identity.tenantId, identity.subTenantId ?? null, (c) =>
    repo.listForDonor(c, identity.userId),
  )
}

export async function listMySubscriptions(identity) {
  if (!identity?.userId) throw new ForbiddenError()
  return withTenantTransaction(identity.appId, identity.tenantId, identity.subTenantId ?? null, (c) =>
    subsRepo.listForDonor(c, identity.userId),
  )
}

// ── Admin ──────────────────────────────────────────────────────────────

export async function listAdminDonations(identity, filters) {
  requireAdmin(identity)
  return withTenantTransaction(identity.appId, identity.tenantId, identity.subTenantId ?? null, (c) =>
    repo.listAdmin(c, filters),
  )
}

export async function getDonation(identity, id) {
  if (!identity?.userId) throw new ForbiddenError()
  return withTenantTransaction(identity.appId, identity.tenantId, identity.subTenantId ?? null, async (c) => {
    const d = await repo.findById(c, id)
    if (!d) throw new NotFoundError('Donation')
    // Donor puede ver la suya. Admin puede ver cualquiera del tenant.
    if (!ADMIN_ROLES.has(identity.role) && d.donor_user_id !== identity.userId) {
      throw new ForbiddenError('No puedes ver esta donación')
    }
    return d
  })
}

// ── Refund — llama a splitpay y propaga ────────────────────────────────

export async function refund(identity, donationId, { reason, idempotencyKey }) {
  requireAdmin(identity)
  if (!idempotencyKey) throw new ValidationError('idempotencyKey requerido')

  const d = await withTenantTransaction(identity.appId, identity.tenantId, identity.subTenantId ?? null, (c) =>
    repo.findById(c, donationId),
  )
  if (!d) throw new NotFoundError('Donation')
  if (d.status !== 'paid') throw new ConflictError(`No se puede reembolsar (status=${d.status})`)
  if (!d.stripe_payment_intent_id) throw new ConflictError('Falta stripe_payment_intent_id')

  // Llama a splitpay POST /v1/payments/<payment_intent_id>/refunds.
  // (El endpoint admite el payment_intent id o el row id de splitpay
  // según convención; aquí asumimos que splitpay resuelve por
  // stripe_payment_intent_id internamente.)
  const url = `${env.PLATFORM_CORE_BASE_URL}/v1/payments/${d.stripe_payment_intent_id}/refunds`
  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ reason: reason ?? 'requested_by_customer', idempotencyKey }),
  })
  if (!res.ok) {
    const json = await res.json().catch(() => ({}))
    throw new AppError(json?.error?.code ?? 'REFUND_ERROR', json?.error?.message ?? 'Refund failed', res.status)
  }

  // El propio splitpay emitirá un evento al confirmar; aquí marcamos
  // el row optimistamente. Si el refund falla más tarde queda en
  // splitpay un row de refund failed que el admin puede inspeccionar.
  return withTenantTransaction(identity.appId, identity.tenantId, identity.subTenantId ?? null, async (c) => {
    const updated = await repo.markRefunded(c, donationId, reason)
    if (updated && d.cause_id) {
      await causesRepo.incrementRaised(c, d.cause_id, -d.amount_cents)
    }
    return updated
  })
}
