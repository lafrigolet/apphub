import { withTenantTransaction } from '../lib/db.js'
import { env } from '../lib/env.js'
import * as repo from '../repositories/donation-subscriptions.repository.js'
import { AppError, ForbiddenError, NotFoundError } from '@apphub/platform-sdk/errors'

const ADMIN_ROLES = new Set(['owner', 'admin', 'staff', 'super_admin'])

export async function listAdmin(identity) {
  if (!identity?.userId) throw new ForbiddenError()
  if (!ADMIN_ROLES.has(identity.role)) throw new ForbiddenError('Only admin/staff')
  return withTenantTransaction(identity.appId, identity.tenantId, identity.subTenantId ?? null, async (c) => {
    const { rows } = await c.query(
      `SELECT * FROM platform_donations.donation_subscriptions
        ORDER BY created_at DESC`,
    )
    return rows
  })
}

export async function cancel(identity, id) {
  if (!identity?.userId) throw new ForbiddenError()
  const sub = await withTenantTransaction(identity.appId, identity.tenantId, identity.subTenantId ?? null, (c) =>
    repo.findById(c, id),
  )
  if (!sub) throw new NotFoundError('Subscription')
  // El donante puede cancelar la suya; admin/staff puede cancelar cualquiera del tenant.
  if (!ADMIN_ROLES.has(identity.role) && sub.donor_user_id !== identity.userId) {
    throw new ForbiddenError('No puedes cancelar esta suscripción')
  }
  if (sub.status === 'cancelled') return sub  // idempotente

  // Pide cancelación a splitpay vía loopback. Splitpay actualiza
  // Stripe; cuando llegue el webhook customer.subscription.deleted,
  // nuestro subscriber marcará status='cancelled' aquí también.
  const url = `${env.PLATFORM_CORE_BASE_URL}/v1/splitpay/subscriptions/${sub.stripe_subscription_id}/cancel`
  const res = await fetch(url, { method: 'POST' })
  if (!res.ok && res.status !== 404) {
    const json = await res.json().catch(() => ({}))
    throw new AppError(
      json?.error?.code ?? 'CANCEL_FAILED',
      json?.error?.message ?? 'No se pudo cancelar la suscripción',
      res.status,
    )
  }
  // Optimistamente marcamos cancelled localmente; webhook lo
  // reconfirmará igual.
  return withTenantTransaction(identity.appId, identity.tenantId, identity.subTenantId ?? null, (c) =>
    repo.markCancelled(c, id),
  )
}
