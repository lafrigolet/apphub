-- GRANT a svc_platform_bookings sobre platform_availability.holds. Vive
-- aquí en availability (y no en bookings/0003) porque en
-- platform-appointments el orden de migrations es:
--   services → resources → bookings → availability → ...
-- de forma que cuando bookings/0003 corre, la tabla holds aún no existe
-- (la crea availability/0001 después). Mover el GRANT a una migración de
-- availability que corre DESPUÉS de crear la tabla rompe ese deadlock.
--
-- Idempotente: en DBs ya migradas (dev), bookings/0003 había concedido
-- los mismos privilegios; re-concederlos es no-op en postgres.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_platform_bookings') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA platform_availability TO svc_platform_bookings';
    EXECUTE 'GRANT SELECT, DELETE ON platform_availability.holds TO svc_platform_bookings';
  END IF;
END
$$;
