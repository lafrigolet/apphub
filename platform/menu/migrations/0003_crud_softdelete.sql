-- CRUD completo de carta + soft-delete.
-- Añade columnas updated_at a categorías (para PATCH) y deleted_at (soft-delete)
-- a menus, categorías e ítems. El soft-delete se filtra en las lecturas; el
-- aislamiento por (app_id, tenant_id) + RLS se mantiene intacto.

ALTER TABLE platform_menu.menus
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE platform_menu.menu_categories
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE platform_menu.menu_items
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Índices parciales para excluir filas borradas en las lecturas calientes.
CREATE INDEX IF NOT EXISTS idx_platform_menu_menus_live
  ON platform_menu.menus (tenant_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_platform_menu_categories_live
  ON platform_menu.menu_categories (menu_id, display_order)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_platform_menu_items_live
  ON platform_menu.menu_items (category_id)
  WHERE deleted_at IS NULL;
