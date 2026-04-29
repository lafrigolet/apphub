-- Shipping module: zones, rates, shipments, tracking events.

CREATE TABLE IF NOT EXISTS platform_shipping.shipping_zones (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT         NOT NULL,
  tenant_id       UUID         NOT NULL,
  name            TEXT         NOT NULL,
  country_codes   TEXT[]       NOT NULL DEFAULT '{}',
  region_codes    TEXT[]       NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_shipping_zones_tenant
  ON platform_shipping.shipping_zones (tenant_id);

ALTER TABLE platform_shipping.shipping_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_shipping.shipping_zones FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_shipping_zones_isolation ON platform_shipping.shipping_zones
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE TABLE IF NOT EXISTS platform_shipping.shipping_rates (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT         NOT NULL,
  tenant_id       UUID         NOT NULL,
  zone_id         UUID         REFERENCES platform_shipping.shipping_zones (id) ON DELETE CASCADE,
  name            TEXT         NOT NULL,
  price_cents     BIGINT       NOT NULL CHECK (price_cents >= 0),
  min_weight_g    INT          NOT NULL DEFAULT 0,
  max_weight_g    INT,
  eta_days_min    INT,
  eta_days_max    INT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_shipping_rates_tenant
  ON platform_shipping.shipping_rates (tenant_id);

ALTER TABLE platform_shipping.shipping_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_shipping.shipping_rates FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_shipping_rates_isolation ON platform_shipping.shipping_rates
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE TABLE IF NOT EXISTS platform_shipping.shipments (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT         NOT NULL,
  tenant_id       UUID         NOT NULL,
  order_id        UUID         NOT NULL,
  carrier         TEXT,
  tracking_code   TEXT,
  status          TEXT         NOT NULL DEFAULT 'pending',
  rate_id         UUID         REFERENCES platform_shipping.shipping_rates (id),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  shipped_at      TIMESTAMPTZ,
  delivered_at    TIMESTAMPTZ,
  metadata        JSONB        NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_platform_shipping_shipments_order
  ON platform_shipping.shipments (order_id);

CREATE INDEX IF NOT EXISTS idx_platform_shipping_shipments_status
  ON platform_shipping.shipments (tenant_id, status);

ALTER TABLE platform_shipping.shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_shipping.shipments FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_shipping_shipments_isolation ON platform_shipping.shipments
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE TABLE IF NOT EXISTS platform_shipping.shipment_events (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT         NOT NULL,
  tenant_id       UUID         NOT NULL,
  shipment_id     UUID         NOT NULL REFERENCES platform_shipping.shipments (id) ON DELETE CASCADE,
  code            TEXT         NOT NULL,
  description     TEXT,
  location        TEXT,
  ts              TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_shipping_events_shipment
  ON platform_shipping.shipment_events (shipment_id, ts ASC);

ALTER TABLE platform_shipping.shipment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_shipping.shipment_events FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_shipping_events_isolation ON platform_shipping.shipment_events
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );
