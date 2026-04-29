-- Disputes module: operational dispute resolution (pre-chargeback).
-- Distinct from splitpay_core.disputes (Stripe chargebacks). This is the
-- internal flow ("I never received my order", "the product is damaged").

CREATE TABLE IF NOT EXISTS platform_disputes.disputes (
  id                       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id                   TEXT         NOT NULL,
  tenant_id                UUID         NOT NULL,
  order_id                 UUID         NOT NULL,
  buyer_user_id            UUID         NOT NULL,
  reason                   TEXT         NOT NULL,
  description              TEXT,
  status                   TEXT         NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'investigating', 'resolved_buyer', 'resolved_vendor', 'escalated_chargeback')),
  resolution_amount_cents  BIGINT,
  resolution_notes         TEXT,
  resolved_at              TIMESTAMPTZ,
  resolved_by_user_id      UUID,
  created_at               TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_disputes_order
  ON platform_disputes.disputes (order_id);

CREATE INDEX IF NOT EXISTS idx_platform_disputes_tenant_status
  ON platform_disputes.disputes (tenant_id, status, created_at DESC);

ALTER TABLE platform_disputes.disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_disputes.disputes FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_disputes_isolation ON platform_disputes.disputes
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE TABLE IF NOT EXISTS platform_disputes.dispute_messages (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT         NOT NULL,
  tenant_id       UUID         NOT NULL,
  dispute_id      UUID         NOT NULL REFERENCES platform_disputes.disputes (id) ON DELETE CASCADE,
  sender_user_id  UUID         NOT NULL,
  sender_role     TEXT         NOT NULL CHECK (sender_role IN ('buyer', 'vendor', 'staff')),
  body            TEXT         NOT NULL,
  attachments     JSONB        NOT NULL DEFAULT '[]',
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_disputes_messages_dispute
  ON platform_disputes.dispute_messages (dispute_id, created_at ASC);

ALTER TABLE platform_disputes.dispute_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_disputes.dispute_messages FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_disputes_messages_isolation ON platform_disputes.dispute_messages
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE TABLE IF NOT EXISTS platform_disputes.dispute_evidence (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT         NOT NULL,
  tenant_id       UUID         NOT NULL,
  dispute_id      UUID         NOT NULL REFERENCES platform_disputes.disputes (id) ON DELETE CASCADE,
  kind            TEXT         NOT NULL,
  data            JSONB        NOT NULL DEFAULT '{}',
  uploaded_by     UUID,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_disputes_evidence_dispute
  ON platform_disputes.dispute_evidence (dispute_id);

ALTER TABLE platform_disputes.dispute_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_disputes.dispute_evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_disputes_evidence_isolation ON platform_disputes.dispute_evidence
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );
