-- Magic-link passwordless login (A8).
--
-- Distinto de:
--   password_resets    → reset de contraseña (1h TTL, requiere fijar password)
--   activation_tokens  → owner-bootstrap (7d TTL, primer activate)
--
-- Magic-link de login: 15min TTL, single-use. Al consumir devuelve
-- access + refresh tokens directamente, sin fijar contraseña. Permite
-- coexistir con password login — el user elige.
--
-- Almacenamos SHA-256 del token plano (mismo patrón que activation_tokens).
-- Un dump de DB no permite usar los tokens — sólo el hash queda persistido.

CREATE TABLE IF NOT EXISTS platform_auth.magic_links (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES platform_auth.users(id) ON DELETE CASCADE,
  app_id      TEXT NOT NULL,
  tenant_id   UUID NOT NULL,
  token_hash  TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_magic_links_token_hash
  ON platform_auth.magic_links (token_hash);

CREATE INDEX IF NOT EXISTS idx_magic_links_user_id
  ON platform_auth.magic_links (user_id);

-- Limpieza periódica: el scheduler puede ejecutar
-- `DELETE FROM platform_auth.magic_links WHERE expires_at < now() - interval '7 days'`
-- pero para V1 dejamos que crezca; volumen es trivial.

ALTER TABLE platform_auth.magic_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_auth.magic_links FORCE ROW LEVEL SECURITY;

CREATE POLICY platform_auth_magic_links_isolation
  ON platform_auth.magic_links
  USING (
    -- staff bypass (igual que el resto de tablas del módulo)
    current_setting('app.staff_access', true) = 'true'
    OR (
      app_id = current_setting('app.app_id', true)
      AND tenant_id = (current_setting('app.tenant_id', true))::uuid
    )
  );
