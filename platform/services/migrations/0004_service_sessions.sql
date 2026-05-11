-- Sessions: instancias de un servicio con fecha y hora fijas. Lo que un
-- portal pinta como "evento" (seminario, examen, curso de fin de semana)
-- es un service `kind='event'` con una `service_sessions` fila por cada
-- convocatoria. Las reservas se hacen contra la session (en lugar de
-- contra el grid de availability) y la capacidad de la session se
-- consulta para rechazar inscripciones cuando se llena.
--
-- A diferencia del flujo recurrente clásico (services + availability +
-- bookings.holdId), aquí no hay slot grid — la session ES el slot.
-- Las bookings ligadas a una session llevan booking.session_id (ver
-- platform/bookings/migrations/0005_session_id.sql).

-- Marca el "tipo" del service. 'appointment' = comportamiento clásico
-- (slots derivados de work_hours). 'event' = sólo se reserva contra
-- service_sessions, sin grid.
ALTER TABLE platform_services.services
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'appointment'
    CHECK (kind IN ('appointment', 'event'));

-- Si está a TRUE, el endpoint público GET /v1/services/sessions/upcoming
-- incluye este servicio (y sus sesiones). Por defecto FALSE — los
-- servicios siguen siendo privados al admin/auth a menos que el tenant
-- los publique explícitamente.
ALTER TABLE platform_services.services
  ADD COLUMN IF NOT EXISTS public_catalog BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_platform_services_kind
  ON platform_services.services (app_id, tenant_id, kind)
  WHERE is_active = TRUE;

-- ── service_sessions ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS platform_services.service_sessions (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id         TEXT         NOT NULL,
  tenant_id      UUID         NOT NULL,
  sub_tenant_id  UUID,

  service_id     UUID         NOT NULL REFERENCES platform_services.services(id) ON DELETE CASCADE,

  starts_at      TIMESTAMPTZ  NOT NULL,
  ends_at        TIMESTAMPTZ  NOT NULL CHECK (ends_at > starts_at),

  -- Override puntual. Si NULL, la session toma la capacidad del service.
  capacity       INT          CHECK (capacity IS NULL OR capacity > 0),

  -- Resource opcional (sala, profesor). Bookings de tipo event NO van
  -- contra el guard de overlap por recurso — varias inscripciones
  -- comparten el mismo resource. El campo queda para etiquetar.
  resource_id    UUID,

  -- Override del precio por sesión. NULL = usar pricing tiers del
  -- service o `services.price_cents`.
  price_cents    BIGINT       CHECK (price_cents IS NULL OR price_cents >= 0),
  currency       CHAR(3),

  -- Localización libre cuando no hay un resource asignado (e.g.
  -- "Polideportivo San Fermín — Pamplona"). Independiente de resource_id.
  location       TEXT,

  -- 'scheduled' por defecto. 'cancelled' cuando el admin anula la
  -- convocatoria (las bookings ligadas se cancelan vía service layer).
  -- 'completed' al cerrar tras el evento.
  status         TEXT         NOT NULL DEFAULT 'scheduled'
                   CHECK (status IN ('scheduled', 'cancelled', 'completed')),

  -- Descripción específica de esta convocatoria (puede sobrescribir la
  -- del service: e.g. "edición Madrid 2026").
  description    TEXT,

  -- Cierre temprano de inscripciones (e.g. cerrar el viernes a las 24h
  -- aunque el evento sea el sábado). NULL = abre hasta starts_at.
  registration_closes_at TIMESTAMPTZ,

  metadata       JSONB        NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_services_sessions_tenant_when
  ON platform_services.service_sessions (app_id, tenant_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_platform_services_sessions_service
  ON platform_services.service_sessions (service_id, starts_at);
-- Partial index sólo por status. La cláusula `starts_at > now()` no se
-- puede meter en un partial index (`now()` no es IMMUTABLE en postgres);
-- el planner aplicará el filtro temporal en runtime y aún así usará este
-- índice para escanear sólo las filas scheduled.
CREATE INDEX IF NOT EXISTS idx_platform_services_sessions_upcoming
  ON platform_services.service_sessions (app_id, tenant_id, starts_at)
  WHERE status = 'scheduled';

ALTER TABLE platform_services.service_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_services.service_sessions FORCE ROW LEVEL SECURITY;

CREATE POLICY platform_services_sessions_isolation ON platform_services.service_sessions
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );
