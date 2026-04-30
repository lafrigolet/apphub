-- Floor-plan module: rooms (sections), tables and real-time table state.

CREATE TABLE IF NOT EXISTS platform_floor_plan.sections (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id        TEXT         NOT NULL,
  tenant_id     UUID         NOT NULL,
  name          TEXT         NOT NULL,
  description   TEXT,
  is_outdoor    BOOLEAN      NOT NULL DEFAULT FALSE,
  display_order INT          NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_floor_plan_sections_tenant
  ON platform_floor_plan.sections (tenant_id);

ALTER TABLE platform_floor_plan.sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_floor_plan.sections FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_floor_plan_sections_isolation ON platform_floor_plan.sections
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE TABLE IF NOT EXISTS platform_floor_plan.tables (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id        TEXT         NOT NULL,
  tenant_id     UUID         NOT NULL,
  section_id    UUID         NOT NULL REFERENCES platform_floor_plan.sections (id) ON DELETE CASCADE,
  code          TEXT         NOT NULL,
  capacity      INT          NOT NULL CHECK (capacity > 0),
  shape         TEXT         NOT NULL DEFAULT 'square' CHECK (shape IN ('square','round','rectangle','oval')),
  status        TEXT         NOT NULL DEFAULT 'free'
                  CHECK (status IN ('free','reserved','occupied','dirty','out_of_service')),
  combined_with UUID[]       NOT NULL DEFAULT '{}',
  pos_x         INT,
  pos_y         INT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_floor_plan_tables_code
  ON platform_floor_plan.tables (app_id, tenant_id, code);
CREATE INDEX IF NOT EXISTS idx_platform_floor_plan_tables_section
  ON platform_floor_plan.tables (section_id, status);

ALTER TABLE platform_floor_plan.tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_floor_plan.tables FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_floor_plan_tables_isolation ON platform_floor_plan.tables
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

-- Audit trail of state transitions; useful to investigate "why was this table held"
CREATE TABLE IF NOT EXISTS platform_floor_plan.table_events (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id        TEXT         NOT NULL,
  tenant_id     UUID         NOT NULL,
  table_id      UUID         NOT NULL REFERENCES platform_floor_plan.tables (id) ON DELETE CASCADE,
  from_status   TEXT,
  to_status     TEXT         NOT NULL,
  reservation_id UUID,
  party_size    INT,
  actor_user_id UUID,
  ts            TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_floor_plan_table_events_table
  ON platform_floor_plan.table_events (table_id, ts DESC);

ALTER TABLE platform_floor_plan.table_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_floor_plan.table_events FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_floor_plan_table_events_isolation ON platform_floor_plan.table_events
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );
