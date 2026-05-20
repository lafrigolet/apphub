-- aulavera-server initial schema. RLS by (app_id, tenant_id) following the
-- platform pattern. Three tables for V1:
--   - events       : workshops (futuros) + chronicles (realizados)
--   - disciplines  : "áreas de acción" displayed under Proyectos tab
--   - resources    : videos + documents listed in the Área privada
--
-- The schema and role are provisioned in
-- infra/postgres/init/16_app_aulavera_schema.sql.

-- ─────────────────────────────────────────────────────────────────────────
-- events — workshops (kind='workshop' / futuros) y crónicas (kind='chronicle' / realizados)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_aulavera.events (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT        NOT NULL,
  tenant_id       UUID        NOT NULL,
  sub_tenant_id   UUID,

  kind            TEXT        NOT NULL CHECK (kind IN ('workshop', 'chronicle')),
  slug            TEXT        NOT NULL,
  title           TEXT        NOT NULL,
  -- "when_text" libre — el prototipo usa frases como "Próximamente · agenda
  -- abierta" / "Sábado, 7 de junio · Losar de la Vera". Mantenemos texto
  -- libre porque la mayoría de chronicles no tienen una fecha estructurada.
  when_text       TEXT,
  area            TEXT,             -- p.ej. "Educación", "Arte y cultura"
  body            TEXT,             -- HTML/markdown del cuerpo
  quote           TEXT,             -- blockquote para chronicles
  image_key       TEXT,             -- 'workshop', 'cow', 'vega', … → render en el portal
  price_label     TEXT,             -- "Reservar (señal 25 €)" para workshops
  tags            TEXT[]      NOT NULL DEFAULT '{}',
  position        INT         NOT NULL DEFAULT 0,
  status          TEXT        NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'archived')),
  published_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (app_id, tenant_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_aulavera_events_tenant_kind
  ON app_aulavera.events (app_id, tenant_id, kind, status, position);

ALTER TABLE app_aulavera.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_aulavera.events FORCE ROW LEVEL SECURITY;

CREATE POLICY app_aulavera_events_isolation ON app_aulavera.events
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

-- ─────────────────────────────────────────────────────────────────────────
-- disciplines — "áreas de acción" (Terapia con animales, Bio-construcción, …)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_aulavera.disciplines (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT        NOT NULL,
  tenant_id       UUID        NOT NULL,
  sub_tenant_id   UUID,

  slug            TEXT        NOT NULL,
  name            TEXT        NOT NULL,
  body            TEXT,
  icon            TEXT,                                 -- emoji o glyph
  state           TEXT        NOT NULL DEFAULT 'En preparación'
                              CHECK (state IN ('En preparación', 'Consolidada')),
  position        INT         NOT NULL DEFAULT 0,
  active          BOOLEAN     NOT NULL DEFAULT TRUE,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (app_id, tenant_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_aulavera_disciplines_tenant
  ON app_aulavera.disciplines (app_id, tenant_id, active, position);

ALTER TABLE app_aulavera.disciplines ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_aulavera.disciplines FORCE ROW LEVEL SECURITY;

CREATE POLICY app_aulavera_disciplines_isolation ON app_aulavera.disciplines
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

-- ─────────────────────────────────────────────────────────────────────────
-- resources — vídeos, recursos pedagógicos y documentos institucionales
-- expuestos en el Área privada. object_id apunta (lógico) a
-- platform_storage.objects cuando el fichero existe; NULL si todavía
-- no se ha subido (V1 muestra solo metadatos).
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_aulavera.resources (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT        NOT NULL,
  tenant_id       UUID        NOT NULL,
  sub_tenant_id   UUID,

  type            TEXT        NOT NULL CHECK (type IN ('video', 'document', 'guide')),
  title           TEXT        NOT NULL,
  subtitle        TEXT,                                 -- "PDF · 24 págs.", "14:32 · 7 jun 2025"
  object_id       UUID,                                 -- ref lógica a platform_storage.objects
  position        INT         NOT NULL DEFAULT 0,
  requires_membership BOOLEAN NOT NULL DEFAULT TRUE,
  active          BOOLEAN     NOT NULL DEFAULT TRUE,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (app_id, tenant_id, type, title)
);

CREATE INDEX IF NOT EXISTS idx_aulavera_resources_tenant_type
  ON app_aulavera.resources (app_id, tenant_id, type, active, position);

ALTER TABLE app_aulavera.resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_aulavera.resources FORCE ROW LEVEL SECURITY;

CREATE POLICY app_aulavera_resources_isolation ON app_aulavera.resources
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );
