// Stripe Connect onboarding lifecycle.
// Contrato:
//   - createConnectAccount:
//       · stripe.accounts.create con type='express' + capabilities + metadata.tenant_id.
//       · Falla en accounts.create → StripeError 'Failed to create Stripe Connect account'.
//       · INSERT account row vía repo.
//       · accountLinks.create con type='account_onboarding'.
//       · Falla en accountLinks.create → StripeError 'Failed to create account onboarding link'.
//       · Devuelve { account, onboardingUrl }.
//   - refreshOnboardingLink: lookup local + stripe.accountLinks.create (sin tocar DB).
//   - syncAccountFromStripe:
//       · charges_enabled && payouts_enabled → 'active'.
//       · requirements.disabled_reason presente → 'restricted'.
//       · default → 'pending'.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: {
    NODE_ENV: 'test', LOG_LEVEL: 'error',
    DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost',
    PLATFORM_JWT_SECRET: 'test-secret-32-chars-xxxxxxxxxxxxxxx',
    STRIPE_SECRET_KEY: 'sk_test', STRIPE_WEBHOOK_SECRET: 'whsec',
  },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../lib/db.js', () => ({
  pool: { connect: vi.fn().mockResolvedValue({ query: vi.fn(), release: vi.fn() }) },
  withTenant: vi.fn(),
}))
const { accountsCreateMock, accountLinksCreateMock, accountsRetrieveMock } = vi.hoisted(() => ({
  accountsCreateMock: vi.fn(),
  accountLinksCreateMock: vi.fn(),
  accountsRetrieveMock: vi.fn(),
}))
vi.mock('../lib/stripe.js', () => ({
  stripe: {
    accounts: { create: accountsCreateMock, retrieve: accountsRetrieveMock },
    accountLinks: { create: accountLinksCreateMock },
  },
}))
vi.mock('../repositories/connect-account.repository.js')

import {
  createConnectAccount, refreshOnboardingLink, syncAccountFromStripe, listConnectAccounts,
} from '../services/connect-account.service.js'
import { withTenant, pool } from '../lib/db.js'
import * as repo from '../repositories/connect-account.repository.js'

const ctx = {
  appId: 'aikikan',
  tenantId: '22222222-2222-2222-2222-222222222222',
  subTenantId: null,
  userId: 'admin-1',
  role: 'admin',
}

beforeEach(() => {
  vi.clearAllMocks()
  withTenant.mockImplementation(async (_t, _s, fn) => fn({}))
})

// ── createConnectAccount ─────────────────────────────────────────────

describe('createConnectAccount', () => {
  it('happy: crea Stripe account + persist + onboarding link', async () => {
    accountsCreateMock.mockResolvedValue({ id: 'acct_test_123' })
    accountLinksCreateMock.mockResolvedValue({ url: 'https://stripe.com/onboarding/acct_test_123' })
    repo.insertConnectAccount.mockResolvedValue({ id: 'local-acc-1', stripeAccountId: 'acct_test_123' })

    const r = await createConnectAccount(ctx, {
      email: 'merchant@example.com',
      businessType: 'individual',
      country: 'ES',
      refreshUrl: 'https://app.com/refresh',
      returnUrl:  'https://app.com/return',
    })

    expect(accountsCreateMock).toHaveBeenCalledWith({
      type: 'express',
      email: 'merchant@example.com',
      business_type: 'individual',
      country: 'ES',
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      metadata: { tenant_id: ctx.tenantId, sub_tenant_id: '' },
    })
    expect(accountLinksCreateMock).toHaveBeenCalledWith({
      account: 'acct_test_123',
      refresh_url: 'https://app.com/refresh',
      return_url:  'https://app.com/return',
      type: 'account_onboarding',
    })
    expect(r.account.id).toBe('local-acc-1')
    expect(r.onboardingUrl).toBe('https://stripe.com/onboarding/acct_test_123')
  })

  it('subTenantId propaga a metadata.sub_tenant_id', async () => {
    accountsCreateMock.mockResolvedValue({ id: 'acct_x' })
    accountLinksCreateMock.mockResolvedValue({ url: 'u' })
    repo.insertConnectAccount.mockResolvedValue({ id: 'a' })
    await createConnectAccount(
      { ...ctx, subTenantId: 'st-123' },
      { email: 'a@b.com', businessType: 'individual', country: 'ES', refreshUrl: 'r', returnUrl: 'u' },
    )
    expect(accountsCreateMock).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ sub_tenant_id: 'st-123' }),
    }))
  })

  it('stripe.accounts.create falla → StripeError "Failed to create Stripe Connect account"', async () => {
    accountsCreateMock.mockRejectedValue(new Error('Stripe down'))
    await expect(createConnectAccount(ctx, {
      email: 'a@b.com', businessType: 'individual', country: 'ES', refreshUrl: 'r', returnUrl: 'u',
    })).rejects.toThrow(/Failed to create Stripe Connect account/)
    expect(repo.insertConnectAccount).not.toHaveBeenCalled()
  })

  it('stripe.accountLinks.create falla DESPUÉS del INSERT → StripeError (account ya persistida)', async () => {
    accountsCreateMock.mockResolvedValue({ id: 'acct_x' })
    repo.insertConnectAccount.mockResolvedValue({ id: 'local-1', stripeAccountId: 'acct_x' })
    accountLinksCreateMock.mockRejectedValue(new Error('link gen failed'))
    await expect(createConnectAccount(ctx, {
      email: 'a@b.com', businessType: 'individual', country: 'ES', refreshUrl: 'r', returnUrl: 'u',
    })).rejects.toThrow(/Failed to create account onboarding link/)
    expect(repo.insertConnectAccount).toHaveBeenCalled()        // ya persistida → operador genera link después
  })
})

// ── refreshOnboardingLink ────────────────────────────────────────────

describe('refreshOnboardingLink', () => {
  it('lookup local + nuevo accountLinks.create', async () => {
    repo.findConnectAccountById.mockResolvedValue({ stripeAccountId: 'acct_x' })
    accountLinksCreateMock.mockResolvedValue({ url: 'https://stripe.com/new-link' })
    const r = await refreshOnboardingLink(ctx, 'local-1', 'https://ret', 'https://ref')
    expect(accountLinksCreateMock).toHaveBeenCalledWith({
      account: 'acct_x', refresh_url: 'https://ref', return_url: 'https://ret',
      type: 'account_onboarding',
    })
    expect(r.onboardingUrl).toBe('https://stripe.com/new-link')
  })
})

// ── listConnectAccounts ──────────────────────────────────────────────

describe('listConnectAccounts', () => {
  it('delega a repo dentro del pool y libera client', async () => {
    const fakeClient = { query: vi.fn(), release: vi.fn() }
    pool.connect.mockResolvedValueOnce(fakeClient)
    repo.listConnectAccounts.mockResolvedValue([{ id: 'a1' }])
    const r = await listConnectAccounts(ctx)
    expect(r).toEqual([{ id: 'a1' }])
    expect(repo.listConnectAccounts).toHaveBeenCalledWith(fakeClient, ctx)
    expect(fakeClient.release).toHaveBeenCalled()
  })
})

// ── syncAccountFromStripe ────────────────────────────────────────────

describe('syncAccountFromStripe — status derivation', () => {
  it('charges + payouts enabled → status="active"', async () => {
    accountsRetrieveMock.mockResolvedValue({
      charges_enabled: true, payouts_enabled: true, requirements: {},
    })
    await syncAccountFromStripe('acct_x')
    expect(repo.updateConnectAccountStatus).toHaveBeenCalledWith(
      expect.anything(), 'acct_x', 'active', true, true,
    )
  })

  it('requirements.disabled_reason → status="restricted"', async () => {
    accountsRetrieveMock.mockResolvedValue({
      charges_enabled: false, payouts_enabled: false,
      requirements: { disabled_reason: 'requirements.past_due' },
    })
    await syncAccountFromStripe('acct_x')
    expect(repo.updateConnectAccountStatus).toHaveBeenCalledWith(
      expect.anything(), 'acct_x', 'restricted', false, false,
    )
  })

  it('default (charges sin enabled, sin disabled_reason) → status="pending"', async () => {
    accountsRetrieveMock.mockResolvedValue({
      charges_enabled: false, payouts_enabled: true, requirements: {},
    })
    await syncAccountFromStripe('acct_x')
    expect(repo.updateConnectAccountStatus).toHaveBeenCalledWith(
      expect.anything(), 'acct_x', 'pending', true, false,
    )
  })

  it('charges_enabled/payouts_enabled undefined → defaults a false', async () => {
    accountsRetrieveMock.mockResolvedValue({ requirements: {} })
    await syncAccountFromStripe('acct_x')
    expect(repo.updateConnectAccountStatus).toHaveBeenCalledWith(
      expect.anything(), 'acct_x', 'pending', false, false,
    )
  })

  it('libera client del pool en finally aunque retrieve falle', async () => {
    const fakeClient = { query: vi.fn(), release: vi.fn() }
    pool.connect.mockResolvedValueOnce(fakeClient)
    accountsRetrieveMock.mockRejectedValue(new Error('Stripe 404'))
    await expect(syncAccountFromStripe('acct_x')).rejects.toThrow('Stripe 404')
    expect(fakeClient.release).toHaveBeenCalled()
  })
})
