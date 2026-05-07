import { encryptSecret, decryptSecret } from '@apphub/platform-sdk/crypto'

const SECRET_KEYS = [
  'sendgrid_api_key',
  'twilio_api_key_secret',
  'fcm_service_account_json',
  'apns_p8_key',
]
const PLAIN_KEYS  = [
  'sender_email',
  'sender_name',
  'twilio_account_sid',
  'twilio_api_key_sid',
  'twilio_messaging_service_sid',
  'twilio_default_sender',
  'rate_limit_per_user_per_hour',
  'rate_limit_per_user_per_day',
  'digest_mode',
  'fcm_project_id',
  'apns_team_id',
  'apns_key_id',
  'apns_bundle_id',
  'apns_environment',
]

export const KEYS = [...SECRET_KEYS, ...PLAIN_KEYS]

function isSecret(key) {
  return SECRET_KEYS.includes(key)
}

export async function getValue(client, key) {
  const { rows } = await client.query(
    `SELECT encrypted_value, plain_value FROM platform_notifications.config WHERE key = $1`, [key],
  )
  if (rows.length === 0) return null
  if (isSecret(key)) return decryptSecret(rows[0].encrypted_value)
  return rows[0].plain_value
}

export async function listConfig(client) {
  const { rows } = await client.query(
    `SELECT key, encrypted_value, plain_value, updated_at FROM platform_notifications.config ORDER BY key`,
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
  if (!KEYS.includes(key)) throw new Error(`Unknown notifications config key: ${key}`)
  if (isSecret(key)) {
    await client.query(
      `INSERT INTO platform_notifications.config (key, encrypted_value, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET encrypted_value = EXCLUDED.encrypted_value, plain_value = NULL, updated_at = now()`,
      [key, encryptSecret(value)],
    )
  } else {
    await client.query(
      `INSERT INTO platform_notifications.config (key, plain_value, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET plain_value = EXCLUDED.plain_value, encrypted_value = NULL, updated_at = now()`,
      [key, value],
    )
  }
}
