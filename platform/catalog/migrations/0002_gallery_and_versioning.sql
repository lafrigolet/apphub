-- Catalog upgrades: image gallery + versioning (draft/published).
--
-- Image gallery: a separate table referencing platform_storage.objects.id.
-- Multiple images per item with an explicit order. The first row by
-- display_order is the "primary" image — frontends typically use it as the
-- product card thumbnail.
--
-- Versioning: each item gets a status (draft/published/archived) and a
-- version_number that increments on every published edit. Drafts let
-- editors stage changes; archives keep historic prices/copy without
-- deleting the row (analytics/exports rely on it).

ALTER TABLE platform_catalog.items
  ADD COLUMN IF NOT EXISTS status         TEXT NOT NULL DEFAULT 'published'
    CHECK (status IN ('draft', 'published', 'archived')),
  ADD COLUMN IF NOT EXISTS version_number INT  NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS published_at   TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_platform_catalog_status
  ON platform_catalog.items (app_id, tenant_id, status);

CREATE TABLE IF NOT EXISTS platform_catalog.item_images (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT         NOT NULL,
  tenant_id       UUID         NOT NULL,
  item_id         UUID         NOT NULL REFERENCES platform_catalog.items(id) ON DELETE CASCADE,
  object_id       UUID         NOT NULL,
  alt_text        TEXT,
  display_order   INT          NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_catalog_images_item
  ON platform_catalog.item_images (item_id, display_order);

ALTER TABLE platform_catalog.item_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_catalog.item_images FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_catalog_images_isolation ON platform_catalog.item_images
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

GRANT SELECT, INSERT, UPDATE, DELETE
  ON platform_catalog.item_images
  TO svc_platform_catalog;

-- Versions log: an append-only history of published states, written each
-- time setStatus moves an item into 'published'. Lets a future "rollback to
-- version N" feature work without reading audit logs.
CREATE TABLE IF NOT EXISTS platform_catalog.item_versions (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT         NOT NULL,
  tenant_id       UUID         NOT NULL,
  item_id         UUID         NOT NULL REFERENCES platform_catalog.items(id) ON DELETE CASCADE,
  version_number  INT          NOT NULL,
  snapshot        JSONB        NOT NULL,
  published_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  actor_user_id   UUID,
  UNIQUE (item_id, version_number)
);

ALTER TABLE platform_catalog.item_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_catalog.item_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_catalog_versions_isolation ON platform_catalog.item_versions
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

GRANT SELECT, INSERT
  ON platform_catalog.item_versions
  TO svc_platform_catalog;
