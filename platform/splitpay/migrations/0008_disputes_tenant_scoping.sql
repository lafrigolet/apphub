-- Migration 0008: tenant scoping for disputes (priority #3).
--
-- Hasta ahora la tabla `disputes` no tenía tenant_id: cualquier disputa del
-- webhook quedaba en una tabla global, sin aislamiento. Añadimos app_id /
-- tenant_id / sub_tenant_id (resueltos desde la transacción asociada al charge)
-- + RLS. Las columnas son nullable porque un chargeback puede llegar antes de
-- que podamos resolver la transacción origen (charge no encontrado); esas filas
-- huérfanas solo son visibles bajo el rol de migración/bypass, nunca por un
-- tenant normal.

SET search_path TO splitpay_core;

ALTER TABLE disputes ADD COLUMN IF NOT EXISTS app_id            TEXT;
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS tenant_id         UUID;
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS sub_tenant_id     UUID;
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT;
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS transaction_id    UUID REFERENCES transactions (id);

CREATE INDEX IF NOT EXISTS idx_disputes_tenant ON disputes (tenant_id, created_at DESC)
  WHERE tenant_id IS NOT NULL;

ALTER TABLE disputes ENABLE ROW LEVEL SECURITY;

-- Sólo filas del tenant actual; las filas sin tenant resuelto (tenant_id NULL)
-- quedan ocultas a usuarios normales y solo accesibles por el rol de migración.
CREATE POLICY disputes_tenant_isolation ON disputes
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
