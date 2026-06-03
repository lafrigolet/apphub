-- Grant the scheduler role cross-schema access to platform_chat so the chat
-- jobs (scheduled-send dispatch, ephemeral purge, retention purge, support SLA)
-- can read + write the columns they own. Conditional so it's a no-op where the
-- chat module hasn't been deployed yet.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_platform_scheduler')
     AND EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'platform_chat') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA platform_chat TO svc_platform_scheduler';
    EXECUTE 'GRANT SELECT, UPDATE, DELETE ON ALL TABLES IN SCHEMA platform_chat TO svc_platform_scheduler';
  END IF;
END
$$;
