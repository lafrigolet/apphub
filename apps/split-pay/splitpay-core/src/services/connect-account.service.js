import { pool, withTenant } from '../lib/db.js'
import { stripe } from '../lib/stripe.js'
import { StripeError } from '../utils/errors.js'
import { logger } from '../lib/logger.js'
import * as repo from '../repositories/connect-account.repository.js'

export async function createConnectAccount(ctx, input) {
  // Create Stripe Connect account
  let stripeAccount
  try {
    stripeAccount = await stripe.accounts.create({
      type: 'express',
      email: input.email,
      business_type: input.businessType,
      country: input.country,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      metadata: {
        tenant_id: ctx.tenantId,
        sub_tenant_id: ctx.subTenantId ?? '',
      },
    })
  } catch (err) {
    throw new StripeError('Failed to create Stripe Connect account', err)
  }

  // Persist account record
  const account = await withTenant(ctx.tenantId, ctx.subTenantId, (client) =>
    repo.insertConnectAccount(client, ctx, {
      stripeAccountId: stripeAccount.id,
      email: input.email,
    }),
  )

  // Generate onboarding link
  let accountLink
  try {
    accountLink = await stripe.accountLinks.create({
      account: stripeAccount.id,
      refresh_url: input.refreshUrl,
      return_url: input.returnUrl,
      type: 'account_onboarding',
    })
  } catch (err) {
    throw new StripeError('Failed to create account onboarding link', err)
  }

  logger.info({ accountId: account.id, stripeAccountId: stripeAccount.id }, 'Connect account created')

  return { account, onboardingUrl: accountLink.url }
}

export async function refreshOnboardingLink(ctx, accountId, returnUrl, refreshUrl) {
  const client = await pool.connect()
  try {
    const account = await repo.findConnectAccountById(client, ctx, accountId)

    const accountLink = await stripe.accountLinks.create({
      account: account.stripeAccountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: 'account_onboarding',
    })

    return { onboardingUrl: accountLink.url }
  } finally {
    client.release()
  }
}

export async function listConnectAccounts(ctx) {
  const client = await pool.connect()
  try {
    return repo.listConnectAccounts(client, ctx)
  } finally {
    client.release()
  }
}

export async function syncAccountFromStripe(stripeAccountId) {
  const client = await pool.connect()
  try {
    const stripeAccount = await stripe.accounts.retrieve(stripeAccountId)

    let status = 'pending'
    if (stripeAccount.charges_enabled && stripeAccount.payouts_enabled) {
      status = 'active'
    } else if (stripeAccount.requirements?.disabled_reason) {
      status = 'restricted'
    }

    await repo.updateConnectAccountStatus(
      client,
      stripeAccountId,
      status,
      stripeAccount.payouts_enabled ?? false,
      stripeAccount.charges_enabled ?? false,
    )

    logger.info({ stripeAccountId, status }, 'Connect account synced from Stripe')
  } finally {
    client.release()
  }
}
