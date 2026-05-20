-- ─────────────────────────────────────────────────────────────────────────
-- App: aulavera — second app to follow the monolith-per-app pattern (ADR 013).
--
-- One schema `app_aulavera` for ALL the app's domains (events, disciplines,
-- resources, …). One role `svc_app_aulavera` with full DML on this schema.
-- Tenant isolation is by row, NOT by schema — every table carries
-- (app_id, tenant_id, sub_tenant_id) + RLS.
-- ─────────────────────────────────────────────────────────────────────────

CREATE SCHEMA IF NOT EXISTS app_aulavera;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_app_aulavera') THEN
    CREATE ROLE svc_app_aulavera LOGIN PASSWORD 'app_aulavera_secret';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA app_aulavera TO svc_app_aulavera;

ALTER DEFAULT PRIVILEGES IN SCHEMA app_aulavera
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO svc_app_aulavera;
ALTER DEFAULT PRIVILEGES IN SCHEMA app_aulavera
  GRANT USAGE, SELECT ON SEQUENCES TO svc_app_aulavera;
