-- Storage module: registry of every uploaded object across all 5 monoliths.
-- The bytes themselves live in S3/MinIO; this table holds metadata + audit.

CREATE TABLE IF NOT EXISTS platform_storage.objects (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT         NOT NULL,
  tenant_id       UUID         NOT NULL,
  sub_tenant_id   UUID,
  owner_user_id   UUID         NOT NULL,
  kind            TEXT         NOT NULL,
  bucket          TEXT         NOT NULL DEFAULT 'apphub',
  key             TEXT         NOT NULL,
  filename        TEXT,
  content_type    TEXT,
  size_bytes      BIGINT,                                       -- NULL until finalized; set from HEAD response
  sha256          TEXT,                                         -- ETag if MinIO supplies it
  status          TEXT         NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','uploaded','deleted')),
  retention_until TIMESTAMPTZ,                                  -- NULL = no expiry
  metadata        JSONB        NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  finalized_at    TIMESTAMPTZ,
  deleted_at      TIMESTAMPTZ,
  UNIQUE (bucket, key)
);

CREATE INDEX IF NOT EXISTS idx_storage_objects_tenant_kind
  ON platform_storage.objects (tenant_id, kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_storage_objects_owner
  ON platform_storage.objects (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_storage_objects_status
  ON platform_storage.objects (status, created_at);
CREATE INDEX IF NOT EXISTS idx_storage_objects_retention
  ON platform_storage.objects (retention_until)
  WHERE retention_until IS NOT NULL;

ALTER TABLE platform_storage.objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_storage.objects FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_storage_objects_isolation ON platform_storage.objects
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );
