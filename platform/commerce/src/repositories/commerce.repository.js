const SCHEMA = 'platform_commerce'

const COLS = `id, app_id, tenant_id, sub_tenant_id, kind, ref_id, client_user_id,
  amount_cents, currency, status, provider_tx_id, fulfillment, metadata, created_at, updated_at`

export async function insertCheckout(client, c) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.checkouts
       (app_id, tenant_id, sub_tenant_id, kind, ref_id, client_user_id, amount_cents, currency, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,'EUR'),$9)
     RETURNING ${COLS}`,
    [c.appId, c.tenantId, c.subTenantId ?? null, c.kind, c.refId, c.clientUserId ?? null,
     c.amountCents, c.currency ?? null, c.metadata ?? null],
  )
  return rows[0]
}

export async function getById(client, id) {
  const { rows } = await client.query(`SELECT ${COLS} FROM ${SCHEMA}.checkouts WHERE id = $1 LIMIT 1`, [id])
  return rows[0] ?? null
}

// Enlaza el id de transacción de platform/payments a un checkout pendiente.
export async function linkTx(client, id, providerTxId) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.checkouts SET provider_tx_id = $2
      WHERE id = $1 AND status = 'pending'
      RETURNING ${COLS}`,
    [id, providerTxId],
  )
  return rows[0] ?? null
}

export async function findByTx(client, providerTxId) {
  const { rows } = await client.query(
    `SELECT ${COLS} FROM ${SCHEMA}.checkouts WHERE provider_tx_id = $1 LIMIT 1`, [providerTxId],
  )
  return rows[0] ?? null
}

export async function markStatus(client, id, status, fulfillment = null) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.checkouts
        SET status = $2, fulfillment = COALESCE($3, fulfillment)
      WHERE id = $1
      RETURNING ${COLS}`,
    [id, status, fulfillment],
  )
  return rows[0] ?? null
}
