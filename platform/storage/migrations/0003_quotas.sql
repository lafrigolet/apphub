-- Per-tenant storage quota (bytes). Optional row per (app_id, tenant_id).
-- Absence of a row = unlimited. Usage is computed on the fly as
-- SUM(size_bytes) over uploaded objects; this table only holds the LIMIT.
CREATE TABLE IF NOT EXISTS platform_storage.quotas (
  app_id        TEXT         NOT NULL,
  tenant_id     UUID         NOT NULL,
  max_bytes     BIGINT       NOT NULL CHECK (max_bytes >= 0),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (app_id, tenant_id)
);

ALTER TABLE platform_storage.quotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_storage.quotas FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_storage_quotas_isolation ON platform_storage.quotas
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON platform_storage.quotas TO svc_platform_storage;

-- Index to speed up SUM(size_bytes) usage queries scoped to uploaded objects.
CREATE INDEX IF NOT EXISTS idx_storage_objects_usage
  ON platform_storage.objects (app_id, tenant_id)
  WHERE status = 'uploaded';
