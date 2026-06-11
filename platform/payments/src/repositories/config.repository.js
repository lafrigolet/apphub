import { encryptSecret, decryptSecret } from '@apphub/platform-sdk/crypto'

// Two Stripe key sets (test/live) + the persisted active mode. Key material is
// AES-GCM-encrypted; stripe_mode is a plain value (migration 0004 added the
// plain_value column for it).
const SECRET_KEYS = [
  'stripe_test_secret_key',
  'stripe_test_publishable_key',
  'stripe_test_webhook_secret',
  'stripe_live_secret_key',
  'stripe_live_publishable_key',
  'stripe_live_webhook_secret',
]
const PLAIN_KEYS = [
  'stripe_mode',          // 'test' | 'live'
  'terminal_location_id', // Stripe Terminal Location id (Tap to Pay), created lazily
]
export const KEYS = [...SECRET_KEYS, ...PLAIN_KEYS]

function isSecret(key) {
  return SECRET_KEYS.includes(key)
}

export async function getValue(client, key) {
  const { rows } = await client.query(
    `SELECT encrypted_value, plain_value FROM platform_payments.config WHERE key = $1`, [key],
  )
  if (rows.length === 0) return null
  if (isSecret(key)) return rows[0].encrypted_value ? decryptSecret(rows[0].encrypted_value) : null
  return rows[0].plain_value
}

export async function listConfig(client) {
  const { rows } = await client.query(
    `SELECT key, encrypted_value, plain_value, updated_at FROM platform_payments.config ORDER BY key`,
  )
  return KEYS.map((k) => {
    const r = rows.find((x) => x.key === k)
    if (isSecret(k)) {
      return { key: k, configured: !!r?.encrypted_value, updatedAt: r?.updated_at ?? null }
    }
    return { key: k, value: r?.plain_value ?? null, updatedAt: r?.updated_at ?? null }
  })
}

export async function upsertValue(client, key, value, updatedByUserId) {
  if (!KEYS.includes(key)) throw new Error(`Unknown payments config key: ${key}`)
  if (isSecret(key)) {
    await client.query(
      `INSERT INTO platform_payments.config (key, encrypted_value, updated_by_user_id, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (key) DO UPDATE SET encrypted_value = EXCLUDED.encrypted_value,
                                       plain_value = NULL,
                                       updated_by_user_id = EXCLUDED.updated_by_user_id,
                                       updated_at = now()`,
      [key, encryptSecret(value), updatedByUserId ?? null],
    )
  } else {
    await client.query(
      `INSERT INTO platform_payments.config (key, plain_value, updated_by_user_id, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (key) DO UPDATE SET plain_value = EXCLUDED.plain_value,
                                       encrypted_value = NULL,
                                       updated_by_user_id = EXCLUDED.updated_by_user_id,
                                       updated_at = now()`,
      [key, String(value), updatedByUserId ?? null],
    )
  }
}
