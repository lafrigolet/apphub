import { encryptSecret, decryptSecret } from '@apphub/platform-sdk/crypto'

// Repositorio de certificados con la clave privada CIFRADA at-rest.
//
// El PKCS#12 es binario; encryptSecret/decryptSecret trabajan sobre UTF-8, así
// que el blob se codifica base64 antes de cifrar y se decodifica al descifrar.
// La passphrase es texto → se cifra directa. Las columnas pkcs12_cifrado /
// passphrase_cifrada son BYTEA (iv||tag||ciphertext).

const SCHEMA = 'platform_verifactu'

const enc12 = (buf) => (buf ? encryptSecret(buf.toString('base64')) : null)
const dec12 = (blob) => {
  const b64 = decryptSecret(blob)
  return b64 ? Buffer.from(b64, 'base64') : null
}

const DISPLAY_COLS = `id, nombre, meta, estado, tone, icon_tone, cn, emisor,
  numero_serie, uso, activo, caduca_en, created_at`

function toDisplay(r) {
  if (!r) return null
  return {
    id: r.id, nombre: r.nombre, meta: r.meta, estado: r.estado, tone: r.tone,
    iconTone: r.icon_tone, cn: r.cn, emisor: r.emisor, numeroSerie: r.numero_serie,
    uso: r.uso, activo: r.activo, caducaEn: r.caduca_en,
  }
}

export async function listCertificados(client) {
  const { rows } = await client.query(
    `SELECT ${DISPLAY_COLS} FROM ${SCHEMA}.certificados ORDER BY created_at ASC`,
  )
  return rows.map(toDisplay)
}

export async function getCertificadoDisplay(client, id) {
  const { rows } = await client.query(
    `SELECT ${DISPLAY_COLS} FROM ${SCHEMA}.certificados WHERE id = $1 LIMIT 1`, [id],
  )
  return toDisplay(rows[0])
}

export async function insertCertificado(client, c) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.certificados
       (app_id, tenant_id, sub_tenant_id, nombre, meta, estado, tone, icon_tone,
        cn, emisor, numero_serie, uso, activo, caduca_en, pkcs12_cifrado, passphrase_cifrada)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     RETURNING ${DISPLAY_COLS}`,
    [
      c.appId, c.tenantId, c.subTenantId ?? null, c.nombre, c.meta ?? null,
      c.estado ?? 'Vigente', c.tone ?? 'ok', c.iconTone ?? 'emerald',
      c.cn ?? null, c.emisor ?? null, c.numeroSerie ?? null, c.uso ?? 'firma',
      c.activo ?? true, c.caducaEn ?? null,
      enc12(c.pkcs12), c.passphrase != null ? encryptSecret(c.passphrase) : null,
    ],
  )
  return toDisplay(rows[0])
}

// Sustituye el material y los metadatos de un certificado existente (renovación).
export async function replaceCertificado(client, id, c) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.certificados
        SET meta = $2, estado = 'Vigente', tone = 'ok', cn = $3, emisor = $4,
            numero_serie = $5, uso = COALESCE($6, uso), activo = true, caduca_en = $7,
            pkcs12_cifrado = $8, passphrase_cifrada = $9
      WHERE id = $1
      RETURNING ${DISPLAY_COLS}`,
    [
      id, c.meta ?? null, c.cn ?? null, c.emisor ?? null, c.numeroSerie ?? null,
      c.uso ?? null, c.caducaEn ?? null, enc12(c.pkcs12),
      c.passphrase != null ? encryptSecret(c.passphrase) : null,
    ],
  )
  return toDisplay(rows[0])
}

export async function deleteCertificado(client, id) {
  const { rowCount } = await client.query(
    `DELETE FROM ${SCHEMA}.certificados WHERE id = $1`, [id],
  )
  return rowCount > 0
}

// Devuelve el certificado ACTIVO a usar para firmar/remitir (más reciente del
// `uso` pedido), con el PKCS#12 y la passphrase DESCIFRADOS en memoria. Úsalo
// sólo en el momento de firmar/enviar; nunca lo persistas ni lo loguees.
export async function getCertificadoActivoMaterial(client, { uso = 'firma' } = {}) {
  const { rows } = await client.query(
    `SELECT id, cn, emisor, caduca_en, pkcs12_cifrado, passphrase_cifrada
       FROM ${SCHEMA}.certificados
      WHERE activo = true AND pkcs12_cifrado IS NOT NULL AND uso = $1
      ORDER BY created_at DESC LIMIT 1`,
    [uso],
  )
  const r = rows[0]
  if (!r) return null
  return {
    id: r.id, cn: r.cn, emisor: r.emisor, caducaEn: r.caduca_en,
    pkcs12: dec12(r.pkcs12_cifrado),
    passphrase: r.passphrase_cifrada ? decryptSecret(r.passphrase_cifrada) : '',
  }
}
