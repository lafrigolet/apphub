-- Hashing de tokens en password_resets (paridad SHA-256 con magic_links y
-- activation_tokens) — recomendación de priorización #1.
--
-- Antes: el token de reset era el propio `id` (UUID plano) de la fila. Un
-- dump de la BD exponía tokens directamente explotables mientras no
-- expiraran. Ahora generamos un token plano aleatorio (32 bytes URL-safe),
-- enviamos el plano por email y persistimos sólo su SHA-256 en `token_hash`.
--
-- Compatibilidad: las filas antiguas tienen `token_hash = NULL` y siguen
-- siendo verificables por `id` (UUID plano) durante su TTL de 1h restante.
-- El código intenta primero la verificación por hash y, sólo si el token
-- entrante es un UUID, cae al lookup legacy por `id`. Pasada 1h ya no
-- quedan filas legacy válidas. Esto es estrictamente más seguro: los
-- tokens NUEVOS nunca se guardan en claro.

ALTER TABLE platform_auth.password_resets
  ADD COLUMN IF NOT EXISTS token_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_platform_auth_resets_token_hash
  ON platform_auth.password_resets (token_hash);
