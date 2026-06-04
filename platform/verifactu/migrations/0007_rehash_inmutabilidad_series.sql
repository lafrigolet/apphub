-- 0007 — Re-hash auditable, inmutabilidad reforzada y series de facturación.
--
-- Tres bloques, todos viables backend-only con specs públicas (Orden
-- HAC/1177/2024 + documento oficial de huella, cuyo VECTOR DE TEST ya está
-- blindado en src/__tests__/huella.test.js):
--
--  A) Re-hash auditable (recomendación #9 / TODO A1): para poder RECALCULAR la
--     huella de cada registro (no solo verificar el enlace declarado) hay que
--     persistir los campos canónicos EXACTOS que entran en la cadena:
--     IDEmisorFactura y FechaHoraHusoGenRegistro (con su offset de huso).
--     tipo_factura, cuota_total, importe_total, num_serie y fecha_expedicion ya
--     se persisten. Las filas antiguas (seed demo) quedan con id_emisor /
--     gen_registro NULL → el recálculo las marca "no_verificable" en vez de
--     "rota".
--
--  B) Inmutabilidad reforzada (uso §18): los registros y eventos del SIF son
--     append-only por ley. Un trigger BEFORE UPDATE/DELETE los bloquea a nivel
--     de motor — ni siquiera el rol de aplicación puede mutar la cadena. El
--     trigger touch_updated_at de registros se elimina (ya no hay UPDATE válido).
--
--  C) Series de facturación (recomendación #11 / uso §14): entidad `series` con
--     contador correlativo por (app, tenant, serie). Permite múltiples series
--     (ventas / rectificativas / export) y numeración sin huecos vía
--     SELECT ... FOR UPDATE en el servicio.

------------------------------------------------------------------
-- A) Campos canónicos para re-hash auditable
------------------------------------------------------------------
ALTER TABLE platform_verifactu.registros
  ADD COLUMN IF NOT EXISTS id_emisor    TEXT,   -- IDEmisorFactura usado en la huella (NIF del obligado)
  ADD COLUMN IF NOT EXISTS gen_registro TEXT;   -- FechaHoraHusoGenRegistro EXACTA (ISO-8601 con offset) usada en la huella

------------------------------------------------------------------
-- C) Series de facturación
------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_verifactu.series (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id         TEXT         NOT NULL,
  tenant_id      UUID         NOT NULL,
  sub_tenant_id  UUID,
  codigo         TEXT         NOT NULL,                         -- "2027-A", "RECT", "EXP"
  descripcion    TEXT,
  ejercicio      INTEGER,                                       -- año fiscal (NULL = sin cierre por ejercicio)
  siguiente      INTEGER      NOT NULL DEFAULT 1,               -- próximo correlativo a asignar
  activa         BOOLEAN      NOT NULL DEFAULT true,            -- false = cerrada, no admite nuevos registros
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (app_id, tenant_id, codigo)
);

CREATE INDEX IF NOT EXISTS idx_vf_series_tenant
  ON platform_verifactu.series (app_id, tenant_id, created_at DESC);

ALTER TABLE platform_verifactu.series ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_verifactu.series FORCE  ROW LEVEL SECURITY;
CREATE POLICY vf_tenant_isolation ON platform_verifactu.series
  USING (
    app_id = current_setting('app.app_id', true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE TRIGGER trg_vf_series_touch BEFORE UPDATE ON platform_verifactu.series
  FOR EACH ROW EXECUTE FUNCTION platform_verifactu.touch_updated_at();

------------------------------------------------------------------
-- B) Inmutabilidad: bloquear UPDATE/DELETE sobre la cadena
------------------------------------------------------------------
CREATE OR REPLACE FUNCTION platform_verifactu.deny_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'registros de facturación VERI*FACTU son inmutables (append-only): % no permitido sobre %', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

-- registros: ya no hay UPDATE legítimo → quitamos el trigger touch y bloqueamos.
DROP TRIGGER IF EXISTS trg_vf_registros_touch ON platform_verifactu.registros;
CREATE TRIGGER trg_vf_registros_immutable
  BEFORE UPDATE OR DELETE ON platform_verifactu.registros
  FOR EACH ROW EXECUTE FUNCTION platform_verifactu.deny_mutation();

CREATE TRIGGER trg_vf_eventos_immutable
  BEFORE UPDATE OR DELETE ON platform_verifactu.eventos
  FOR EACH ROW EXECUTE FUNCTION platform_verifactu.deny_mutation();
