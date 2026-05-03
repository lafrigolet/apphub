-- Eventos editables del landing de aikikan. Una fila por evento del
-- calendario; el admin puede crear y borrar; el GET es público (los
-- visitantes ven la agenda sin login). RLS por (app_id, tenant_id),
-- igual que el resto de tablas de app_aikikan.

CREATE TABLE IF NOT EXISTS app_aikikan.events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id        TEXT NOT NULL,
  tenant_id     UUID NOT NULL,
  sub_tenant_id UUID,

  -- Fecha del evento. Si el evento dura varios días, esta es la fecha
  -- de inicio; el front muestra mes/año derivados de aquí.
  date          DATE NOT NULL,

  -- Texto libre — la copia del landing es flexible (ej. "Madrid · Convocatoria abierta").
  name          TEXT NOT NULL,
  location      TEXT,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_aikikan_events_tenant_date
  ON app_aikikan.events (app_id, tenant_id, date);

ALTER TABLE app_aikikan.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_aikikan.events FORCE ROW LEVEL SECURITY;

CREATE POLICY app_aikikan_events_isolation ON app_aikikan.events
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

-- Seed inicial: los 4 eventos que estaban hardcoded en data/events.js
-- para que la landing no quede vacía al arrancar. Idempotente — usa
-- IDs deterministas para que re-ejecuciones no dupliquen.
INSERT INTO app_aikikan.events (id, app_id, tenant_id, date, name, location)
VALUES
  ('e0000001-0000-0000-0000-000000000001'::uuid, 'aikikan', '30000000-0000-0000-0000-000000000001'::uuid, '2025-05-15', 'Seminario Nacional de Primavera',  '/ Madrid · Convocatoria abierta'),
  ('e0000001-0000-0000-0000-000000000002'::uuid, 'aikikan', '30000000-0000-0000-0000-000000000001'::uuid, '2025-06-20', 'Exámenes de Grado Oficiales',     '/ Elche, Alicante · Sede central'),
  ('e0000001-0000-0000-0000-000000000003'::uuid, 'aikikan', '30000000-0000-0000-0000-000000000001'::uuid, '2025-10-04', 'Encuentro Técnico Otoño',          '/ Castellón de la Plana'),
  ('e0000001-0000-0000-0000-000000000004'::uuid, 'aikikan', '30000000-0000-0000-0000-000000000001'::uuid, '2026-01-15', 'Renovación de Licencias',          '/ Online · Todos los dojos')
ON CONFLICT (id) DO NOTHING;
