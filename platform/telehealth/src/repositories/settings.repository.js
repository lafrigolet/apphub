import { encryptSecret, decryptSecret } from '@apphub/platform-sdk/crypto'

const SECRET_KEYS = [
  'daily_api_key',
  'twilio_api_key_secret',
  'whereby_api_key',
  'jitsi_private_key',
]

const PLAIN_KEYS = [
  'active_provider',
  'daily_domain',
  'twilio_account_sid',
  'twilio_api_key_sid',
  'whereby_subdomain',
  'jitsi_app_id',
  'jitsi_api_key_id',
]

export const KEYS = [...SECRET_KEYS, ...PLAIN_KEYS]

const isSecret = (k) => SECRET_KEYS.includes(k)

export async function getValue(client, key) {
  const { rows } = await client.query(
    `SELECT encrypted_value, plain_value
       FROM platform_telehealth.settings
      WHERE key = $1`,
    [key],
  )
  if (rows.length === 0) return null
  return isSecret(key) ? decryptSecret(rows[0].encrypted_value) : rows[0].plain_value
}

export async function getAll(client) {
  const { rows } = await client.query(
    `SELECT key, encrypted_value, plain_value FROM platform_telehealth.settings`,
  )
  const out = {}
  for (const r of rows) {
    out[r.key] = isSecret(r.key) ? decryptSecret(r.encrypted_value) : r.plain_value
  }
  return out
}

export async function listForAdmin(client) {
  const { rows } = await client.query(
    `SELECT key, encrypted_value, plain_value, updated_at
       FROM platform_telehealth.settings
      ORDER BY key`,
  )
  return KEYS.map((k) => {
    const r = rows.find((x) => x.key === k)
    if (isSecret(k)) {
      return { key: k, configured: !!r?.encrypted_value, updatedAt: r?.updated_at ?? null }
    }
    return { key: k, value: r?.plain_value ?? null, updatedAt: r?.updated_at ?? null }
  })
}

export async function upsertValue(client, key, value) {
  if (!KEYS.includes(key)) throw new Error(`Unknown telehealth settings key: ${key}`)
  if (isSecret(key)) {
    await client.query(
      `INSERT INTO platform_telehealth.settings (key, encrypted_value, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE
         SET encrypted_value = EXCLUDED.encrypted_value, plain_value = NULL, updated_at = now()`,
      [key, encryptSecret(value)],
    )
  } else {
    await client.query(
      `INSERT INTO platform_telehealth.settings (key, plain_value, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE
         SET plain_value = EXCLUDED.plain_value, encrypted_value = NULL, updated_at = now()`,
      [key, value],
    )
  }
}
