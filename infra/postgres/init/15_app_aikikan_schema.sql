-- ─────────────────────────────────────────────────────────────────────────
-- App: aikikan — first app to adopt the monolith-per-app pattern (ADR 013).
--
-- One schema `app_aikikan` for ALL the app's domains (members, events,
-- dues, certificates, …). One role `svc_app_aikikan` with full DML on
-- this schema. Tenant isolation is by row, NOT by schema — every table
-- carries (app_id, tenant_id, sub_tenant_id) + RLS.
-- ─────────────────────────────────────────────────────────────────────────

CREATE SCHEMA IF NOT EXISTS app_aikikan;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_app_aikikan') THEN
    CREATE ROLE svc_app_aikikan LOGIN PASSWORD 'app_aikikan_secret';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA app_aikikan TO svc_app_aikikan;

ALTER DEFAULT PRIVILEGES IN SCHEMA app_aikikan
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO svc_app_aikikan;
ALTER DEFAULT PRIVILEGES IN SCHEMA app_aikikan
  GRANT USAGE, SELECT ON SEQUENCES TO svc_app_aikikan;
