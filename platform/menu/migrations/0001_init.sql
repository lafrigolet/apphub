-- Menu module: F&B menus with course types, modifiers, allergens,
-- availability windows ("desayunos 8-12") and an 86-list (out-of-stock today).

CREATE TABLE IF NOT EXISTS platform_menu.menus (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT         NOT NULL,
  tenant_id       UUID         NOT NULL,
  sub_tenant_id   UUID,
  name            TEXT         NOT NULL,
  description     TEXT,
  is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_menu_menus_tenant
  ON platform_menu.menus (tenant_id, is_active);

ALTER TABLE platform_menu.menus ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_menu.menus FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_menu_menus_isolation ON platform_menu.menus
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE TABLE IF NOT EXISTS platform_menu.menu_categories (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id        TEXT         NOT NULL,
  tenant_id     UUID         NOT NULL,
  menu_id       UUID         NOT NULL REFERENCES platform_menu.menus (id) ON DELETE CASCADE,
  name          TEXT         NOT NULL,
  course_type   TEXT         NOT NULL CHECK (course_type IN ('starter','main','dessert','drink','side','combo','other')),
  display_order INT          NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_platform_menu_categories_menu
  ON platform_menu.menu_categories (menu_id, display_order);

ALTER TABLE platform_menu.menu_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_menu.menu_categories FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_menu_categories_isolation ON platform_menu.menu_categories
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE TABLE IF NOT EXISTS platform_menu.menu_items (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id              TEXT         NOT NULL,
  tenant_id           UUID         NOT NULL,
  category_id         UUID         NOT NULL REFERENCES platform_menu.menu_categories (id) ON DELETE CASCADE,
  sku                 TEXT         NOT NULL,
  name                TEXT         NOT NULL,
  description         TEXT,
  price_cents         BIGINT       NOT NULL CHECK (price_cents >= 0),
  currency            CHAR(3)      NOT NULL DEFAULT 'EUR',
  course_type         TEXT         NOT NULL DEFAULT 'main',
  station             TEXT,
  prep_time_seconds   INT,
  allergens           TEXT[]       NOT NULL DEFAULT '{}',
  badges              TEXT[]       NOT NULL DEFAULT '{}',
  photo_url           TEXT,
  is_available        BOOLEAN      NOT NULL DEFAULT TRUE,
  eighty_sixed        BOOLEAN      NOT NULL DEFAULT FALSE,
  metadata            JSONB        NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_menu_items_sku
  ON platform_menu.menu_items (app_id, tenant_id, sku);
CREATE INDEX IF NOT EXISTS idx_platform_menu_items_category
  ON platform_menu.menu_items (category_id, is_available);

ALTER TABLE platform_menu.menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_menu.menu_items FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_menu_items_isolation ON platform_menu.menu_items
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

-- Modifier groups: "Punto de la carne", "Acompañamientos", "Alérgenos a evitar"
CREATE TABLE IF NOT EXISTS platform_menu.modifier_groups (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id         TEXT         NOT NULL,
  tenant_id      UUID         NOT NULL,
  item_id        UUID         NOT NULL REFERENCES platform_menu.menu_items (id) ON DELETE CASCADE,
  name           TEXT         NOT NULL,
  min_choices    INT          NOT NULL DEFAULT 0,
  max_choices    INT          NOT NULL DEFAULT 1,
  display_order  INT          NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_platform_menu_modgroups_item
  ON platform_menu.modifier_groups (item_id);

ALTER TABLE platform_menu.modifier_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_menu.modifier_groups FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_menu_modgroups_isolation ON platform_menu.modifier_groups
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE TABLE IF NOT EXISTS platform_menu.modifiers (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT         NOT NULL,
  tenant_id       UUID         NOT NULL,
  group_id        UUID         NOT NULL REFERENCES platform_menu.modifier_groups (id) ON DELETE CASCADE,
  name            TEXT         NOT NULL,
  price_delta_cents BIGINT     NOT NULL DEFAULT 0,
  display_order   INT          NOT NULL DEFAULT 0,
  is_default      BOOLEAN      NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_platform_menu_modifiers_group
  ON platform_menu.modifiers (group_id);

ALTER TABLE platform_menu.modifiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_menu.modifiers FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_menu_modifiers_isolation ON platform_menu.modifiers
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

-- Availability windows: 'desayunos' Mon-Fri 08:00-12:00
CREATE TABLE IF NOT EXISTS platform_menu.availability_windows (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id           TEXT         NOT NULL,
  tenant_id        UUID         NOT NULL,
  scope_type       TEXT         NOT NULL CHECK (scope_type IN ('menu','category','item')),
  scope_id         UUID         NOT NULL,
  days_of_week     INT[]        NOT NULL DEFAULT '{0,1,2,3,4,5,6}',
  start_minute     INT          NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
  end_minute       INT          NOT NULL CHECK (end_minute   BETWEEN 0 AND 1440),
  label            TEXT
);

CREATE INDEX IF NOT EXISTS idx_platform_menu_avail_scope
  ON platform_menu.availability_windows (scope_type, scope_id);

ALTER TABLE platform_menu.availability_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_menu.availability_windows FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_menu_avail_isolation ON platform_menu.availability_windows
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );
