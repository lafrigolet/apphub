CREATE TABLE IF NOT EXISTS platform_tenants.audit_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ts             TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_user_id  UUID,
  actor_role     TEXT,
  app_id         TEXT NOT NULL,
  tenant_id      UUID,
  action         TEXT NOT NULL,
  detail         TEXT,
  ip             TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_ts ON platform_tenants.audit_log (tenant_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_app_ts    ON platform_tenants.audit_log (app_id, ts DESC);
