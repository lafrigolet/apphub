-- Practitioner payouts module: commission per (service, practitioner), accruals
-- as bookings complete, and periodic close into a payout row.

CREATE TABLE IF NOT EXISTS platform_practitioner_payouts.commission_rules (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id            TEXT         NOT NULL,
  tenant_id         UUID         NOT NULL,
  practitioner_id   UUID         NOT NULL,
  service_id        UUID,
  rate_pct          NUMERIC(5,2) NOT NULL CHECK (rate_pct >= 0 AND rate_pct <= 100),
  flat_fee_cents    BIGINT       NOT NULL DEFAULT 0,
  effective_from    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  effective_until   TIMESTAMPTZ,
  metadata          JSONB        NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_platform_payouts_rules_practitioner
  ON platform_practitioner_payouts.commission_rules (practitioner_id, service_id, effective_from);
ALTER TABLE platform_practitioner_payouts.commission_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_practitioner_payouts.commission_rules FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_payouts_rules_isolation ON platform_practitioner_payouts.commission_rules
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE TABLE IF NOT EXISTS platform_practitioner_payouts.accruals (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id            TEXT         NOT NULL,
  tenant_id         UUID         NOT NULL,
  practitioner_id   UUID         NOT NULL,
  service_id        UUID,
  booking_id        UUID,
  gross_cents       BIGINT       NOT NULL,
  commission_cents  BIGINT       NOT NULL,
  status            TEXT         NOT NULL DEFAULT 'accrued'
                      CHECK (status IN ('accrued','paid','reversed')),
  payout_id         UUID,
  occurred_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  metadata          JSONB        NOT NULL DEFAULT '{}',
  CHECK (commission_cents >= 0)
);
CREATE INDEX IF NOT EXISTS idx_platform_payouts_accruals_practitioner_status
  ON platform_practitioner_payouts.accruals (practitioner_id, status, occurred_at);
CREATE INDEX IF NOT EXISTS idx_platform_payouts_accruals_booking
  ON platform_practitioner_payouts.accruals (booking_id);
ALTER TABLE platform_practitioner_payouts.accruals ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_practitioner_payouts.accruals FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_payouts_accruals_isolation ON platform_practitioner_payouts.accruals
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE TABLE IF NOT EXISTS platform_practitioner_payouts.payouts (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id            TEXT         NOT NULL,
  tenant_id         UUID         NOT NULL,
  practitioner_id   UUID         NOT NULL,
  period_start      DATE         NOT NULL,
  period_end        DATE         NOT NULL,
  total_commission_cents BIGINT  NOT NULL DEFAULT 0,
  currency          CHAR(3)      NOT NULL DEFAULT 'EUR',
  status            TEXT         NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','paid','cancelled')),
  paid_at           TIMESTAMPTZ,
  external_ref      TEXT,
  notes             TEXT,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_platform_payouts_payouts_practitioner_period
  ON platform_practitioner_payouts.payouts (practitioner_id, period_end DESC);
ALTER TABLE platform_practitioner_payouts.payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_practitioner_payouts.payouts FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_payouts_payouts_isolation ON platform_practitioner_payouts.payouts
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

-- practitioner-payouts reads platform_bookings + platform_resources to compute commissions.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_platform_practitioner_payouts') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA platform_bookings  TO svc_platform_practitioner_payouts';
    EXECUTE 'GRANT USAGE ON SCHEMA platform_resources TO svc_platform_practitioner_payouts';
    EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA platform_bookings  TO svc_platform_practitioner_payouts';
    EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA platform_resources TO svc_platform_practitioner_payouts';
  END IF;
END
$$;
