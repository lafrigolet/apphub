-- CRM / operativa de soporte — implementa los casos de uso priorizados de
-- docs/use-cases/inquiries.md (backend-only):
--   #3  notas con autoría (inquiry_activities) + close_reason + estado `resolved`
--   #4  consentimiento GDPR (consent_text/version/at) en el alta pública
--   #5  búsqueda full-text + filtros combinados (source, categoría, fecha, asignado)
--   #8  asignación (assigned_to) + categoría/departamento (category) para routing
--   #9  retención GDPR: soft-delete (deleted_at) + anonimización (anonymized_at)
--       + retention_days configurable por tenant
--   #10 CSAT (csat_score / csat_comment / csat_submitted_at)
--
-- Migración aditiva: NO toca columnas existentes (status CHECK se amplía con
-- 'resolved' conservando los valores previos). El campo legacy `staff_notes`
-- se mantiene; el camino nuevo de notas con autoría es `inquiry_activities`.

------------------------------------------------------------------
-- 1. Nuevas columnas en inquiries
------------------------------------------------------------------

ALTER TABLE platform_inquiries.inquiries
  ADD COLUMN IF NOT EXISTS assigned_to       UUID,         -- staff owner (platform_auth user id)
  ADD COLUMN IF NOT EXISTS category          TEXT,         -- 'ventas' / 'soporte' / 'facturación' … (routing)
  ADD COLUMN IF NOT EXISTS close_reason      TEXT,         -- al cerrar/resolver: resuelto, sin respuesta, duplicado, derivado…
  -- Consentimiento LOPDGDD/GDPR (texto + versión mostrados al captar)
  ADD COLUMN IF NOT EXISTS consent_text      TEXT,
  ADD COLUMN IF NOT EXISTS consent_version   TEXT,
  ADD COLUMN IF NOT EXISTS consent_at        TIMESTAMPTZ,
  -- CSAT — el visitante puntúa la atención (1..5) al cerrar
  ADD COLUMN IF NOT EXISTS csat_score        SMALLINT
                           CHECK (csat_score IS NULL OR csat_score BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS csat_comment      TEXT,
  ADD COLUMN IF NOT EXISTS csat_submitted_at TIMESTAMPTZ,
  -- GDPR retención: soft-delete + anonimización (no borrado físico → auditoría)
  ADD COLUMN IF NOT EXISTS deleted_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS anonymized_at     TIMESTAMPTZ;

-- Estado `resolved` separado de `closed` (resuelto satisfactoriamente vs
-- archivado/cerrado sin solución). Ambos terminales.
ALTER TABLE platform_inquiries.inquiries DROP CONSTRAINT IF EXISTS inquiries_status_check;
ALTER TABLE platform_inquiries.inquiries ADD CONSTRAINT inquiries_status_check
  CHECK (status IN ('new', 'contacted', 'resolved', 'closed', 'spam'));

-- Búsqueda full-text precomputada (generated column) sobre los campos
-- citables. Índice GIN para search del admin sin table-scan.
ALTER TABLE platform_inquiries.inquiries
  ADD COLUMN IF NOT EXISTS search_tsv tsvector
  GENERATED ALWAYS AS (
    to_tsvector('simple',
      coalesce(reference, '')    || ' ' ||
      coalesce(contact_name, '') || ' ' ||
      coalesce(email, '')        || ' ' ||
      coalesce(subject, '')      || ' ' ||
      coalesce(message, ''))
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_inquiries_search
  ON platform_inquiries.inquiries USING GIN (search_tsv);

CREATE INDEX IF NOT EXISTS idx_inquiries_assigned
  ON platform_inquiries.inquiries (assigned_to) WHERE assigned_to IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inquiries_category
  ON platform_inquiries.inquiries (app_id, tenant_id, category) WHERE category IS NOT NULL;

-- Purga de retención: localizar consultas viejas no anonimizadas por tenant.
CREATE INDEX IF NOT EXISTS idx_inquiries_retention
  ON platform_inquiries.inquiries (app_id, tenant_id, created_at)
  WHERE anonymized_at IS NULL AND deleted_at IS NULL;

------------------------------------------------------------------
-- 2. Timeline de actividad — notas con autoría + historial de estado
------------------------------------------------------------------
-- Sustituye el staff_notes plano (que sigue existiendo como legacy): notas
-- con autor y fecha, historial de transiciones de estado y de asignaciones.

CREATE TABLE IF NOT EXISTS platform_inquiries.inquiry_activities (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  inquiry_id      UUID        NOT NULL REFERENCES platform_inquiries.inquiries(id) ON DELETE CASCADE,
  app_id          TEXT        NOT NULL,
  tenant_id       UUID        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  author_user_id  UUID,                -- NULL en entradas de sistema / del visitante
  author_email    TEXT,
  type            TEXT        NOT NULL
                  CHECK (type IN ('note', 'status_change', 'assignment', 'system')),
  body            TEXT,
  metadata        JSONB                -- p.ej. { "from": "new", "to": "contacted" }
);

CREATE INDEX IF NOT EXISTS idx_inquiry_activities_inquiry
  ON platform_inquiries.inquiry_activities (inquiry_id, created_at DESC);

ALTER TABLE platform_inquiries.inquiry_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_inquiries.inquiry_activities FORCE  ROW LEVEL SECURITY;

CREATE POLICY inquiry_activities_tenant_isolation ON platform_inquiries.inquiry_activities
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

------------------------------------------------------------------
-- 3. Settings: retención GDPR configurable por tenant
------------------------------------------------------------------

ALTER TABLE platform_inquiries.settings
  ADD COLUMN IF NOT EXISTS retention_days INTEGER
                           CHECK (retention_days IS NULL OR retention_days > 0);
