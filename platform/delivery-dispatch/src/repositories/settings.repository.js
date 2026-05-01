import { encryptSecret, decryptSecret } from '@apphub/platform-sdk/crypto'

const SECRET_KEYS = [
  'uber_client_id',
  'uber_client_secret',
  'uber_webhook_secret',
  'glovo_api_key',
  'glovo_webhook_secret',
  'stuart_client_id',
  'stuart_client_secret',
  'stuart_webhook_secret',
]

const PLAIN_KEYS = [
  'uber_enabled',
  'uber_environment',
  'uber_customer_id',
  'glovo_enabled',
  'glovo_environment',
  'stuart_enabled',
  'stuart_environment',
]

export const KEYS = [...SECRET_KEYS, ...PLAIN_KEYS]

const isSecret = (k) => SECRET_KEYS.includes(k)

export async function getValue(client, key) {
  const { rows } = await client.query(
    `SELECT encrypted_value, plain_value
       FROM platform_delivery_dispatch.settings
      WHERE key = $1`,
    [key],
  )
  if (rows.length === 0) return null
  return isSecret(key) ? decryptSecret(rows[0].encrypted_value) : rows[0].plain_value
}

export async function getAll(client) {
  const { rows } = await client.query(
    `SELECT key, encrypted_value, plain_value FROM platform_delivery_dispatch.settings`,
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
       FROM platform_delivery_dispatch.settings
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
  if (!KEYS.includes(key)) throw new Error(`Unknown delivery-dispatch settings key: ${key}`)
  if (isSecret(key)) {
    await client.query(
      `INSERT INTO platform_delivery_dispatch.settings (key, encrypted_value, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE
         SET encrypted_value = EXCLUDED.encrypted_value, plain_value = NULL, updated_at = now()`,
      [key, encryptSecret(value)],
    )
  } else {
    await client.query(
      `INSERT INTO platform_delivery_dispatch.settings (key, plain_value, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE
         SET plain_value = EXCLUDED.plain_value, encrypted_value = NULL, updated_at = now()`,
      [key, value],
    )
  }
}
