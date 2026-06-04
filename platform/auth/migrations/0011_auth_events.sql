-- Audit log de eventos de seguridad — recomendación de priorización #10.
--
-- Cada evento relevante (login OK/fallido, logout, logout-all, reset de
-- contraseña, consumo de magic-link) deja una fila con IP y User-Agent.
-- Sirve para debugging de incidentes y como base para compliance
-- (ISO 27001 / SOC 2). Escritura best-effort: si falla, nunca rompe el
-- flujo de autenticación que la originó.
--
-- `user_id` es nullable: algunos eventos (login con email inexistente)
-- no resuelven un usuario pero sí queremos registrarlos. No hay FK a
-- users por la misma razón (y para que el borrado del user no purgue su
-- historial de auditoría).

CREATE TABLE IF NOT EXISTS platform_auth.auth_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id      TEXT NOT NULL,
  tenant_id   UUID NOT NULL,
  user_id     UUID,
  event_type  TEXT NOT NULL,
  result      TEXT NOT NULL DEFAULT 'success',
  ip          TEXT,
  user_agent  TEXT,
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_events_user
  ON platform_auth.auth_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_auth_events_tenant
  ON platform_auth.auth_events (app_id, tenant_id, created_at DESC);

ALTER TABLE platform_auth.auth_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_auth.auth_events FORCE ROW LEVEL SECURITY;

CREATE POLICY platform_auth_auth_events_isolation
  ON platform_auth.auth_events
  USING (
    -- staff bypass (igual que el resto de tablas del módulo)
    current_setting('app.staff_access', true) = 'true'
    OR (
      app_id = current_setting('app.app_id', true)
      AND tenant_id = (current_setting('app.tenant_id', true))::uuid
    )
  );
