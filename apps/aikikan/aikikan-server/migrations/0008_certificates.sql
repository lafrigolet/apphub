-- Certificados emitidos a socios. Dos tipos:
--   'grade'      → diploma de KYU/DAN tras un examen oficial.
--   'attendance' → constancia de asistencia a un evento/seminario.
--
-- El PDF vive en platform_storage (kind 'aikikan_certificate'); aquí
-- guardamos el id del objeto. Regla #4 de CLAUDE.md: no hacemos JOIN
-- cross-schema; la descarga la negocia el frontend pidiendo a
-- aikikan-server un download URL, y éste lo delega vía HTTP a
-- platform-core (módulo storage).
--
-- user_id es FK-lógica a platform_auth.users.id, igual que members
-- y event_registrations. issued_by_user_id es el admin emisor.

CREATE TABLE IF NOT EXISTS app_aikikan.certificates (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id            TEXT NOT NULL,
  tenant_id         UUID NOT NULL,
  sub_tenant_id     UUID,

  user_id           UUID NOT NULL,             -- socio receptor
  issued_by_user_id UUID NOT NULL,             -- admin emisor

  kind              TEXT NOT NULL CHECK (kind IN ('grade', 'attendance')),

  title             TEXT NOT NULL,             -- ej. "1º Dan Aikikai" o "Seminario de Primavera 2025"
  -- Para 'grade' guarda el grado en formato 'KYU_5' / 'DAN_1' / etc.
  -- Coincide con el formato usado en app_aikikan.members.aikido_grade.
  grade_value       TEXT,
  -- Para 'attendance' opcionalmente referenciamos el evento del que
  -- se certifica la asistencia. NULL si es un curso externo sin row.
  event_id          UUID REFERENCES app_aikikan.events(id) ON DELETE SET NULL,

  -- Identificador del objeto en platform_storage. Nunca hacemos FK SQL
  -- (cross-schema) — la consistencia se mantiene a nivel aplicación.
  file_object_id    UUID NOT NULL,

  issued_at         DATE NOT NULL DEFAULT CURRENT_DATE,
  notes             TEXT,
  revoked_at        TIMESTAMPTZ,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_certificates_user
  ON app_aikikan.certificates (app_id, tenant_id, user_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_certificates_event
  ON app_aikikan.certificates (event_id) WHERE event_id IS NOT NULL;

ALTER TABLE app_aikikan.certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_aikikan.certificates FORCE ROW LEVEL SECURITY;

CREATE POLICY app_aikikan_certificates_isolation ON app_aikikan.certificates
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );
