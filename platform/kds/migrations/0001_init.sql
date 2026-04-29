-- KDS module: kitchen tickets routed to stations.
-- Ticket per (order_id, station). Items grouped by course for coursing.

CREATE TABLE IF NOT EXISTS platform_kds.stations (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id        TEXT         NOT NULL,
  tenant_id     UUID         NOT NULL,
  name          TEXT         NOT NULL,
  display_order INT          NOT NULL DEFAULT 0,
  routes_courses TEXT[]      NOT NULL DEFAULT '{}',
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_platform_kds_stations_tenant
  ON platform_kds.stations (tenant_id);

ALTER TABLE platform_kds.stations ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_kds.stations FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_kds_stations_isolation ON platform_kds.stations
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE TABLE IF NOT EXISTS platform_kds.tickets (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT         NOT NULL,
  tenant_id       UUID         NOT NULL,
  order_id        UUID         NOT NULL,
  station_id      UUID         REFERENCES platform_kds.stations (id),
  course          TEXT         NOT NULL DEFAULT 'main',
  status          TEXT         NOT NULL DEFAULT 'fired'
                    CHECK (status IN ('fired','in_progress','ready','picked_up','cancelled')),
  table_code      TEXT,
  notes           TEXT,
  fired_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  acked_at        TIMESTAMPTZ,
  ready_at        TIMESTAMPTZ,
  picked_up_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_platform_kds_tickets_station
  ON platform_kds.tickets (station_id, status, fired_at);
CREATE INDEX IF NOT EXISTS idx_platform_kds_tickets_order
  ON platform_kds.tickets (order_id);

ALTER TABLE platform_kds.tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_kds.tickets FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_kds_tickets_isolation ON platform_kds.tickets
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE TABLE IF NOT EXISTS platform_kds.ticket_items (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT         NOT NULL,
  tenant_id       UUID         NOT NULL,
  ticket_id       UUID         NOT NULL REFERENCES platform_kds.tickets (id) ON DELETE CASCADE,
  sku             TEXT         NOT NULL,
  name            TEXT         NOT NULL,
  qty             INT          NOT NULL CHECK (qty > 0),
  modifiers       JSONB        NOT NULL DEFAULT '[]',
  notes           TEXT
);

CREATE INDEX IF NOT EXISTS idx_platform_kds_ticket_items_ticket
  ON platform_kds.ticket_items (ticket_id);

ALTER TABLE platform_kds.ticket_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_kds.ticket_items FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_kds_ticket_items_isolation ON platform_kds.ticket_items
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );
