-- Inventory variants: each variant is its own SKU row in inventory_items
-- with a back-reference to its parent_sku and a JSON map of option values
-- (e.g. {"size": "M", "color": "red"}). This keeps reserve/release/commit
-- per-variant atomic without changing any of the existing FSM logic; a
-- listing endpoint joins by parent_sku.
--
-- Why JSON option_values rather than a separate variant_options table?
-- Variant axes (size, color, material…) are tenant-defined and rarely
-- analytical. A normalised side-table would force a join on every PDP
-- query. JSONB lets us index option_values for tenants that need it
-- without coupling all of them.

ALTER TABLE platform_inventory.inventory_items
  ADD COLUMN IF NOT EXISTS parent_sku    TEXT,
  ADD COLUMN IF NOT EXISTS option_values JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS display_name  TEXT;

CREATE INDEX IF NOT EXISTS idx_platform_inventory_parent_sku
  ON platform_inventory.inventory_items (app_id, tenant_id, parent_sku)
  WHERE parent_sku IS NOT NULL;

-- Uniqueness on (parent, option_values) so the same combination can't be
-- registered twice. We use a generated text representation rather than
-- jsonb-typed column directly because PostgreSQL doesn't support a unique
-- index on a jsonb expression without a stable key ordering — encoded
-- jsonb gives that ordering automatically when generated as TEXT.
CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_inventory_variant_combo
  ON platform_inventory.inventory_items (app_id, tenant_id, parent_sku, (option_values::text))
  WHERE parent_sku IS NOT NULL;
