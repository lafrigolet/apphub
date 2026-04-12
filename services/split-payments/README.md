# split-payments

Stripe Connect split payments microservice. Handles merchant onboarding (KYC),
payment intent creation with automatic splits, multi-beneficiary transfers,
payout scheduling, refunds with proportional reversals, and dispute management.

## API Reference

Base URL: `http://localhost:3001/v1` (or via gateway: `http://localhost:8080/api/payments/`)

All endpoints (except `/health` and `/v1/webhooks/stripe`) require:
```
Authorization: Bearer <jwt>
```

The JWT must contain `tenant_id` (required) and `sub_tenant_id` (optional) claims.

### Connect accounts

| Method | Path | Description |
|---|---|---|
| `POST` | `/v1/connect-accounts` | Create & start KYC onboarding for a merchant |
| `GET` | `/v1/connect-accounts` | List all merchant accounts for the tenant |
| `POST` | `/v1/connect-accounts/:id/onboarding-link` | Refresh an expired onboarding link |

### Split rules

| Method | Path | Description |
|---|---|---|
| `POST` | `/v1/split-rules` | Create a named split rule template |
| `GET` | `/v1/split-rules` | List all active split rules for the tenant |
| `GET` | `/v1/split-rules/:id` | Get a specific split rule |
| `DELETE` | `/v1/split-rules/:id` | Deactivate a split rule |
| `POST` | `/v1/split-rules/simulate` | Preview split breakdown for a given amount |

### Payments

| Method | Path | Description |
|---|---|---|
| `POST` | `/v1/payments` | Create a PaymentIntent with split |
| `GET` | `/v1/payments` | List payments (cursor-paginated) |
| `GET` | `/v1/payments/:id` | Get a specific payment |
| `POST` | `/v1/payments/:id/refunds` | Issue a full or partial refund |

### Webhooks

| Method | Path | Description |
|---|---|---|
| `POST` | `/v1/webhooks/stripe` | Receive Stripe events (raw body, no auth) |

## Split rule schema

```json
{
  "name": "Marketplace Standard",
  "platformFeePercent": 15,
  "recipients": [
    { "accountId": "acct_xxx", "label": "Merchant",  "percentage": 80 },
    { "accountId": "acct_yyy", "label": "Affiliate", "percentage": 5  }
  ]
}
```

`platformFeePercent` + sum of `recipients[].percentage` must equal exactly **100**.

## Running tests

```bash
pnpm test               # run all tests
pnpm test:coverage      # with coverage report
pnpm test:watch         # watch mode
```

## Docs

- [User stories (PDF)](./docs/splitpay-historias-usuario-v1.0.pdf)
- [Frontend prototype (HTML)](./docs/splitpay-prototype.html)
