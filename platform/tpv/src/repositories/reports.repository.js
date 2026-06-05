const SCHEMA = 'platform_tpv'

// Agregados de una sesión para informes X/Z. Trabaja sobre los snapshots
// (billing_facts + receipts + receipt_lines + cash_movements) — nunca sobre
// datos vivos de pos.

export async function paymentsBySession(client, sessionId) {
  // payments es JSONB [{method, amountCents, tipCents}] dentro del fact.
  const { rows } = await client.query(
    `SELECT p->>'method' AS method,
            SUM((p->>'amountCents')::bigint)::bigint AS amount_cents,
            SUM(COALESCE((p->>'tipCents')::bigint, 0))::bigint AS tip_cents,
            COUNT(*)::int AS payments
       FROM ${SCHEMA}.billing_facts f,
            jsonb_array_elements(f.payments) AS p
      WHERE f.session_id = $1 AND f.status <> 'cancelled'
      GROUP BY 1 ORDER BY 1`,
    [sessionId],
  )
  return rows.map((r) => ({
    method: r.method,
    amountCents: Number(r.amount_cents),
    tipCents: Number(r.tip_cents),
    payments: r.payments,
  }))
}

export async function receiptsSummaryBySession(client, sessionId) {
  // Las facturas de canje (converted_from_receipt_id) se excluyen: la venta
  // ya cuenta en el documento original — si no, el canje doblaría el total.
  const { rows } = await client.query(
    `SELECT type, COUNT(*)::int AS count, COALESCE(SUM(total_cents), 0)::bigint AS total_cents
       FROM ${SCHEMA}.receipts
      WHERE session_id = $1 AND status <> 'voided' AND converted_from_receipt_id IS NULL
      GROUP BY type ORDER BY type`,
    [sessionId],
  )
  return rows.map((r) => ({ type: r.type, count: r.count, totalCents: Number(r.total_cents) }))
}

export async function taxByRateBySession(client, sessionId) {
  const { rows } = await client.query(
    `SELECT rl.tax_rate,
            SUM(rl.line_base_cents)::bigint AS base_cents,
            SUM(rl.line_tax_cents)::bigint  AS quota_cents
       FROM ${SCHEMA}.receipt_lines rl
       JOIN ${SCHEMA}.receipts r ON r.id = rl.receipt_id
      WHERE r.session_id = $1 AND r.status <> 'voided'
        AND r.converted_from_receipt_id IS NULL  -- canjes fuera: la venta cuenta en el original
      GROUP BY rl.tax_rate ORDER BY rl.tax_rate`,
    [sessionId],
  )
  return rows.map((r) => ({
    rate: Number(r.tax_rate),
    baseCents: Number(r.base_cents),
    quotaCents: Number(r.quota_cents),
  }))
}

export async function creditNotesSummaryBySession(client, sessionId) {
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS count, COALESCE(SUM(n.amount_cents), 0)::bigint AS total_cents
       FROM ${SCHEMA}.credit_notes n
       JOIN ${SCHEMA}.receipts r ON r.id = n.original_receipt_id
      WHERE r.session_id = $1 AND n.status = 'authorized'`,
    [sessionId],
  )
  return { count: rows[0].count, totalCents: Number(rows[0].total_cents) }
}

// Agregados por periodo (informe de ventas / export contable).
export async function receiptsByPeriod(client, { from, to, groupBy = 'day' }) {
  const bucket = groupBy === 'month' ? 'month' : groupBy === 'week' ? 'week' : 'day'
  const { rows } = await client.query(
    `SELECT date_trunc('${bucket}', issued_at) AS bucket,
            COUNT(*)::int AS receipts,
            COALESCE(SUM(subtotal_cents), 0)::bigint AS base_cents,
            COALESCE(SUM(tax_cents), 0)::bigint AS tax_cents,
            COALESCE(SUM(total_cents), 0)::bigint AS total_cents
       FROM ${SCHEMA}.receipts
      WHERE issued_at >= $1 AND issued_at <= $2
        AND status <> 'voided' AND converted_from_receipt_id IS NULL
      GROUP BY 1 ORDER BY 1`,
    [from, to],
  )
  return rows.map((r) => ({
    bucket: r.bucket,
    receipts: r.receipts,
    baseCents: Number(r.base_cents),
    taxCents: Number(r.tax_cents),
    totalCents: Number(r.total_cents),
  }))
}

export async function creditNotesByPeriod(client, { from, to }) {
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS count, COALESCE(SUM(amount_cents), 0)::bigint AS total_cents
       FROM ${SCHEMA}.credit_notes
      WHERE issued_at >= $1 AND issued_at <= $2 AND status = 'authorized'`,
    [from, to],
  )
  return { count: rows[0].count, totalCents: Number(rows[0].total_cents) }
}

// Filas para el export CSV contable: un recibo por línea con IVA desglosado.
export async function exportRows(client, { from, to }) {
  const { rows } = await client.query(
    `SELECT r.num_serie, r.type, r.status, r.issued_at, r.currency,
            r.subtotal_cents, r.tax_cents, r.total_cents, r.tax_breakdown,
            r.receptor_nif, r.receptor_name, r.bill_id,
            'receipt' AS doc_kind
       FROM ${SCHEMA}.receipts r
      WHERE r.issued_at >= $1 AND r.issued_at <= $2
      UNION ALL
     SELECT n.num_serie, 'credit_note', n.status, n.issued_at,
            'EUR', NULL, NULL, -n.amount_cents, NULL, NULL, NULL, NULL, 'credit_note'
       FROM ${SCHEMA}.credit_notes n
      WHERE n.issued_at >= $1 AND n.issued_at <= $2 AND n.status = 'authorized'
      ORDER BY 4`,
    [from, to],
  )
  return rows
}
