-- Tenant bootstrap: marca temporal de cuándo staff inició el provisioning
-- y cuándo el owner ha cerrado el wizard de Fase B. bootstrap_completed_at
-- es write-once: una vez puesto, ya no vuelve a NULL aunque la subscripción
-- pase a past_due, etc. — eso lo gestiona la UI con un banner separado.

ALTER TABLE platform_tenants.tenants
  ADD COLUMN IF NOT EXISTS bootstrap_started_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bootstrap_completed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_tenants_bootstrap_pending
  ON platform_tenants.tenants (bootstrap_started_at)
  WHERE bootstrap_completed_at IS NULL;
