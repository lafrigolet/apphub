// CRM básico de donantes (rec. #7). Agrega las donaciones pagadas por
// identidad del donante para producir una ficha y una exportación.
//
// Clave de agrupación: COALESCE(donor_nif, donor_email) — un donante con
// NIF se agrupa por NIF; uno sin NIF (invitado) por email. Todas las
// queries van escopadas por (app_id, tenant_id) vía RLS de la tabla
// donations (no añadimos predicado app_id/tenant_id porque la RLS ya lo
// fuerza dentro de withTenantTransaction).

const SCHEMA = 'platform_donations'

// Listado de donantes únicos con totales. Sólo donaciones pagadas.
// Filtros opcionales: search (sobre nombre/email/NIF), fromDate/toDate
// (sobre paid_at).
export async function listUniqueDonors(
  client,
  { search, fromDate, toDate, limit = 200, offset = 0 } = {},
) {
  const conds = [`status = 'paid'`]
  const params = []
  if (search) {
    params.push(`%${search}%`)
    const i = params.length
    conds.push(`(donor_name ILIKE $${i} OR donor_email ILIKE $${i} OR donor_nif ILIKE $${i})`)
  }
  if (fromDate) { params.push(fromDate); conds.push(`paid_at >= $${params.length}`) }
  if (toDate)   { params.push(toDate);   conds.push(`paid_at <= $${params.length}`) }
  params.push(limit, offset)
  const { rows } = await client.query(
    `SELECT
        COALESCE(donor_nif, donor_email)            AS donor_key,
        MAX(donor_nif)                              AS donor_nif,
        MAX(donor_email)                            AS donor_email,
        MAX(donor_name)                             AS donor_name,
        bool_or(donor_user_id IS NOT NULL)          AS registered,
        COUNT(*)::int                               AS donations_count,
        SUM(amount_cents)::bigint                   AS total_cents,
        MIN(paid_at)                                AS first_donation_at,
        MAX(paid_at)                                AS last_donation_at
       FROM ${SCHEMA}.donations
      WHERE ${conds.join(' AND ')}
      GROUP BY COALESCE(donor_nif, donor_email)
      ORDER BY SUM(amount_cents) DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  )
  return rows
}

// Ficha de un donante por su clave (NIF o email). Devuelve el resumen +
// el historial completo de donaciones pagadas.
export async function getDonorByKey(client, donorKey) {
  const { rows: summaryRows } = await client.query(
    `SELECT
        COALESCE(donor_nif, donor_email)            AS donor_key,
        MAX(donor_nif)                              AS donor_nif,
        MAX(donor_email)                            AS donor_email,
        MAX(donor_name)                             AS donor_name,
        bool_or(donor_user_id IS NOT NULL)          AS registered,
        COUNT(*)::int                               AS donations_count,
        SUM(amount_cents)::bigint                   AS total_cents,
        MIN(paid_at)                                AS first_donation_at,
        MAX(paid_at)                                AS last_donation_at
       FROM ${SCHEMA}.donations
      WHERE status = 'paid'
        AND COALESCE(donor_nif, donor_email) = $1
      GROUP BY COALESCE(donor_nif, donor_email)`,
    [donorKey],
  )
  if (!summaryRows[0]) return null

  const { rows: donations } = await client.query(
    `SELECT id, amount_cents, currency, kind, cause_id, paid_at, status,
            stripe_payment_intent_id, subscription_id
       FROM ${SCHEMA}.donations
      WHERE status = 'paid'
        AND COALESCE(donor_nif, donor_email) = $1
      ORDER BY paid_at DESC`,
    [donorKey],
  )
  return { ...summaryRows[0], donations }
}
