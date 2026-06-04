-- Donaciones — incremento V2.
--
-- Añade soporte para:
--   * Importes sugeridos configurables por tenant/causa (rec. #6):
--       - tabla platform_donations.tenant_settings con el array por defecto
--         del tenant (fondo general / causa sin override).
--       - columna suggested_amounts_cents en causes para override por causa.
--   * Marcado de envío de certificados (rec. #2): la columna sent_at ya
--     existe en fiscal_certificates desde 0001; aquí no se toca el schema,
--     sólo se documenta que pasa a usarse desde el servicio.
--
-- Multi-tenant: aislamiento por (app_id, tenant_id) con RLS forzada,
-- mismo patrón que el resto de tablas del módulo.
-- NUNCA editar migraciones existentes — este fichero es correlativo.

------------------------------------------------------------------
-- 1. Importes sugeridos por causa (override)
------------------------------------------------------------------

ALTER TABLE platform_donations.causes
  ADD COLUMN IF NOT EXISTS suggested_amounts_cents BIGINT[];

------------------------------------------------------------------
-- 2. Configuración por tenant (importes sugeridos por defecto)
--    Una fila por (app_id, tenant_id, sub_tenant_id). sub_tenant_id
--    nullable para soportar jerarquía de dos niveles.
------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS platform_donations.tenant_settings (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id                   TEXT NOT NULL,
  tenant_id                UUID NOT NULL,
  sub_tenant_id            UUID,
  default_suggested_amounts_cents BIGINT[] NOT NULL DEFAULT '{}',
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (app_id, tenant_id, sub_tenant_id)
);

ALTER TABLE platform_donations.tenant_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_donations.tenant_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_donations_tenant_settings_isolation
  ON platform_donations.tenant_settings
  USING (
    current_setting('app.staff_access', true) = 'true'
    OR (
      app_id    = current_setting('app.app_id', true)
      AND tenant_id = (current_setting('app.tenant_id', true))::uuid
    )
  );
