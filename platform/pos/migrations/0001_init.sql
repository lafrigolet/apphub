-- POS module: open table bills, bill items, payments and tips.

CREATE TABLE IF NOT EXISTS platform_pos.bills (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT         NOT NULL,
  tenant_id       UUID         NOT NULL,
  sub_tenant_id   UUID,
  table_id        UUID,
  table_code      TEXT,
  server_user_id  UUID,
  status          TEXT         NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','closed','paid','cancelled','split')),
  currency        CHAR(3)      NOT NULL DEFAULT 'EUR',
  subtotal_cents  BIGINT       NOT NULL DEFAULT 0,
  tax_cents       BIGINT       NOT NULL DEFAULT 0,
  tip_cents       BIGINT       NOT NULL DEFAULT 0,
  total_cents     BIGINT       NOT NULL DEFAULT 0,
  notes           TEXT,
  opened_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  closed_at       TIMESTAMPTZ,
  metadata        JSONB        NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_platform_pos_bills_tenant_status
  ON platform_pos.bills (tenant_id, status, opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_pos_bills_table
  ON platform_pos.bills (table_id, status);

ALTER TABLE platform_pos.bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_pos.bills FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_pos_bills_isolation ON platform_pos.bills
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE TABLE IF NOT EXISTS platform_pos.bill_items (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT         NOT NULL,
  tenant_id       UUID         NOT NULL,
  bill_id         UUID         NOT NULL REFERENCES platform_pos.bills (id) ON DELETE CASCADE,
  sku             TEXT         NOT NULL,
  name            TEXT         NOT NULL,
  qty             INT          NOT NULL CHECK (qty > 0),
  unit_price_cents BIGINT      NOT NULL CHECK (unit_price_cents >= 0),
  modifiers       JSONB        NOT NULL DEFAULT '[]',
  course          TEXT         NOT NULL DEFAULT 'main',
  notes           TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_pos_items_bill
  ON platform_pos.bill_items (bill_id);

ALTER TABLE platform_pos.bill_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_pos.bill_items FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_pos_items_isolation ON platform_pos.bill_items
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE TABLE IF NOT EXISTS platform_pos.bill_payments (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT         NOT NULL,
  tenant_id       UUID         NOT NULL,
  bill_id         UUID         NOT NULL REFERENCES platform_pos.bills (id) ON DELETE CASCADE,
  method          TEXT         NOT NULL CHECK (method IN ('card','cash','wallet','voucher','external')),
  amount_cents    BIGINT       NOT NULL CHECK (amount_cents > 0),
  tip_cents       BIGINT       NOT NULL DEFAULT 0,
  external_ref    TEXT,
  paid_at         TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_pos_payments_bill
  ON platform_pos.bill_payments (bill_id);

ALTER TABLE platform_pos.bill_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_pos.bill_payments FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_pos_payments_isolation ON platform_pos.bill_payments
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

-- Sub-bills for split-by-share or split-by-items
CREATE TABLE IF NOT EXISTS platform_pos.bill_splits (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT         NOT NULL,
  tenant_id       UUID         NOT NULL,
  parent_bill_id  UUID         NOT NULL REFERENCES platform_pos.bills (id) ON DELETE CASCADE,
  share_index     INT          NOT NULL,
  amount_cents    BIGINT       NOT NULL CHECK (amount_cents >= 0),
  paid            BOOLEAN      NOT NULL DEFAULT FALSE,
  payment_id      UUID         REFERENCES platform_pos.bill_payments (id)
);

CREATE INDEX IF NOT EXISTS idx_platform_pos_splits_parent
  ON platform_pos.bill_splits (parent_bill_id);

ALTER TABLE platform_pos.bill_splits ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_pos.bill_splits FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_pos_splits_isolation ON platform_pos.bill_splits
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );
