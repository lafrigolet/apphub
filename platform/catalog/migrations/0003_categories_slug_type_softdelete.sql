-- Catalog priority upgrades (backend-only):
--   · soft-delete (deleted_at) + restore — preserves references in historic orders
--   · slug + meta_title + meta_description — basic SEO, unique slug per (app_id, tenant_id)
--   · item_type discriminator — physical / digital / service / bundle / subscription
--   · categories tree (parent_id) + M:N item_categories
--
-- Every table keeps RLS isolation by (app_id, tenant_id), same as items.

-- ── Soft-delete + SEO + type on items ──────────────────────────────────
ALTER TABLE platform_catalog.items
  ADD COLUMN IF NOT EXISTS deleted_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS slug              TEXT,
  ADD COLUMN IF NOT EXISTS meta_title        TEXT,
  ADD COLUMN IF NOT EXISTS meta_description  TEXT,
  ADD COLUMN IF NOT EXISTS item_type         TEXT NOT NULL DEFAULT 'physical'
    CHECK (item_type IN ('physical', 'digital', 'service', 'bundle', 'subscription'));

-- Slug is unique per tenant (NULL slugs allowed and not constrained).
CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_catalog_slug
  ON platform_catalog.items (app_id, tenant_id, slug)
  WHERE slug IS NOT NULL;

-- Speeds up "live" listings that exclude soft-deleted rows.
CREATE INDEX IF NOT EXISTS idx_platform_catalog_not_deleted
  ON platform_catalog.items (app_id, tenant_id)
  WHERE deleted_at IS NULL;

-- ── Categories (hierarchical tree) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS platform_catalog.categories (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id        TEXT         NOT NULL,
  tenant_id     UUID         NOT NULL,
  sub_tenant_id UUID,
  parent_id     UUID         REFERENCES platform_catalog.categories(id) ON DELETE SET NULL,
  name          TEXT         NOT NULL,
  slug          TEXT         NOT NULL,
  description   TEXT,
  display_order INT          NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Slug unique per tenant; lets a tenant build /shop/<slug> URLs safely.
CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_catalog_category_slug
  ON platform_catalog.categories (app_id, tenant_id, slug);
CREATE INDEX IF NOT EXISTS idx_platform_catalog_categories_parent
  ON platform_catalog.categories (app_id, tenant_id, parent_id);

ALTER TABLE platform_catalog.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_catalog.categories FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_catalog_categories_isolation ON platform_catalog.categories
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

GRANT SELECT, INSERT, UPDATE, DELETE
  ON platform_catalog.categories
  TO svc_platform_catalog;

-- ── M:N item ↔ category ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS platform_catalog.item_categories (
  app_id        TEXT         NOT NULL,
  tenant_id     UUID         NOT NULL,
  item_id       UUID         NOT NULL REFERENCES platform_catalog.items(id)      ON DELETE CASCADE,
  category_id   UUID         NOT NULL REFERENCES platform_catalog.categories(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, category_id)
);

CREATE INDEX IF NOT EXISTS idx_platform_catalog_item_categories_cat
  ON platform_catalog.item_categories (app_id, tenant_id, category_id);

ALTER TABLE platform_catalog.item_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_catalog.item_categories FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_catalog_item_categories_isolation ON platform_catalog.item_categories
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

GRANT SELECT, INSERT, DELETE
  ON platform_catalog.item_categories
  TO svc_platform_catalog;
