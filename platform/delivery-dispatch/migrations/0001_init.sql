-- Delivery dispatch: zones, riders, deliveries.
-- Generic enough for both fleet propio and external (Glovo/UberEats/etc) via the
-- carrier field on deliveries (e.g. carrier='glovo' with external_ref).

CREATE TABLE IF NOT EXISTS platform_delivery_dispatch.zones (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT         NOT NULL,
  tenant_id       UUID         NOT NULL,
  name            TEXT         NOT NULL,
  polygon         JSONB        NOT NULL,
  base_fee_cents  BIGINT       NOT NULL DEFAULT 0,
  per_km_cents    BIGINT       NOT NULL DEFAULT 0,
  min_order_cents BIGINT       NOT NULL DEFAULT 0,
  is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_dd_zones_tenant
  ON platform_delivery_dispatch.zones (tenant_id);

ALTER TABLE platform_delivery_dispatch.zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_delivery_dispatch.zones FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_dd_zones_isolation ON platform_delivery_dispatch.zones
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE TABLE IF NOT EXISTS platform_delivery_dispatch.riders (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT         NOT NULL,
  tenant_id       UUID         NOT NULL,
  user_id         UUID,
  display_name    TEXT         NOT NULL,
  phone           TEXT,
  vehicle         TEXT         CHECK (vehicle IN ('bike','ebike','scooter','car','foot') OR vehicle IS NULL),
  status          TEXT         NOT NULL DEFAULT 'offline'
                    CHECK (status IN ('offline','available','assigned','en_route','returning')),
  last_lat        DOUBLE PRECISION,
  last_lng        DOUBLE PRECISION,
  last_seen_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_platform_dd_riders_tenant_status
  ON platform_delivery_dispatch.riders (tenant_id, status);

ALTER TABLE platform_delivery_dispatch.riders ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_delivery_dispatch.riders FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_dd_riders_isolation ON platform_delivery_dispatch.riders
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE TABLE IF NOT EXISTS platform_delivery_dispatch.deliveries (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT         NOT NULL,
  tenant_id       UUID         NOT NULL,
  order_id        UUID         NOT NULL,
  carrier         TEXT         NOT NULL DEFAULT 'own'
                    CHECK (carrier IN ('own','glovo','uber','justeat','deliveroo','other')),
  external_ref    TEXT,
  rider_id        UUID         REFERENCES platform_delivery_dispatch.riders (id),
  zone_id         UUID         REFERENCES platform_delivery_dispatch.zones (id),
  pickup_address  JSONB,
  drop_address    JSONB        NOT NULL,
  fee_cents       BIGINT       NOT NULL DEFAULT 0,
  status          TEXT         NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','dispatched','picked_up','delivered','cancelled','failed')),
  estimated_minutes INT,
  dispatched_at   TIMESTAMPTZ,
  picked_up_at    TIMESTAMPTZ,
  delivered_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_dd_deliveries_tenant_status
  ON platform_delivery_dispatch.deliveries (tenant_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_platform_dd_deliveries_order
  ON platform_delivery_dispatch.deliveries (order_id);

ALTER TABLE platform_delivery_dispatch.deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_delivery_dispatch.deliveries FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_dd_deliveries_isolation ON platform_delivery_dispatch.deliveries
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE TABLE IF NOT EXISTS platform_delivery_dispatch.delivery_events (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT         NOT NULL,
  tenant_id       UUID         NOT NULL,
  delivery_id     UUID         NOT NULL REFERENCES platform_delivery_dispatch.deliveries (id) ON DELETE CASCADE,
  event_type      TEXT         NOT NULL,
  lat             DOUBLE PRECISION,
  lng             DOUBLE PRECISION,
  payload         JSONB        NOT NULL DEFAULT '{}',
  ts              TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_dd_events_delivery
  ON platform_delivery_dispatch.delivery_events (delivery_id, ts DESC);

ALTER TABLE platform_delivery_dispatch.delivery_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_delivery_dispatch.delivery_events FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_dd_events_isolation ON platform_delivery_dispatch.delivery_events
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );
