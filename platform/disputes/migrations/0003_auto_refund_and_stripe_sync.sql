-- Disputes upgrades: auto-refund + Stripe dispute API sync.
--
-- stripe_dispute_id links the internal dispute to the Stripe dispute object
-- (set when splitpay receives a chargeback webhook and creates / matches an
-- internal dispute). Lets the disputes module push evidence back to Stripe
-- via splitpay without re-doing the lookup.
--
-- refund_requested_at marks when resolve() with resolved_buyer triggered
-- an auto-refund event. Used as an idempotency guard so re-resolving the
-- same dispute doesn't double-refund.

ALTER TABLE platform_disputes.disputes
  ADD COLUMN IF NOT EXISTS stripe_dispute_id    TEXT,
  ADD COLUMN IF NOT EXISTS refund_requested_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS evidence_submitted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_platform_disputes_stripe_id
  ON platform_disputes.disputes (stripe_dispute_id)
  WHERE stripe_dispute_id IS NOT NULL;
