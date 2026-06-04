// Acceso a platform_donations.fiscal_certificates para operaciones que
// no son la generación masiva (que vive inline en certificate.service.js
// por estar acoplada al render del PDF). Aquí: lookup individual y
// marcado de envío (rec. #2 — sent_at pasa a usarse).

const SCHEMA = 'platform_donations'

const COLUMNS = `
  id, app_id, tenant_id, fiscal_year, donor_nif, donor_email, donor_name,
  total_cents, donation_ids, pdf_object_id, generated_at, sent_at
`

export async function findById(client, id) {
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM ${SCHEMA}.fiscal_certificates WHERE id = $1 LIMIT 1`,
    [id],
  )
  return rows[0] ?? null
}

// Marca el certificado como enviado (sent_at = now()). Idempotente: si ya
// estaba marcado, refresca el timestamp.
export async function markSent(client, id) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.fiscal_certificates
        SET sent_at = now()
      WHERE id = $1
      RETURNING ${COLUMNS}`,
    [id],
  )
  return rows[0] ?? null
}
