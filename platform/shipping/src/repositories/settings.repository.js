import { encryptSecret, decryptSecret } from '@apphub/platform-sdk/crypto'

const SECRET_KEYS = [
  'ups_client_id',
  'ups_client_secret',
  'fedex_api_key',
  'fedex_secret_key',
  'dhl_api_key',
  'dhl_api_secret',
  'easypost_api_key',
  'easypost_webhook_secret',
]

const PLAIN_KEYS = [
  'ups_enabled',
  'ups_environment',
  'ups_account_number',
  'fedex_enabled',
  'fedex_environment',
  'fedex_account_number',
  'fedex_meter_number',
  'dhl_enabled',
  'dhl_environment',
  'dhl_account_number',
  'easypost_enabled',
  'easypost_environment',
]

export const KEYS = [...SECRET_KEYS, ...PLAIN_KEYS]

const isSecret = (k) => SECRET_KEYS.includes(k)

export async function getValue(client, key) {
  const { rows } = await client.query(
    `SELECT encrypted_value, plain_value
       FROM platform_shipping.settings
      WHERE key = $1`,
    [key],
  )
  if (rows.length === 0) return null
  return isSecret(key) ? decryptSecret(rows[0].encrypted_value) : rows[0].plain_value
}

export async function getAll(client) {
  const { rows } = await client.query(
    `SELECT key, encrypted_value, plain_value FROM platform_shipping.settings`,
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
       FROM platform_shipping.settings
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
  if (!KEYS.includes(key)) throw new Error(`Unknown shipping settings key: ${key}`)
  if (isSecret(key)) {
    await client.query(
      `INSERT INTO platform_shipping.settings (key, encrypted_value, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE
         SET encrypted_value = EXCLUDED.encrypted_value, plain_value = NULL, updated_at = now()`,
      [key, encryptSecret(value)],
    )
  } else {
    await client.query(
      `INSERT INTO platform_shipping.settings (key, plain_value, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE
         SET plain_value = EXCLUDED.plain_value, encrypted_value = NULL, updated_at = now()`,
      [key, value],
    )
  }
}
