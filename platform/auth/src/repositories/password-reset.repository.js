const SCHEMA = 'platform_auth'

// `id` sigue siendo un UUID (PK) pero ya NO es el secreto. El secreto es un
// token plano aleatorio cuyo SHA-256 guardamos en `token_hash`. Así un dump
// de BD no permite explotar resets activos (paridad con magic_links /
// activation_tokens).
export async function createReset(client, { id, userId, appId, tenantId, tokenHash, expiresAt }) {
  await client.query(
    `INSERT INTO ${SCHEMA}.password_resets (id, user_id, app_id, tenant_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, userId, appId, tenantId, tokenHash, expiresAt],
  )
}

// Verificación por hash del token plano entrante (camino nuevo, seguro).
export async function findValidByHash(client, tokenHash) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.password_resets
     WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() LIMIT 1`,
    [tokenHash],
  )
  return rows[0] ?? null
}

// Compatibilidad legacy: filas creadas antes de la migración 0010 tienen
// token_hash=NULL y el token era el propio `id` (UUID plano). Sólo se
// resuelven por `id` y sólo mientras `token_hash IS NULL` — nunca se usa
// este camino para tokens nuevos. Caduca naturalmente al expirar (TTL 1h).
export async function findValidLegacyById(client, token) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.password_resets
     WHERE id = $1 AND token_hash IS NULL AND used_at IS NULL AND expires_at > now() LIMIT 1`,
    [token],
  )
  return rows[0] ?? null
}

export async function markResetUsed(client, id) {
  await client.query(
    `UPDATE ${SCHEMA}.password_resets SET used_at = now() WHERE id = $1`,
    [id],
  )
}
