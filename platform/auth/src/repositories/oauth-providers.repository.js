import { encryptSecret, decryptSecret } from '@apphub/platform-sdk/crypto'

const PROVIDERS = ['google', 'facebook']

export async function listProviders(client) {
  const { rows } = await client.query(
    `SELECT provider, client_id, encrypted_client_secret, enabled, updated_at
       FROM platform_auth.oauth_providers ORDER BY provider`,
  )
  return PROVIDERS.map((p) => {
    const r = rows.find((x) => x.provider === p)
    return r
      ? { provider: p, clientId: r.client_id, configured: !!r.encrypted_client_secret, enabled: r.enabled, updatedAt: r.updated_at }
      : { provider: p, clientId: null, configured: false, enabled: false, updatedAt: null }
  })
}

// Returns the live config for the provider, decrypting client_secret on the
// fly. Returns null if no row stored. Callers should fall back to env vars.
export async function getProviderConfig(client, provider) {
  const { rows } = await client.query(
    `SELECT client_id, encrypted_client_secret, enabled
       FROM platform_auth.oauth_providers WHERE provider = $1`,
    [provider],
  )
  if (rows.length === 0) return null
  return {
    clientId: rows[0].client_id,
    clientSecret: decryptSecret(rows[0].encrypted_client_secret),
    enabled: rows[0].enabled,
  }
}

// Upsert. Each field is independent: passing undefined leaves the existing
// value untouched; passing null/empty clears it. clientSecret is encrypted
// before persisting; we never store the plaintext.
export async function upsertProvider(client, { provider, clientId, clientSecret, enabled, updatedByUserId }) {
  if (!PROVIDERS.includes(provider)) throw new Error(`Unknown provider: ${provider}`)

  // Read-modify-write — simpler and only happens on admin writes (not hot path).
  const cur = await getProviderConfig(client, provider)
  const next = {
    clientId:     clientId     === undefined ? (cur?.clientId     ?? null) : (clientId     || null),
    clientSecret: clientSecret === undefined ? (cur?.clientSecret ?? null) : (clientSecret || null),
    enabled:      enabled      === undefined ? (cur?.enabled      ?? false) : !!enabled,
  }
  const enc = encryptSecret(next.clientSecret)

  await client.query(
    `INSERT INTO platform_auth.oauth_providers
       (provider, client_id, encrypted_client_secret, enabled, updated_by_user_id, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (provider) DO UPDATE SET
       client_id               = EXCLUDED.client_id,
       encrypted_client_secret = EXCLUDED.encrypted_client_secret,
       enabled                 = EXCLUDED.enabled,
       updated_by_user_id      = EXCLUDED.updated_by_user_id,
       updated_at              = now()`,
    [provider, next.clientId, enc, next.enabled, updatedByUserId ?? null],
  )
  return next
}
