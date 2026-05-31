-- Obligado emisor en config (A10).
--
-- La huella usa el NIF del OBLIGADO emisor como IDEmisorFactura (no el NIF
-- del cliente, como hacía el stub). Cada (app, tenant) es un obligado; sus
-- datos viven en config junto al control de flujo. También alimentan la
-- cabecera SOAP de remisión y el parámetro `nif` de la URL de cotejo.

ALTER TABLE platform_verifactu.config
  ADD COLUMN IF NOT EXISTS nif_obligado    TEXT,
  ADD COLUMN IF NOT EXISTS nombre_obligado TEXT;

-- Backfill del tenant demo (coincide con el seed 0002 / lib/tenant.js).
UPDATE platform_verifactu.config
   SET nif_obligado    = COALESCE(nif_obligado,    'B12345678'),
       nombre_obligado = COALESCE(nombre_obligado, 'Ejemplo S.L.')
 WHERE app_id = 'verifactu'
   AND tenant_id = '11111111-1111-4111-8111-111111111111';
