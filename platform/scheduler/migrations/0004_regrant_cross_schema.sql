-- Re-aplica TODOS los GRANTs cross-schema del scheduler sobre tablas
-- existentes + ALTER DEFAULT PRIVILEGES para que tablas futuras
-- hereden automáticamente.
--
-- Origen del bug: las migrations 0001/0002/0003 usaban
--   GRANT … ON ALL TABLES IN SCHEMA <s> TO svc_platform_scheduler
-- que SÓLO aplica a las tablas existentes en el momento de ejecución.
-- Como platform-scheduler vive en su propio container y arranca en
-- paralelo con los demás (platform-core, platform-marketplace,
-- platform-restaurant, platform-appointments), las migrations del
-- scheduler pueden correr ANTES de que esos containers hayan creado
-- sus tablas. Resultado: GRANT no-op silencioso → jobs fallan con
-- "permission denied for table tenants" / "holds" en runtime.
--
-- Fix permanente:
--   1. Re-ejecutar el GRANT sobre tablas existentes (cubre DBs ya
--      desplegadas como producción actual).
--   2. ALTER DEFAULT PRIVILEGES FOR ROLE splitpay → cualquier tabla
--      que splitpay cree en estos schemas EN EL FUTURO concede SELECT
--      (y los privilegios extra que el scheduler necesite) al role
--      del scheduler automáticamente. splitpay es el superuser que
--      ejecuta TODAS las migrations en este repo (MIGRATION_DATABASE_URL
--      uniforme), así que cubre el 100% de las tablas creadas vía
--      migrations de módulos.
--
-- Idempotente: si los GRANTs ya estaban, postgres los trata como no-op.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_platform_scheduler') THEN
    RETURN;
  END IF;

  -- platform_tenants: lectura para resolver default_locale en jobs de reminders.
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'platform_tenants') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA platform_tenants TO svc_platform_scheduler';
    EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA platform_tenants TO svc_platform_scheduler';
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE splitpay IN SCHEMA platform_tenants
             GRANT SELECT ON TABLES TO svc_platform_scheduler';
  END IF;

  -- platform_auth: lectura de email para notifications.
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'platform_auth') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA platform_auth TO svc_platform_scheduler';
    EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA platform_auth TO svc_platform_scheduler';
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE splitpay IN SCHEMA platform_auth
             GRANT SELECT ON TABLES TO svc_platform_scheduler';
  END IF;

  -- platform_bookings: lectura + escritura para booking-reminders y booking-recurrence-expander.
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'platform_bookings') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA platform_bookings TO svc_platform_scheduler';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA platform_bookings TO svc_platform_scheduler';
    EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA platform_bookings TO svc_platform_scheduler';
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE splitpay IN SCHEMA platform_bookings
             GRANT SELECT, INSERT, UPDATE ON TABLES TO svc_platform_scheduler';
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE splitpay IN SCHEMA platform_bookings
             GRANT USAGE, SELECT ON SEQUENCES TO svc_platform_scheduler';
  END IF;

  -- platform_availability: lectura + DELETE para availability-hold-purge.
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'platform_availability') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA platform_availability TO svc_platform_scheduler';
    EXECUTE 'GRANT SELECT, DELETE ON ALL TABLES IN SCHEMA platform_availability TO svc_platform_scheduler';
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE splitpay IN SCHEMA platform_availability
             GRANT SELECT, DELETE ON TABLES TO svc_platform_scheduler';
  END IF;

  -- platform_packages: lectura + UPDATE para package-expiry-*.
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'platform_packages') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA platform_packages TO svc_platform_scheduler';
    EXECUTE 'GRANT SELECT, UPDATE ON ALL TABLES IN SCHEMA platform_packages TO svc_platform_scheduler';
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE splitpay IN SCHEMA platform_packages
             GRANT SELECT, UPDATE ON TABLES TO svc_platform_scheduler';
  END IF;

  -- platform_practitioner_payouts: lectura + UPDATE para practitioner-payout-close.
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'platform_practitioner_payouts') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA platform_practitioner_payouts TO svc_platform_scheduler';
    EXECUTE 'GRANT SELECT, UPDATE ON ALL TABLES IN SCHEMA platform_practitioner_payouts TO svc_platform_scheduler';
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE splitpay IN SCHEMA platform_practitioner_payouts
             GRANT SELECT, UPDATE ON TABLES TO svc_platform_scheduler';
  END IF;

  -- platform_reservations: lectura + UPDATE para reservation-reminders.
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'platform_reservations') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA platform_reservations TO svc_platform_scheduler';
    EXECUTE 'GRANT SELECT, UPDATE ON ALL TABLES IN SCHEMA platform_reservations TO svc_platform_scheduler';
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE splitpay IN SCHEMA platform_reservations
             GRANT SELECT, UPDATE ON TABLES TO svc_platform_scheduler';
  END IF;

  -- platform_disputes: lectura + INSERT/UPDATE para dispute-sla.
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'platform_disputes') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA platform_disputes TO svc_platform_scheduler';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA platform_disputes TO svc_platform_scheduler';
    EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA platform_disputes TO svc_platform_scheduler';
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE splitpay IN SCHEMA platform_disputes
             GRANT SELECT, INSERT, UPDATE ON TABLES TO svc_platform_scheduler';
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE splitpay IN SCHEMA platform_disputes
             GRANT USAGE, SELECT ON SEQUENCES TO svc_platform_scheduler';
  END IF;

  -- platform_storage: lectura + UPDATE/DELETE para storage-orphan-purge y storage-retention-purge.
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'platform_storage') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA platform_storage TO svc_platform_scheduler';
    EXECUTE 'GRANT SELECT, UPDATE, DELETE ON ALL TABLES IN SCHEMA platform_storage TO svc_platform_scheduler';
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE splitpay IN SCHEMA platform_storage
             GRANT SELECT, UPDATE, DELETE ON TABLES TO svc_platform_scheduler';
  END IF;
END
$$;
