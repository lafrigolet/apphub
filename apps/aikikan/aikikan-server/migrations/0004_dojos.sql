-- Dojos editables del landing. Cada fila es un dojo de la red — el
-- visitante los explora con un buscador (filtra por nombre, ciudad,
-- provincia o sensei); el admin añade/borra desde el mismo listado.

CREATE TABLE IF NOT EXISTS app_aikikan.dojos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id        TEXT NOT NULL,
  tenant_id     UUID NOT NULL,
  sub_tenant_id UUID,

  name          TEXT NOT NULL,
  city          TEXT NOT NULL,
  province      TEXT NOT NULL,
  address       TEXT,
  sensei        TEXT,
  phone         TEXT,
  email         TEXT,
  web           TEXT,

  position      INT  NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_aikikan_dojos_tenant_pos
  ON app_aikikan.dojos (app_id, tenant_id, position);

ALTER TABLE app_aikikan.dojos ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_aikikan.dojos FORCE ROW LEVEL SECURITY;

CREATE POLICY app_aikikan_dojos_isolation ON app_aikikan.dojos
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

INSERT INTO app_aikikan.dojos (id, app_id, tenant_id, name, city, province, address, sensei, phone, email, web, position) VALUES
  ('d0000001-0000-0000-0000-000000000001'::uuid, 'aikikan', '30000000-0000-0000-0000-000000000001'::uuid, 'Time Definition Box',  'Fuenlabrada',           'Madrid',     'C/ Luis Sauquillo 80 Local F, 28944',                'Ricardo Ledesma',                  '919 320 787','rledesma@aikice.jazztel.es',                  NULL,                          1),
  ('d0000001-0000-0000-0000-000000000002'::uuid, 'aikikan', '30000000-0000-0000-0000-000000000001'::uuid, 'Aikikan Castellón',     'Castellón de la Plana', 'Castellón',  'Avda. Burriana, 18, 12005',                          'Fernando Valero',                  '601 126 560','aikikan.cs.ng@hotmail.com',                   NULL,                          2),
  ('d0000001-0000-0000-0000-000000000003'::uuid, 'aikikan', '30000000-0000-0000-0000-000000000001'::uuid, 'Daimyo',                'Alicante',              'Alicante',   'C/ Cardenal Belluga, 3 – 5ª planta, 03005',          'Aurelio Fuentes Alcaide',          '965 229 920','aikiaurelios@hotmail.com',                    'gimnasiodaimyo.com',          3),
  ('d0000001-0000-0000-0000-000000000004'::uuid, 'aikikan', '30000000-0000-0000-0000-000000000001'::uuid, 'Club Deportivo Algar',  'Elche',                 'Alicante',   'C/ Fernando Sta. María, 104, 03204',                 'Fernando Pérez · Anton Benavides', '659 946 670','info@aikidobudo.com',                         NULL,                          4),
  ('d0000001-0000-0000-0000-000000000005'::uuid, 'aikikan', '30000000-0000-0000-0000-000000000001'::uuid, 'GN Sport Center',       'Pozuelo de Alarcón',    'Madrid',     'Av. de Juan Pablo II, 25, 28223',                    'Nacho Vindel',                     '608 161 506','nacho.vindel@gmail.com',                      'aikidojopozuelo.com',         5),
  ('d0000001-0000-0000-0000-000000000006'::uuid, 'aikikan', '30000000-0000-0000-0000-000000000001'::uuid, 'Gimnasio Picos',        'Móstoles',              'Madrid',     'C/ Carlos Arniches, 10, 28935',                      'Andrés Caro Rojo',                 '675 258 156','calbalakrab@gmail.com',                       'desdeldojo.blogspot.com',     6)
ON CONFLICT (id) DO NOTHING;
