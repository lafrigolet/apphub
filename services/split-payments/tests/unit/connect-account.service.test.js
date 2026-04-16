import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/lib/db.js', () => ({
  pool: { connect: vi.fn() },
  withTenant: vi.fn(),
}))

vi.mock('../../src/lib/stripe.js', () => ({
  stripe: {
    accounts: { create: vi.fn(), retrieve: vi.fn() },
    accountLinks: { create: vi.fn() },
  },
}))

vi.mock('../../src/repositories/connect-account.repository.js', () => ({
  insertConnectAccount: vi.fn(),
  findConnectAccountById: vi.fn(),
  listConnectAccounts: vi.fn(),
  updateConnectAccountStatus: vi.fn(),
}))

import {
  createConnectAccount,
  refreshOnboardingLink,
  listConnectAccounts,
  syncAccountFromStripe,
} from '../../src/services/connect-account.service.js'
import * as db from '../../src/lib/db.js'
import { stripe } from '../../src/lib/stripe.js'
import * as repo from '../../src/repositories/connect-account.repository.js'
import { StripeError } from '../../src/utils/errors.js'

const ctx = { tenantId: 'tenant-abc', subTenantId: null }

const mockStripeAccount = {
  id: 'acct_test_123',
  charges_enabled: true,
  payouts_enabled: true,
  requirements: {},
}

const mockAccount = {
  id: 'acc-uuid-1',
  tenantId: 'tenant-abc',
  stripeAccountId: 'acct_test_123',
  email: 'merchant@example.com',
  status: 'active',
}

let mockClient

beforeEach(() => {
  vi.clearAllMocks()
  mockClient = { query: vi.fn(), release: vi.fn() }
  vi.mocked(db.pool.connect).mockResolvedValue(mockClient)
})

// ── createConnectAccount ──────────────────────────────────────────────────────

describe('createConnectAccount', () => {
  it('creates stripe account, persists record, and returns onboarding url', async () => {
    vi.mocked(stripe.accounts.create).mockResolvedValue(mockStripeAccount)
    vi.mocked(db.withTenant).mockImplementation(async (_tid, _stid, fn) => fn(mockClient))
    vi.mocked(repo.insertConnectAccount).mockResolvedValue(mockAccount)
    vi.mocked(stripe.accountLinks.create).mockResolvedValue({
      url: 'https://connect.stripe.com/setup/s/onboard_123',
    })

    const result = await createConnectAccount(ctx, {
      email: 'merchant@example.com',
      businessType: 'individual',
      country: 'US',
      returnUrl: 'https://example.com/return',
      refreshUrl: 'https://example.com/refresh',
    })

    expect(result.account).toEqual(mockAccount)
    expect(result.onboardingUrl).toBe('https://connect.stripe.com/setup/s/onboard_123')
    expect(stripe.accounts.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'express',
        email: 'merchant@example.com',
        metadata: expect.objectContaining({ tenant_id: 'tenant-abc' }),
      }),
    )
  })

  it('throws StripeError when Stripe account creation fails', async () => {
    vi.mocked(stripe.accounts.create).mockRejectedValue(new Error('Stripe error'))

    await expect(createConnectAccount(ctx, {
      email: 'merchant@example.com',
      businessType: 'individual',
      country: 'US',
      returnUrl: 'https://example.com/return',
      refreshUrl: 'https://example.com/refresh',
    })).rejects.toThrow(StripeError)
  })

  it('throws StripeError when account link creation fails', async () => {
    vi.mocked(stripe.accounts.create).mockResolvedValue(mockStripeAccount)
    vi.mocked(db.withTenant).mockImplementation(async (_tid, _stid, fn) => fn(mockClient))
    vi.mocked(repo.insertConnectAccount).mockResolvedValue(mockAccount)
    vi.mocked(stripe.accountLinks.create).mockRejectedValue(new Error('Link creation failed'))

    await expect(createConnectAccount(ctx, {
      email: 'merchant@example.com',
      businessType: 'individual',
      country: 'US',
      returnUrl: 'https://example.com/return',
      refreshUrl: 'https://example.com/refresh',
    })).rejects.toThrow(StripeError)
  })
})

// ── refreshOnboardingLink ─────────────────────────────────────────────────────

describe('refreshOnboardingLink', () => {
  it('returns a new onboarding url', async () => {
    vi.mocked(repo.findConnectAccountById).mockResolvedValue(mockAccount)
    vi.mocked(stripe.accountLinks.create).mockResolvedValue({
      url: 'https://connect.stripe.com/setup/s/refresh_123',
    })

    const result = await refreshOnboardingLink(
      ctx,
      'acc-uuid-1',
      'https://example.com/return',
      'https://example.com/refresh',
    )

    expect(result.onboardingUrl).toBe('https://connect.stripe.com/setup/s/refresh_123')
    expect(stripe.accountLinks.create).toHaveBeenCalledWith(
      expect.objectContaining({ account: 'acct_test_123' }),
    )
    expect(mockClient.release).toHaveBeenCalled()
  })
})

// ── listConnectAccounts ───────────────────────────────────────────────────────

describe('listConnectAccounts', () => {
  it('returns accounts from repository', async () => {
    vi.mocked(repo.listConnectAccounts).mockResolvedValue([mockAccount])

    const result = await listConnectAccounts(ctx)

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('acc-uuid-1')
    expect(mockClient.release).toHaveBeenCalled()
  })
})

// ── syncAccountFromStripe ─────────────────────────────────────────────────────

describe('syncAccountFromStripe', () => {
  it('sets status to active when both charges and payouts are enabled', async () => {
    vi.mocked(stripe.accounts.retrieve).mockResolvedValue({
      id: 'acct_test_123',
      charges_enabled: true,
      payouts_enabled: true,
      requirements: {},
    })
    vi.mocked(repo.updateConnectAccountStatus).mockResolvedValue(undefined)

    await syncAccountFromStripe('acct_test_123')

    expect(repo.updateConnectAccountStatus).toHaveBeenCalledWith(
      mockClient, 'acct_test_123', 'active', true, true,
    )
    expect(mockClient.release).toHaveBeenCalled()
  })

  it('sets status to restricted when disabled_reason is present', async () => {
    vi.mocked(stripe.accounts.retrieve).mockResolvedValue({
      id: 'acct_test_123',
      charges_enabled: false,
      payouts_enabled: false,
      requirements: { disabled_reason: 'rejected.fraud' },
    })
    vi.mocked(repo.updateConnectAccountStatus).mockResolvedValue(undefined)

    await syncAccountFromStripe('acct_test_123')

    expect(repo.updateConnectAccountStatus).toHaveBeenCalledWith(
      mockClient, 'acct_test_123', 'restricted', false, false,
    )
  })

  it('sets status to pending when account is neither active nor restricted', async () => {
    vi.mocked(stripe.accounts.retrieve).mockResolvedValue({
      id: 'acct_test_123',
      charges_enabled: false,
      payouts_enabled: false,
      requirements: {},
    })
    vi.mocked(repo.updateConnectAccountStatus).mockResolvedValue(undefined)

    await syncAccountFromStripe('acct_test_123')

    expect(repo.updateConnectAccountStatus).toHaveBeenCalledWith(
      mockClient, 'acct_test_123', 'pending', false, false,
    )
  })
})
