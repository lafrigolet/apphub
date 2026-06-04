-- Adds a per-resource IANA timezone (recommendation #6 — column only; the
-- local->UTC conversion in platform/availability is cross-cutting and tracked
-- separately) and supporting indexes for bulk-holiday / schedule operations.

ALTER TABLE platform_resources.resources
  ADD COLUMN IF NOT EXISTS timezone TEXT;

-- Touch updated_at automatically on UPDATE so PATCH responses are accurate.
CREATE OR REPLACE FUNCTION platform_resources.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_platform_resources_updated_at ON platform_resources.resources;
CREATE TRIGGER trg_platform_resources_updated_at
  BEFORE UPDATE ON platform_resources.resources
  FOR EACH ROW EXECUTE FUNCTION platform_resources.set_updated_at();

-- Speeds up tenant-wide bulk holiday inserts (one INSERT...SELECT per tenant).
CREATE INDEX IF NOT EXISTS idx_platform_resources_active_by_tenant
  ON platform_resources.resources (app_id, tenant_id, is_active);
