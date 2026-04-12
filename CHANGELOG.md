# Changelog

All notable changes to this project will be documented in this file.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html)

## [Unreleased]

### Added
- Initial monorepo structure with pnpm workspaces and Turborepo
- `split-payments` microservice v0.1.0
  - Stripe Connect account onboarding (hosted KYC flow)
  - Payment Intent creation with automatic split via `transfer_data` and `application_fee_amount`
  - Multi-beneficiary splits via Stripe Transfers
  - Split rule templates (named, reusable, assignable to tenants)
  - Payout schedule configuration per merchant
  - Refund endpoint with proportional Transfer reversal
  - Dispute management with evidence upload
  - Webhook listener with signature verification
  - Real-time split simulator endpoint
  - Row-level security by `tenant_id` + `sub_tenant_id`
  - Redis idempotency keys for all Stripe calls
  - Full unit test coverage for split engine and services
- Docker Compose for local development
- PostgreSQL 16 with `payments` schema and migrations
- Redis 7 for caching and idempotency
- Nginx API gateway configuration
- Root documentation: README, CLAUDE, CONVENTIONS, CONTRIBUTING, DEVELOPMENT, ARCHITECTURE
