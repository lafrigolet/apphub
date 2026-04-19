export async function createTransaction(client, { id, userId, bonusTypeId, provider, providerTxId, amountEur, tenantId, subTenantId }) {
  const { rows } = await client.query(
    `INSERT INTO yoga_payments.transactions
       (id, user_id, bonus_type_id, provider, provider_tx_id, amount_eur, status, tenant_id, sub_tenant_id)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8)
     RETURNING *`,
    [id, userId, bonusTypeId ?? null, provider, providerTxId, amountEur, tenantId, subTenantId ?? null],
  )
  return rows[0]
}

export async function completeTransaction(client, providerTxId) {
  const { rows } = await client.query(
    `UPDATE yoga_payments.transactions
     SET status = 'completed', completed_at = now()
     WHERE provider_tx_id = $1
     RETURNING *`,
    [providerTxId],
  )
  return rows[0] ?? null
}

export async function listByUser(client, userId, tenantId) {
  const { rows } = await client.query(
    `SELECT id, bonus_type_id, provider, amount_eur, status, invoice_url, created_at, completed_at
     FROM yoga_payments.transactions WHERE user_id = $1 AND tenant_id = $2 ORDER BY created_at DESC`,
    [userId, tenantId],
  )
  return rows
}

export async function refundTransaction(client, id, tenantId) {
  const { rows } = await client.query(
    `UPDATE yoga_payments.transactions SET status = 'refunded' WHERE id = $1 AND tenant_id = $2 RETURNING *`,
    [id, tenantId],
  )
  return rows[0] ?? null
}

export async function findByProviderTxId(client, providerTxId) {
  const { rows } = await client.query(
    `SELECT * FROM yoga_payments.transactions WHERE provider_tx_id = $1`,
    [providerTxId],
  )
  return rows[0] ?? null
}
