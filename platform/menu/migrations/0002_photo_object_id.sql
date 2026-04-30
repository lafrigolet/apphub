-- Storage integration: menu_items now reference uploaded photos via the
-- platform_storage.objects table. photo_url stays for backwards-compat
-- (existing data + frontend migration); new uploads use photo_object_id.

ALTER TABLE platform_menu.menu_items
  ADD COLUMN IF NOT EXISTS photo_object_id UUID;

CREATE INDEX IF NOT EXISTS idx_menu_items_photo_object
  ON platform_menu.menu_items (photo_object_id)
  WHERE photo_object_id IS NOT NULL;
