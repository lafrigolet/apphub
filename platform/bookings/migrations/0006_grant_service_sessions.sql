-- bookings.create acepta `sessionId` para inscribir socios a eventos
-- (services con kind='event'). El service layer necesita leer la
-- session (starts_at, ends_at, service_id, capacity, status,
-- registration_closes_at) para validar que es reservable y derivar
-- la ventana. Se hace cross-schema SQL — mismo patrón que availability
-- usa para leer platform_services / platform_resources / platform_bookings.
--
-- RLS sigue scopeando por (app_id, tenant_id), así que el GRANT no
-- permite leer datos de otro tenant: la session sólo es visible si
-- coincide con el current_setting puesto por withTenantTransaction.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_platform_bookings') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA platform_services TO svc_platform_bookings';
    EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA platform_services TO svc_platform_bookings';
    -- Las tablas que se creen después de esta migración también:
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA platform_services
              GRANT SELECT ON TABLES TO svc_platform_bookings';
  END IF;
END
$$;
