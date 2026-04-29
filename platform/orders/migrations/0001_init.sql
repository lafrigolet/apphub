-- Orders module: persistent ledger of marketplace orders.
-- States: pending → paid → fulfilled → shipped → delivered → completed
--                              \  \                          \--→ cancelled / refunded

CREATE TABLE IF NOT EXISTS platform_orders.orders (
  id                        UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id                    TEXT         NOT NULL,
  tenant_id                 UUID         NOT NULL,
  sub_tenant_id             UUID,
  buyer_user_id             UUID         NOT NULL,
  status                    TEXT         NOT NULL DEFAULT 'pending',
  currency                  CHAR(3)      NOT NULL,
  subtotal_cents            BIGINT       NOT NULL DEFAULT 0,
  tax_cents                 BIGINT       NOT NULL DEFAULT 0,
  shipping_cents            BIGINT       NOT NULL DEFAULT 0,
  total_cents               BIGINT       NOT NULL DEFAULT 0,
  stripe_payment_intent_id  TEXT,
  splitpay_split_rule_id    UUID,
  idempotency_key           TEXT,
  metadata                  JSONB        NOT NULL DEFAULT '{}',
  created_at                TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_orders_orders_tenant_status
  ON platform_orders.orders (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_platform_orders_orders_buyer
  ON platform_orders.orders (buyer_user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_orders_orders_idem
  ON platform_orders.orders (app_id, tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE platform_orders.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_orders.orders FORCE ROW LEVEL SECURITY;

CREATE POLICY platform_orders_orders_isolation ON platform_orders.orders
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE TABLE IF NOT EXISTS platform_orders.order_items (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id           TEXT         NOT NULL,
  tenant_id        UUID         NOT NULL,
  order_id         UUID         NOT NULL REFERENCES platform_orders.orders (id) ON DELETE CASCADE,
  sku              TEXT         NOT NULL,
  product_name     TEXT         NOT NULL,
  qty              INT          NOT NULL CHECK (qty > 0),
  unit_price_cents BIGINT       NOT NULL,
  vendor_tenant_id UUID,
  metadata         JSONB        NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_platform_orders_items_order
  ON platform_orders.order_items (order_id);

ALTER TABLE platform_orders.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_orders.order_items FORCE ROW LEVEL SECURITY;

CREATE POLICY platform_orders_items_isolation ON platform_orders.order_items
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE TABLE IF NOT EXISTS platform_orders.order_addresses (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id        TEXT         NOT NULL,
  tenant_id     UUID         NOT NULL,
  order_id      UUID         NOT NULL REFERENCES platform_orders.orders (id) ON DELETE CASCADE,
  kind          TEXT         NOT NULL CHECK (kind IN ('shipping', 'billing')),
  full_name     TEXT,
  line1         TEXT,
  line2         TEXT,
  city          TEXT,
  region        TEXT,
  postal_code   TEXT,
  country       CHAR(2),
  phone         TEXT
);

CREATE INDEX IF NOT EXISTS idx_platform_orders_addresses_order
  ON platform_orders.order_addresses (order_id);

ALTER TABLE platform_orders.order_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_orders.order_addresses FORCE ROW LEVEL SECURITY;

CREATE POLICY platform_orders_addresses_isolation ON platform_orders.order_addresses
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE TABLE IF NOT EXISTS platform_orders.order_status_history (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT         NOT NULL,
  tenant_id       UUID         NOT NULL,
  order_id        UUID         NOT NULL REFERENCES platform_orders.orders (id) ON DELETE CASCADE,
  from_status     TEXT,
  to_status       TEXT         NOT NULL,
  actor_user_id   UUID,
  actor_role      TEXT,
  reason          TEXT,
  ts              TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_orders_history_order
  ON platform_orders.order_status_history (order_id, ts DESC);

ALTER TABLE platform_orders.order_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_orders.order_status_history FORCE ROW LEVEL SECURITY;

CREATE POLICY platform_orders_history_isolation ON platform_orders.order_status_history
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );
