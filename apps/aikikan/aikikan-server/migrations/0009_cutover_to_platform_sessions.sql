-- Cutover Fase 2: app_aikikan.events + event_registrations → platform_services
-- (services + service_sessions) + platform_bookings.bookings.
--
-- Esta migration corre con MIGRATION_DATABASE_URL (superuser), así que
-- puede tocar otros schemas. Es la única en aikikan-server que cruza
-- fronteras de módulo platform_*; queda documentado como migración de
-- "data-migration" puntual y no es un patrón a generalizar.
--
-- Idempotente:
--   - El service ancla se crea con un code único; si ya existe lo deja.
--   - Sesiones y bookings usan UUIDs deterministas derivados del id
--     legacy para que re-correr la migration no duplique.

DO $$
DECLARE
  v_app_id    CONSTANT TEXT := 'aikikan';
  v_tenant_id CONSTANT UUID := '30000000-0000-0000-0000-000000000001';
  v_service_id UUID;
  rec RECORD;
BEGIN
  -- 1) Crear (o localizar) el service ancla "Eventos AIKIKAN". Una sola
  --    fila para todos los eventos heredados; nuevos eventos pueden
  --    crear su propio service si tienen políticas distintas.
  INSERT INTO platform_services.services
    (app_id, tenant_id, code, name, description,
     modality, duration_minutes, capacity,
     price_cents, currency, kind, public_catalog, is_active)
  VALUES
    (v_app_id, v_tenant_id, 'eventos-aikikan',
     'Eventos AIKIKAN',
     'Seminarios, exámenes y cursos abiertos a socios.',
     'in_person', 60, 200,
     0, 'EUR', 'event', TRUE, TRUE)
  ON CONFLICT (app_id, tenant_id, code) DO NOTHING;

  SELECT id INTO v_service_id
    FROM platform_services.services
    WHERE app_id = v_app_id AND tenant_id = v_tenant_id AND code = 'eventos-aikikan';

  -- 2) Por cada fila en app_aikikan.events, crear una service_session.
  --    El id de la session es determinista: derivado del event.id con
  --    UUID v5 (namespace fijo) para que sea idempotente.
  --    Como postgres no trae gen_uuid_v5, usamos md5 sobre el event.id
  --    formateado como UUID — colisión astronómicamente improbable.
  FOR rec IN
    SELECT id, date, name, location FROM app_aikikan.events
  LOOP
    INSERT INTO platform_services.service_sessions
      (id, app_id, tenant_id, service_id,
       starts_at, ends_at,
       location, description, status)
    VALUES
      ( -- UUID determinista: md5(event_id || ':session') → uuid
        (substring(md5(rec.id::text || ':session'), 1, 8) || '-' ||
         substring(md5(rec.id::text || ':session'), 9, 4) || '-' ||
         '5' || substring(md5(rec.id::text || ':session'), 14, 3) || '-' ||
         '8' || substring(md5(rec.id::text || ':session'), 18, 3) || '-' ||
         substring(md5(rec.id::text || ':session'), 21, 12))::uuid,
        v_app_id, v_tenant_id, v_service_id,
        -- Sin hora en el event legacy → 09:00–18:00 por defecto.
        (rec.date + time '09:00')::timestamptz,
        (rec.date + time '18:00')::timestamptz,
        rec.location, rec.name, 'scheduled')
    ON CONFLICT (id) DO NOTHING;
  END LOOP;

  -- 3) Por cada fila en event_registrations, crear una booking. Sólo
  --    migramos status='registered' y 'attended'; las 'cancelled' se
  --    quedan en la tabla legacy sin reflejo en platform_bookings.
  FOR rec IN
    SELECT er.id, er.event_id, er.user_id, er.status, er.registered_at, er.attended_at, er.notes,
           e.date, e.name
    FROM app_aikikan.event_registrations er
    JOIN app_aikikan.events e ON e.id = er.event_id
    WHERE er.status IN ('registered', 'attended')
  LOOP
    INSERT INTO platform_bookings.bookings
      (id, app_id, tenant_id, service_id, session_id,
       client_user_id, starts_at, ends_at, status,
       notes, source, locale)
    VALUES
      ( (substring(md5(rec.id::text || ':booking'), 1, 8) || '-' ||
         substring(md5(rec.id::text || ':booking'), 9, 4) || '-' ||
         '5' || substring(md5(rec.id::text || ':booking'), 14, 3) || '-' ||
         '8' || substring(md5(rec.id::text || ':booking'), 18, 3) || '-' ||
         substring(md5(rec.id::text || ':booking'), 21, 12))::uuid,
        v_app_id, v_tenant_id, v_service_id,
        (substring(md5(rec.event_id::text || ':session'), 1, 8) || '-' ||
         substring(md5(rec.event_id::text || ':session'), 9, 4) || '-' ||
         '5' || substring(md5(rec.event_id::text || ':session'), 14, 3) || '-' ||
         '8' || substring(md5(rec.event_id::text || ':session'), 18, 3) || '-' ||
         substring(md5(rec.event_id::text || ':session'), 21, 12))::uuid,
        rec.user_id,
        (rec.date + time '09:00')::timestamptz,
        (rec.date + time '18:00')::timestamptz,
        CASE WHEN rec.status = 'attended' THEN 'completed' ELSE 'confirmed' END,
        rec.notes, 'cutover', 'es')
    ON CONFLICT (id) DO NOTHING;
  END LOOP;
END
$$;

-- Comentario para auditoría: las tablas legacy quedan vivas durante
-- esta release. Una migration posterior puede dropear app_aikikan.events
-- y app_aikikan.event_registrations cuando el cutover sea estable.
COMMENT ON TABLE app_aikikan.events IS
  'DEPRECATED: source-of-truth pasó a platform_services.service_sessions';
COMMENT ON TABLE app_aikikan.event_registrations IS
  'DEPRECATED: source-of-truth pasó a platform_bookings.bookings (session_id)';
