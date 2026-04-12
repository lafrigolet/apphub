/**
 * @splitpay/sdk-js
 * Typed HTTP client for the SplitPay microservices.
 * Frontends import this instead of using raw fetch.
 */

export interface SplitPayClientOptions {
  baseUrl: string
  getToken: () => string | Promise<string>
}

export interface SplitRule {
  id: string
  name: string
  platformFeePercent: number
  recipients: Array<{ accountId: string; label: string; percentage: number }>
  active: boolean
  createdAt: string
  updatedAt: string
}

export interface SplitSimulation {
  grossAmount: number
  currency: string
  stripeFee: number
  netAmount: number
  platformFee: number
  recipients: Array<{ label: string; accountId: string; percentage: number; amount: number }>
}

export interface Payment {
  id: string
  amount: number
  currency: string
  status: string
  splitRuleId: string
  platformFee: number
  createdAt: string
}

export interface ConnectAccount {
  id: string
  stripeAccountId: string
  email: string
  status: 'pending' | 'active' | 'restricted' | 'disabled'
  payoutsEnabled: boolean
  chargesEnabled: boolean
}

class SplitPayClient {
  constructor(private opts: SplitPayClientOptions) {}

  private async fetch<T>(path: string, init?: RequestInit): Promise<T> {
    const token = await this.opts.getToken()
    const res = await fetch(`${this.opts.baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...init?.headers,
      },
    })
    const json = await res.json() as { data?: T; error?: { code: string; message: string } }
    if (!res.ok) throw new Error(json.error?.message ?? 'Request failed')
    return json.data as T
  }

  readonly splitRules = {
    list: () => this.fetch<SplitRule[]>('/split-rules'),
    get: (id: string) => this.fetch<SplitRule>(`/split-rules/${id}`),
    create: (body: { name: string; platformFeePercent: number; recipients: SplitRule['recipients'] }) =>
      this.fetch<SplitRule>('/split-rules', { method: 'POST', body: JSON.stringify(body) }),
    deactivate: (id: string) =>
      this.fetch<void>(`/split-rules/${id}`, { method: 'DELETE' }),
    simulate: (splitRuleId: string, amount: number, currency: string) =>
      this.fetch<SplitSimulation>('/split-rules/simulate', {
        method: 'POST',
        body: JSON.stringify({ splitRuleId, amount, currency }),
      }),
  }

  readonly payments = {
    create: (body: {
      amount: number
      currency: string
      splitRuleId: string
      merchantAccountId: string
      idempotencyKey: string
      metadata?: Record<string, string>
    }) => this.fetch<{ clientSecret: string; paymentId: string }>('/payments', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    list: (params?: { limit?: number; cursor?: string }) => {
      const qs = new URLSearchParams(params as Record<string, string>).toString()
      return this.fetch<{ data: Payment[]; cursor: string | null; hasMore: boolean }>(
        `/payments${qs ? `?${qs}` : ''}`,
      )
    },
    get: (id: string) => this.fetch<Payment>(`/payments/${id}`),
    refund: (paymentId: string, body: { amount?: number; reason?: string; idempotencyKey: string }) =>
      this.fetch<{ refundId: string }>(`/payments/${paymentId}/refunds`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  }

  readonly connectAccounts = {
    list: () => this.fetch<ConnectAccount[]>('/connect-accounts'),
    create: (body: {
      email: string
      businessType?: 'individual' | 'company' | 'non_profit'
      country: string
      returnUrl: string
      refreshUrl: string
    }) => this.fetch<{ account: ConnectAccount; onboardingUrl: string }>('/connect-accounts', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    refreshOnboardingLink: (id: string, returnUrl: string, refreshUrl: string) =>
      this.fetch<{ onboardingUrl: string }>(`/connect-accounts/${id}/onboarding-link`, {
        method: 'POST',
        body: JSON.stringify({ returnUrl, refreshUrl }),
      }),
  }
}

export function createSplitPayClient(opts: SplitPayClientOptions): SplitPayClient {
  return new SplitPayClient(opts)
}
