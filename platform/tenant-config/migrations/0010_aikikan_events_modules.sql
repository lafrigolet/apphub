-- Cutover Fase 2: aikikan ya no usa el endpoint propio /api/aikikan/events
-- sino los módulos `events` (UI admin que reescribe a /api/services +
-- /api/bookings). Añadimos los manifests necesarios a enabled_modules
-- para que el shell los cargue. Idempotente — usa array_append + DISTINCT.

UPDATE platform_tenants.apps
SET enabled_modules = (
  SELECT array_agg(DISTINCT m) FROM unnest(
    enabled_modules || ARRAY['events', 'bookings']::TEXT[]
  ) AS m
)
WHERE app_id = 'aikikan';
