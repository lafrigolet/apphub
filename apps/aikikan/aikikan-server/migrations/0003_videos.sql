-- Vídeos editables del landing de aikikan. youtube_id es el identificador
-- corto de YouTube (la parte después de v= o de youtu.be/), label es la
-- etiqueta del rango/categoría que aparece pequeña, name es el título
-- mostrado bajo el thumbnail. position es opcional para futuro reorder.

CREATE TABLE IF NOT EXISTS app_aikikan.videos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id        TEXT NOT NULL,
  tenant_id     UUID NOT NULL,
  sub_tenant_id UUID,

  youtube_id    TEXT NOT NULL,
  label         TEXT,
  name          TEXT NOT NULL,
  position      INT  NOT NULL DEFAULT 0,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_aikikan_videos_tenant_pos
  ON app_aikikan.videos (app_id, tenant_id, position);

ALTER TABLE app_aikikan.videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_aikikan.videos FORCE ROW LEVEL SECURITY;

CREATE POLICY app_aikikan_videos_isolation ON app_aikikan.videos
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

INSERT INTO app_aikikan.videos (id, app_id, tenant_id, youtube_id, label, name, position)
VALUES
  ('a0000001-0000-0000-0000-000000000001'::uuid, 'aikikan', '30000000-0000-0000-0000-000000000001'::uuid, 'eV3c0gMxPJI', 'Fundador',          'Morihei Ueshiba — O''Sensei',                 1),
  ('a0000001-0000-0000-0000-000000000002'::uuid, 'aikikan', '30000000-0000-0000-0000-000000000001'::uuid, 'rVOhCBdVvNM', '8º Dan Shihan',     'Nobuyoshi Tamura',                            2),
  ('a0000001-0000-0000-0000-000000000003'::uuid, 'aikikan', '30000000-0000-0000-0000-000000000001'::uuid, 'UqbUK93kkUM', 'III Doshu',         'Moriteru Ueshiba — Kagamibiraki 2026',        3),
  ('a0000001-0000-0000-0000-000000000004'::uuid, 'aikikan', '30000000-0000-0000-0000-000000000001'::uuid, 'qbW5frQI4dU', '6º Dan Aikikai',    'Malcolm Tiki Shewan — Principios de Aikido', 4),
  ('a0000001-0000-0000-0000-000000000005'::uuid, 'aikikan', '30000000-0000-0000-0000-000000000001'::uuid, 'boQqqh5ssMM', '7º Dan Shihan',     'Stéphane Benedetti — Seminario',              5),
  ('a0000001-0000-0000-0000-000000000006'::uuid, 'aikikan', '30000000-0000-0000-0000-000000000001'::uuid, '4DEGlGHTXnI', 'Mutokukai · Shihan','Benedetti — Técnica y espíritu',              6)
ON CONFLICT (id) DO NOTHING;
