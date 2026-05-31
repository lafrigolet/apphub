-- Huella encadenada en los registros de evento del SIF (F2).
-- Los eventos del seed (0002) quedan con huella NULL (ilustrativos); los
-- creados vía crearEvento obtienen su huella SHA-256 encadenada.

ALTER TABLE platform_verifactu.eventos
  ADD COLUMN IF NOT EXISTS huella           TEXT,
  ADD COLUMN IF NOT EXISTS huella_anterior  TEXT;
