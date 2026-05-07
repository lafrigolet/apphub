-- The basket-abandoned job (and any future scheduler job that needs to
-- email the user identified by a Redis-only entity) hydrates the user's
-- email from platform_auth.users. svc_platform_scheduler is BYPASSRLS so
-- a plain SELECT works once the grant is in place.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_platform_scheduler')
     AND EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'platform_auth')
  THEN
    EXECUTE 'GRANT USAGE ON SCHEMA platform_auth TO svc_platform_scheduler';
    EXECUTE 'GRANT SELECT ON platform_auth.users TO svc_platform_scheduler';
  END IF;
END
$$;
