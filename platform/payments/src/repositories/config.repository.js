import { encryptSecret, decryptSecret } from '@apphub/platform-sdk/crypto'

export const KEYS = ['stripe_publishable_key', 'stripe_secret_key', 'stripe_webhook_secret']

export async function getValue(client, key) {
  const { rows } = await client.query(
    `SELECT encrypted_value FROM platform_payments.config WHERE key = $1`, [key],
  )
  if (rows.length === 0) return null
  return decryptSecret(rows[0].encrypted_value)
}

export async function listConfig(client) {
  const { rows } = await client.query(
    `SELECT key, encrypted_value, updated_at FROM platform_payments.config ORDER BY key`,
  )
  return KEYS.map((k) => {
    const r = rows.find((x) => x.key === k)
    return { key: k, configured: !!r?.encrypted_value, updatedAt: r?.updated_at ?? null }
  })
}

export async function upsertValue(client, key, value, updatedByUserId) {
  if (!KEYS.includes(key)) throw new Error(`Unknown payments config key: ${key}`)
  const enc = encryptSecret(value)
  await client.query(
    `INSERT INTO platform_payments.config (key, encrypted_value, updated_by_user_id, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (key) DO UPDATE SET encrypted_value = EXCLUDED.encrypted_value,
                                     updated_by_user_id = EXCLUDED.updated_by_user_id,
                                     updated_at = now()`,
    [key, enc, updatedByUserId ?? null],
  )
}
