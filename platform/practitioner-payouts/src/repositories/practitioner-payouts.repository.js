const SCHEMA = 'platform_practitioner_payouts'

export async function insertCommissionRule(client, appId, tenantId, r) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.commission_rules
       (app_id, tenant_id, practitioner_id, service_id, rate_pct, flat_fee_cents, effective_from, effective_until, metadata)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6,0),COALESCE($7,now()),$8,COALESCE($9,'{}'::jsonb))
     RETURNING *`,
    [appId, tenantId, r.practitionerId, r.serviceId ?? null, r.ratePct,
     r.flatFeeCents ?? 0, r.effectiveFrom ?? null, r.effectiveUntil ?? null, r.metadata ?? {}],
  )
  return rows[0]
}

export async function listCommissionRules(client, appId, tenantId, { practitionerId, serviceId } = {}) {
  const filters = ['app_id = $1', 'tenant_id = $2']
  const params  = [appId, tenantId]
  if (practitionerId) { filters.push(`practitioner_id = $${params.length + 1}`); params.push(practitionerId) }
  if (serviceId)      { filters.push(`(service_id = $${params.length + 1} OR service_id IS NULL)`); params.push(serviceId) }
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.commission_rules WHERE ${filters.join(' AND ')} ORDER BY effective_from DESC`,
    params,
  )
  return rows
}

// Most-specific applicable rule: prefer a (practitioner, service) match over a
// (practitioner, NULL) wildcard. Effective at `at`.
export async function findApplicableRule(client, appId, tenantId, practitionerId, serviceId, at) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.commission_rules
     WHERE app_id=$1 AND tenant_id=$2 AND practitioner_id=$3
       AND (service_id = $4 OR service_id IS NULL)
       AND effective_from <= $5
       AND (effective_until IS NULL OR effective_until > $5)
     ORDER BY (service_id IS NULL) ASC, effective_from DESC
     LIMIT 1`,
    [appId, tenantId, practitionerId, serviceId, at],
  )
  return rows[0] ?? null
}

export async function insertAccrual(client, appId, tenantId, a) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.accruals
       (app_id, tenant_id, practitioner_id, service_id, booking_id,
        gross_cents, commission_cents, status, occurred_at, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,'accrued'),COALESCE($9,now()),COALESCE($10,'{}'::jsonb))
     RETURNING *`,
    [appId, tenantId, a.practitionerId, a.serviceId ?? null, a.bookingId ?? null,
     a.grossCents, a.commissionCents, a.status ?? 'accrued', a.occurredAt ?? null, a.metadata ?? {}],
  )
  return rows[0]
}

export async function listAccruals(client, appId, tenantId, { practitionerId, status, from, to } = {}) {
  const filters = ['app_id = $1', 'tenant_id = $2']
  const params  = [appId, tenantId]
  if (practitionerId) { filters.push(`practitioner_id = $${params.length + 1}`); params.push(practitionerId) }
  if (status)         { filters.push(`status = $${params.length + 1}`);          params.push(status) }
  if (from)           { filters.push(`occurred_at >= $${params.length + 1}`);    params.push(from) }
  if (to)             { filters.push(`occurred_at <  $${params.length + 1}`);    params.push(to) }
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.accruals WHERE ${filters.join(' AND ')} ORDER BY occurred_at DESC`,
    params,
  )
  return rows
}

export async function findAccrualByBooking(client, appId, tenantId, bookingId) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.accruals WHERE app_id=$1 AND tenant_id=$2 AND booking_id=$3 LIMIT 1`,
    [appId, tenantId, bookingId],
  )
  return rows[0] ?? null
}

export async function reverseAccrual(client, appId, tenantId, id) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.accruals SET status='reversed' WHERE app_id=$1 AND tenant_id=$2 AND id=$3 RETURNING *`,
    [appId, tenantId, id],
  )
  return rows[0] ?? null
}

export async function insertPayout(client, appId, tenantId, p) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.payouts
       (app_id, tenant_id, practitioner_id, period_start, period_end, total_commission_cents, currency, status, notes)
     VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,'EUR'),COALESCE($8,'pending'),$9)
     RETURNING *`,
    [appId, tenantId, p.practitionerId, p.periodStart, p.periodEnd,
     p.totalCommissionCents, p.currency ?? 'EUR', p.status ?? 'pending', p.notes ?? null],
  )
  return rows[0]
}

export async function attachAccrualsToPayout(client, appId, tenantId, payoutId, practitionerId, periodStart, periodEnd) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.accruals SET status='paid', payout_id=$3
     WHERE app_id=$1 AND tenant_id=$2 AND practitioner_id=$4 AND status='accrued'
       AND occurred_at >= $5 AND occurred_at < $6
     RETURNING commission_cents`,
    [appId, tenantId, payoutId, practitionerId, periodStart, periodEnd],
  )
  return rows.reduce((s, r) => s + Number(r.commission_cents), 0)
}

export async function setPayoutStatus(client, appId, tenantId, id, status, externalRef) {
  const sets = ['status = $4']
  const params = [appId, tenantId, id, status]
  if (externalRef) { sets.push(`external_ref = $${params.length + 1}`); params.push(externalRef) }
  if (status === 'paid') sets.push('paid_at = now()')
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.payouts SET ${sets.join(', ')} WHERE app_id=$1 AND tenant_id=$2 AND id=$3 RETURNING *`,
    params,
  )
  return rows[0] ?? null
}

export async function findPayoutById(client, appId, tenantId, id) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.payouts WHERE app_id=$1 AND tenant_id=$2 AND id=$3`,
    [appId, tenantId, id],
  )
  return rows[0] ?? null
}

export async function listPayouts(client, appId, tenantId, { practitionerId, status } = {}) {
  const filters = ['app_id = $1', 'tenant_id = $2']
  const params  = [appId, tenantId]
  if (practitionerId) { filters.push(`practitioner_id = $${params.length + 1}`); params.push(practitionerId) }
  if (status)         { filters.push(`status = $${params.length + 1}`);          params.push(status) }
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.payouts WHERE ${filters.join(' AND ')} ORDER BY period_end DESC`,
    params,
  )
  return rows
}
