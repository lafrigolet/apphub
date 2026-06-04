-- POS module — priority use cases:
--  · #1 bill cancellation (cancelled_by + reason audit columns)
--  · #3 fire-to-kitchen flow (fired_at on items, so /fire is idempotent per item)
--  · #5 per-tenant tip suggestions (pos_settings, runtime-config style)
--  · #6 split-by-item (bill_split_items join table)

-- ── #1 cancellation audit on bills ──────────────────────────────────────
ALTER TABLE platform_pos.bills
  ADD COLUMN IF NOT EXISTS cancelled_by   UUID,
  ADD COLUMN IF NOT EXISTS cancel_reason  TEXT;

-- ── #3 fire-to-kitchen: track which items were already sent to KDS ───────
ALTER TABLE platform_pos.bill_items
  ADD COLUMN IF NOT EXISTS fired_at  TIMESTAMPTZ;

-- ── #5 per-tenant POS settings (tip suggestions, default tax rate) ───────
-- One row per (app_id, tenant_id[, sub_tenant_id]). Mirrors the module
-- runtime-config pattern: a `key`/`value` store scoped per tenant.
CREATE TABLE IF NOT EXISTS platform_pos.pos_settings (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT         NOT NULL,
  tenant_id       UUID         NOT NULL,
  sub_tenant_id   UUID,
  -- tip suggestion percentages offered at checkout, e.g. [5,10,15]
  tip_suggestions JSONB        NOT NULL DEFAULT '[]',
  -- whether the customer may also enter a free (custom) tip
  tip_allow_custom BOOLEAN     NOT NULL DEFAULT TRUE,
  -- default tax rate as a fraction (0.10 = 10%); NULL → module default
  default_tax_rate NUMERIC(5,4),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (app_id, tenant_id, sub_tenant_id)
);

ALTER TABLE platform_pos.pos_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_pos.pos_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_pos_settings_isolation ON platform_pos.pos_settings
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

-- ── #6 split-by-item: associate concrete bill_items to a split share ─────
CREATE TABLE IF NOT EXISTS platform_pos.bill_split_items (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT         NOT NULL,
  tenant_id       UUID         NOT NULL,
  split_id        UUID         NOT NULL REFERENCES platform_pos.bill_splits (id) ON DELETE CASCADE,
  bill_item_id    UUID         NOT NULL REFERENCES platform_pos.bill_items  (id) ON DELETE CASCADE,
  UNIQUE (app_id, tenant_id, bill_item_id)
);

CREATE INDEX IF NOT EXISTS idx_platform_pos_split_items_split
  ON platform_pos.bill_split_items (split_id);

ALTER TABLE platform_pos.bill_split_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_pos.bill_split_items FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_pos_split_items_isolation ON platform_pos.bill_split_items
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );
