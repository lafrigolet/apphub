import { encryptSecret, decryptSecret } from '@apphub/platform-sdk/crypto'

const SECRET_KEYS = ['stripe_secret_key', 'stripe_webhook_secret']
const PLAIN_KEYS  = ['platform_account_id', 'stripe_publishable_key', 'stripe_fee_percent', 'stripe_fee_fixed']

export const KEYS = [...SECRET_KEYS, ...PLAIN_KEYS]

const isSecret = (k) => SECRET_KEYS.includes(k)

export async function getValue(client, key) {
  const { rows } = await client.query(
    `SELECT encrypted_value, plain_value FROM splitpay_core.config WHERE key = $1`, [key],
  )
  if (rows.length === 0) return null
  return isSecret(key) ? decryptSecret(rows[0].encrypted_value) : rows[0].plain_value
}

export async function listConfig(client) {
  const { rows } = await client.query(
    `SELECT key, encrypted_value, plain_value, updated_at FROM splitpay_core.config ORDER BY key`,
  )
  return KEYS.map((k) => {
    const r = rows.find((x) => x.key === k)
    if (isSecret(k)) return { key: k, configured: !!r?.encrypted_value, updatedAt: r?.updated_at ?? null }
    return { key: k, value: r?.plain_value ?? null, updatedAt: r?.updated_at ?? null }
  })
}

// ── Stripe fee config (priority #9) ──────────────────────────────────────────
// Resolves the configurable Stripe processing fee. `stripe_fee_percent` is a
// fraction (e.g. "0.014" for 1.4%); `stripe_fee_fixed` is in the smallest
// currency unit (e.g. "25"). Missing rows fall back to the EUR/USD defaults in
// utils/split-engine.js (caller passes the resolved object, or undefined).
export async function getFeeConfig(client) {
  const { rows } = await client.query(
    `SELECT key, plain_value FROM splitpay_core.config
      WHERE key IN ('stripe_fee_percent', 'stripe_fee_fixed')`,
  )
  const map = Object.fromEntries(rows.map((r) => [r.key, r.plain_value]))
  const out = {}
  const percent = map.stripe_fee_percent != null ? Number(map.stripe_fee_percent) : NaN
  const fixed = map.stripe_fee_fixed != null ? Number(map.stripe_fee_fixed) : NaN
  if (Number.isFinite(percent)) out.percent = percent
  if (Number.isFinite(fixed)) out.fixed = fixed
  return out
}

export async function upsertValue(client, key, value) {
  if (!KEYS.includes(key)) throw new Error(`Unknown splitpay config key: ${key}`)
  if (isSecret(key)) {
    await client.query(
      `INSERT INTO splitpay_core.config (key, encrypted_value, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET encrypted_value = EXCLUDED.encrypted_value, plain_value = NULL, updated_at = now()`,
      [key, encryptSecret(value)],
    )
  } else {
    await client.query(
      `INSERT INTO splitpay_core.config (key, plain_value, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET plain_value = EXCLUDED.plain_value, encrypted_value = NULL, updated_at = now()`,
      [key, value],
    )
  }
}
