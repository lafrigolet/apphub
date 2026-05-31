-- Solo modalidad VERI·FACTU: se descarta NO_VERI·FACTU de la plataforma.
-- La columna `modalidad` (CHECK VERIFACTU/NO_VERIFACTU) deja de tener sentido.
ALTER TABLE platform_verifactu.registros DROP COLUMN IF EXISTS modalidad;
