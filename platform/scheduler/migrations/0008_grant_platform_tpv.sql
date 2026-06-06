-- Grant the scheduler role cross-schema access to platform_tpv so the
-- tpv-session-autoclose job can sweep stale cash sessions. Scoped to the
-- exact tables the job touches: UPDATE only on cash_sessions; the rest are
-- read-only lookups (movements for the theoretical close, settings/config
-- for the per-tenant autoclose window). Conditional so it's a no-op where
-- the tpv module hasn't been deployed yet.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_platform_scheduler')
     AND EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'platform_tpv') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA platform_tpv TO svc_platform_scheduler';
    EXECUTE 'GRANT SELECT, UPDATE ON platform_tpv.cash_sessions TO svc_platform_scheduler';
    EXECUTE 'GRANT SELECT ON platform_tpv.cash_movements TO svc_platform_scheduler';
    EXECUTE 'GRANT SELECT ON platform_tpv.settings TO svc_platform_scheduler';
    EXECUTE 'GRANT SELECT ON platform_tpv.config TO svc_platform_scheduler';
  END IF;
END
$$;
