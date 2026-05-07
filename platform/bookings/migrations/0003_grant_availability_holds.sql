-- bookings.create needs to consume an availability hold inside its
-- transaction (atomic "convert hold to booking"), and as a defence in depth
-- it also needs to read the holds table to detect any concurrent in-flight
-- reservation. Grant the bookings runtime role USAGE on the availability
-- schema and SELECT + DELETE on platform_availability.holds.
--
-- (Cross-schema reads in this codebase are wired in the consumer module's
-- migration; see platform/availability/migrations/0001_init.sql for the
-- mirror grants in the other direction.)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_platform_bookings') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA platform_availability TO svc_platform_bookings';
    EXECUTE 'GRANT SELECT, DELETE ON platform_availability.holds TO svc_platform_bookings';
  END IF;
END
$$;
