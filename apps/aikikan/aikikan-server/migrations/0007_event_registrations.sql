-- Inscripciones de socios a eventos. Una fila por (event_id, user_id);
-- el socio puede inscribirse y desinscribirse mientras el evento siga
-- siendo futuro. RLS por (app_id, tenant_id) igual que el resto.
--
-- user_id es FK-lógica a platform_auth.users.id (cross-schema). Como
-- en `app_aikikan.members`, no hay FK SQL — la consistencia ante
-- revocación de usuario se mantiene vía evento `user.revoked` en el
-- handler de events/user-revoked.handler.js.

CREATE TABLE IF NOT EXISTS app_aikikan.event_registrations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT NOT NULL,
  tenant_id       UUID NOT NULL,
  sub_tenant_id   UUID,

  event_id        UUID NOT NULL REFERENCES app_aikikan.events(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL,

  -- 'registered'  → inscrito, asistencia pendiente.
  -- 'attended'    → admin marcó asistencia tras el evento.
  -- 'cancelled'   → el socio (o admin) canceló la inscripción.
  status          TEXT NOT NULL DEFAULT 'registered'
                    CHECK (status IN ('registered', 'attended', 'cancelled')),

  registered_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  attended_at     TIMESTAMPTZ,
  cancelled_at    TIMESTAMPTZ,

  notes           TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Un socio sólo puede tener una inscripción activa por evento. Si
-- cancela y vuelve a inscribirse re-usamos la fila vía UPSERT (status
-- pasa de 'cancelled' a 'registered').
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_registrations_unique
  ON app_aikikan.event_registrations (app_id, tenant_id, event_id, user_id);

CREATE INDEX IF NOT EXISTS idx_event_registrations_user
  ON app_aikikan.event_registrations (app_id, tenant_id, user_id, status);

ALTER TABLE app_aikikan.event_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_aikikan.event_registrations FORCE ROW LEVEL SECURITY;

CREATE POLICY app_aikikan_event_reg_isolation ON app_aikikan.event_registrations
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );
