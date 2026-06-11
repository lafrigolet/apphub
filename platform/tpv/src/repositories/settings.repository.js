const SCHEMA = 'platform_tpv'

const COLUMNS = `
  id, app_id, tenant_id, sub_tenant_id, issuer_nif, issuer_name, issuer_address,
  issuer_postal_code, issuer_city, issuer_country, auto_issue_simplified,
  cash_out_manager_threshold_cents, session_autoclose_hours, convert_window_days,
  default_simplified_series_code, default_invoice_series_code,
  default_credit_note_series_code, receipt_footer, default_sale_tax_rate,
  created_at, updated_at
`

export const DEFAULTS = {
  issuer_nif: null,
  issuer_name: null,
  issuer_address: null,
  issuer_postal_code: null,
  issuer_city: null,
  issuer_country: 'ES',
  auto_issue_simplified: false,
  cash_out_manager_threshold_cents: 10000,
  session_autoclose_hours: 16,
  convert_window_days: 30,
  default_simplified_series_code: 'A',
  default_invoice_series_code: 'B',
  default_credit_note_series_code: 'R',
  receipt_footer: null,
  default_sale_tax_rate: 21.00,
}

export async function findForTenant(client) {
  // RLS ya acota al tenant de la sesión; a lo sumo hay una fila por
  // (app, tenant, sub_tenant) — la del sub_tenant NULL es la global.
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM ${SCHEMA}.settings
      ORDER BY sub_tenant_id NULLS LAST LIMIT 1`,
  )
  return rows[0] ?? null
}

export async function getOrDefaults(client) {
  const row = await findForTenant(client)
  return row ? { ...DEFAULTS, ...row } : { ...DEFAULTS }
}

// Variante con scope explícito para handlers de eventos que corren bajo
// staff bypass (sin contexto RLS de tenant en la sesión).
export async function getOrDefaultsExplicit(client, appId, tenantId) {
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM ${SCHEMA}.settings
      WHERE app_id = $1 AND tenant_id = $2
      ORDER BY sub_tenant_id NULLS LAST LIMIT 1`,
    [appId, tenantId],
  )
  return rows[0] ? { ...DEFAULTS, ...rows[0] } : { ...DEFAULTS }
}

export async function upsert(client, s) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.settings
       (app_id, tenant_id, sub_tenant_id, issuer_nif, issuer_name, issuer_address,
        issuer_postal_code, issuer_city, issuer_country, auto_issue_simplified,
        cash_out_manager_threshold_cents, session_autoclose_hours, convert_window_days,
        default_simplified_series_code, default_invoice_series_code,
        default_credit_note_series_code, receipt_footer)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, 'ES'), COALESCE($10, FALSE),
             COALESCE($11, 10000), COALESCE($12, 16), COALESCE($13, 30),
             COALESCE($14, 'A'), COALESCE($15, 'B'), COALESCE($16, 'R'), $17)
     ON CONFLICT (app_id, tenant_id, sub_tenant_id) DO UPDATE SET
       issuer_nif                       = COALESCE(EXCLUDED.issuer_nif, ${SCHEMA}.settings.issuer_nif),
       issuer_name                      = COALESCE(EXCLUDED.issuer_name, ${SCHEMA}.settings.issuer_name),
       issuer_address                   = COALESCE(EXCLUDED.issuer_address, ${SCHEMA}.settings.issuer_address),
       issuer_postal_code               = COALESCE(EXCLUDED.issuer_postal_code, ${SCHEMA}.settings.issuer_postal_code),
       issuer_city                      = COALESCE(EXCLUDED.issuer_city, ${SCHEMA}.settings.issuer_city),
       issuer_country                   = COALESCE($9, ${SCHEMA}.settings.issuer_country),
       auto_issue_simplified            = COALESCE($10, ${SCHEMA}.settings.auto_issue_simplified),
       cash_out_manager_threshold_cents = COALESCE($11, ${SCHEMA}.settings.cash_out_manager_threshold_cents),
       session_autoclose_hours          = COALESCE($12, ${SCHEMA}.settings.session_autoclose_hours),
       convert_window_days              = COALESCE($13, ${SCHEMA}.settings.convert_window_days),
       default_simplified_series_code   = COALESCE($14, ${SCHEMA}.settings.default_simplified_series_code),
       default_invoice_series_code      = COALESCE($15, ${SCHEMA}.settings.default_invoice_series_code),
       default_credit_note_series_code  = COALESCE($16, ${SCHEMA}.settings.default_credit_note_series_code),
       receipt_footer                   = COALESCE(EXCLUDED.receipt_footer, ${SCHEMA}.settings.receipt_footer),
       updated_at                       = now()
     RETURNING ${COLUMNS}`,
    [s.appId, s.tenantId, s.subTenantId ?? null, s.issuerNif ?? null, s.issuerName ?? null,
     s.issuerAddress ?? null, s.issuerPostalCode ?? null, s.issuerCity ?? null,
     s.issuerCountry ?? null, s.autoIssueSimplified ?? null,
     s.cashOutManagerThresholdCents ?? null, s.sessionAutocloseHours ?? null,
     s.convertWindowDays ?? null, s.defaultSimplifiedSeriesCode ?? null,
     s.defaultInvoiceSeriesCode ?? null, s.defaultCreditNoteSeriesCode ?? null,
     s.receiptFooter ?? null],
  )
  return rows[0]
}
