-- Dispatch priorities (use-cases delivery-dispatch.md):
--   #2 CRUD básico de riders (soft-delete con motivo)
--   #4 Webhook entrante de agregadores (lookup rápido por external_ref)
-- No edita migraciones previas; solo añade columnas/índices.

-- Soft-delete de riders (baja temporal con motivo). NULL = activo.
ALTER TABLE platform_delivery_dispatch.riders
  ADD COLUMN IF NOT EXISTS deleted_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_reason  TEXT;

-- Webhook entrante: las deliveries de agregadores se localizan por (carrier, external_ref).
CREATE INDEX IF NOT EXISTS idx_platform_dd_deliveries_external_ref
  ON platform_delivery_dispatch.deliveries (app_id, tenant_id, carrier, external_ref)
  WHERE external_ref IS NOT NULL;
