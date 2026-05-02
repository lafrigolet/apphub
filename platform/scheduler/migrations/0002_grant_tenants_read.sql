-- The booking-reminders and reservation-reminders jobs now LEFT JOIN
-- platform_tenants.tenants to resolve default_locale when the booking /
-- reservation row has no explicit locale. Grant the scheduler role read
-- access to that schema so the JOIN succeeds.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_platform_scheduler')
     AND EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'platform_tenants')
  THEN
    EXECUTE 'GRANT USAGE ON SCHEMA platform_tenants TO svc_platform_scheduler';
    EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA platform_tenants TO svc_platform_scheduler';
  END IF;
END
$$;
