-- Columna libre para config per-app que no merece schema dedicado todavía.
-- V1: solo se usa para `metadata.solarCalculator` desde js-electric.
-- Convención: las claves de primer nivel son namespaces controlados por
-- platform/tenant-config — añadirlas a nuevos apps requiere endpoint + schema
-- zod (no escribir directamente desde otros módulos).
ALTER TABLE platform_tenants.apps
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
