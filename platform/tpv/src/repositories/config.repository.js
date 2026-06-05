import { encryptSecret, decryptSecret } from '@apphub/platform-sdk/crypto'

const SCHEMA = 'platform_tpv'

// V1 sin secretos reales — la maquinaria de cifrado queda lista para cuando
// el módulo necesite claves (p.ej. firma de tickets, pasarela de hardware).
const SECRET_KEYS = []
const PLAIN_KEYS = [
  'default_session_autoclose_hours',
  'default_cash_out_manager_threshold_cents',
  'receipt_render_footer',
]
export const KEYS = [...SECRET_KEYS, ...PLAIN_KEYS]

function isSecret(key) {
  return SECRET_KEYS.includes(key)
}

export async function getValue(client, key) {
  const { rows } = await client.query(
    `SELECT encrypted_value, plain_value FROM ${SCHEMA}.config WHERE key = $1`, [key],
  )
  if (rows.length === 0) return null
  if (isSecret(key)) return rows[0].encrypted_value ? decryptSecret(rows[0].encrypted_value) : null
  return rows[0].plain_value
}

export async function listForAdmin(client) {
  const { rows } = await client.query(
    `SELECT key, encrypted_value, plain_value, updated_at FROM ${SCHEMA}.config ORDER BY key`,
  )
  return KEYS.map((k) => {
    const r = rows.find((x) => x.key === k)
    if (isSecret(k)) {
      // los secretos nunca vuelven en claro: solo el flag configured
      return { key: k, configured: Boolean(r?.encrypted_value), updatedAt: r?.updated_at ?? null }
    }
    return { key: k, value: r?.plain_value ?? null, updatedAt: r?.updated_at ?? null }
  })
}

export async function upsertValue(client, key, value) {
  if (!KEYS.includes(key)) throw new Error(`Unknown tpv config key: ${key}`)
  if (isSecret(key)) {
    await client.query(
      `INSERT INTO ${SCHEMA}.config (key, encrypted_value, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE
         SET encrypted_value = EXCLUDED.encrypted_value, plain_value = NULL, updated_at = now()`,
      [key, encryptSecret(value)],
    )
  } else {
    await client.query(
      `INSERT INTO ${SCHEMA}.config (key, plain_value, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE
         SET plain_value = EXCLUDED.plain_value, encrypted_value = NULL, updated_at = now()`,
      [key, value],
    )
  }
}
