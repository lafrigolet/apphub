-- Download / access audit log. Every presigned-GET mint is recorded here so
-- compliance modules can answer "who downloaded this object, when, from where"
-- for sensitive kinds (signature, telehealth_recording, payout_report, …).
-- Tenant-scoped + RLS, identical isolation contract to platform_storage.objects.
CREATE TABLE IF NOT EXISTS platform_storage.access_log (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id        TEXT         NOT NULL,
  tenant_id     UUID         NOT NULL,
  object_id     UUID         NOT NULL,
  kind          TEXT,
  action        TEXT         NOT NULL DEFAULT 'download'
                  CHECK (action IN ('download')),
  user_id       UUID,
  ip            TEXT,
  user_agent    TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_storage_access_log_object
  ON platform_storage.access_log (app_id, tenant_id, object_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_storage_access_log_tenant
  ON platform_storage.access_log (app_id, tenant_id, created_at DESC);

ALTER TABLE platform_storage.access_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_storage.access_log FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_storage_access_log_isolation ON platform_storage.access_log
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

GRANT SELECT, INSERT ON platform_storage.access_log TO svc_platform_storage;

-- Index to make retention sweeps cheap: objects whose retention_until has
-- passed and that are still live (not already purged). Complements the
-- existing partial idx_storage_objects_retention.
CREATE INDEX IF NOT EXISTS idx_storage_objects_retention_status
  ON platform_storage.objects (retention_until, status)
  WHERE retention_until IS NOT NULL;
