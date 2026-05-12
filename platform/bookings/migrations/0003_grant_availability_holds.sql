-- bookings.create needs to consume an availability hold inside its
-- transaction (atomic "convert hold to booking"). El GRANT canónico
-- ahora vive en platform/availability/migrations/0002_grant_bookings_access.sql
-- porque en platform-appointments las migrations de bookings corren ANTES
-- que las de availability (ver moduleDescriptors en server.js). En una DB
-- virgen, este 0003 se ejecutaba pero la tabla `platform_availability.holds`
-- aún no existía → ERROR 42P01.
--
-- Para no romper DBs ya migradas en dev (donde este 0003 SÍ se aplicó
-- limpio), dejamos el bloque tolerante: solo concede si la tabla y el role
-- existen ya. En DB virgen es no-op; en DB existente regenera privilegios
-- (idempotente). Ver la migración 0002 de availability para el GRANT real.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_platform_bookings')
     AND EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'platform_availability' AND table_name = 'holds'
     ) THEN
    EXECUTE 'GRANT USAGE ON SCHEMA platform_availability TO svc_platform_bookings';
    EXECUTE 'GRANT SELECT, DELETE ON platform_availability.holds TO svc_platform_bookings';
  END IF;
END
$$;
