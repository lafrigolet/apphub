-- 0009 — Entorno de remisión por tenant (test / prod).
--
-- Cada obligado (tenant) elige contra qué entorno de la AEAT remite: 'test'
-- (preproducción, prewww1/prewww10) o 'prod' (producción, www1/www10). Se
-- snapshotea en cada fila de remision_queue al encolar. La gestión es desde
-- console.hulkstein (staff) junto con el NIF/razón del obligado y el certificado.
ALTER TABLE platform_verifactu.config
  ADD COLUMN IF NOT EXISTS entorno TEXT NOT NULL DEFAULT 'test'
    CHECK (entorno IN ('test', 'prod'));
