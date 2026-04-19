CREATE TABLE IF NOT EXISTS platform_catalog.items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id        TEXT NOT NULL,
  tenant_id     UUID NOT NULL,
  sub_tenant_id UUID,
  name          TEXT NOT NULL,
  description   TEXT,
  price_cents   INT NOT NULL DEFAULT 0,
  currency      TEXT NOT NULL DEFAULT 'eur',
  category      TEXT,
  metadata      JSONB,
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_platform_catalog_tenant ON platform_catalog.items (tenant_id);
ALTER TABLE platform_catalog.items ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_catalog.items FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_catalog_isolation ON platform_catalog.items
  USING (app_id = current_setting('app.app_id', true) AND tenant_id = current_setting('app.tenant_id', true)::uuid);
