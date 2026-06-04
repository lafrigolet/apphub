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
        gross_cents, commission_cents, status, type, occurred_at, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,'accrued'),COALESCE($9,'booking_commission'),COALESCE($10,now()),COALESCE($11,'{}'::jsonb))
     RETURNING *`,
    [appId, tenantId, a.practitionerId, a.serviceId ?? null, a.bookingId ?? null,
     a.grossCents, a.commissionCents, a.status ?? 'accrued', a.type ?? 'booking_commission',
     a.occurredAt ?? null, a.metadata ?? {}],
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
    `SELECT * FROM ${SCHEMA}.accruals
     WHERE app_id=$1 AND tenant_id=$2 AND booking_id=$3 AND type='booking_commission'
     LIMIT 1`,
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
  const gross = p.grossCommissionCents ?? p.totalCommissionCents
  const withholdingPct = p.withholdingPct ?? 0
  const withholding = p.withholdingCents ?? 0
  const net = p.netCommissionCents ?? p.totalCommissionCents
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.payouts
       (app_id, tenant_id, practitioner_id, period_start, period_end,
        total_commission_cents, gross_commission_cents, withholding_pct,
        withholding_cents, net_commission_cents, currency, status, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11,'EUR'),COALESCE($12,'pending'),$13)
     RETURNING *`,
    [appId, tenantId, p.practitionerId, p.periodStart, p.periodEnd,
     p.totalCommissionCents, gross, withholdingPct, withholding, net,
     p.currency ?? 'EUR', p.status ?? 'pending', p.notes ?? null],
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

export async function setPayoutStatus(client, appId, tenantId, id, status, externalRef, opts = {}) {
  const sets = ['status = $4']
  const params = [appId, tenantId, id, status]
  if (externalRef) { sets.push(`external_ref = $${params.length + 1}`); params.push(externalRef) }
  if (status === 'paid') sets.push('paid_at = now()')
  const where = ['app_id=$1', 'tenant_id=$2', 'id=$3']
  // Optional optimistic guard: only transition from an expected current status.
  if (opts.expectedStatus) { where.push(`status = $${params.length + 1}`); params.push(opts.expectedStatus) }
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.payouts SET ${sets.join(', ')} WHERE ${where.join(' AND ')} RETURNING *`,
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

export async function findAccrualById(client, appId, tenantId, id) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.accruals WHERE app_id=$1 AND tenant_id=$2 AND id=$3`,
    [appId, tenantId, id],
  )
  return rows[0] ?? null
}

// ── Withholding (IRPF) settings ─────────────────────────────────────────
// Resolve the effective withholding pct for a practitioner: the practitioner
// override row wins over the tenant default (practitioner_id IS NULL). Returns
// 0 when neither is configured.
export async function resolveWithholdingPct(client, appId, tenantId, practitionerId) {
  const { rows } = await client.query(
    `SELECT withholding_pct, practitioner_id FROM ${SCHEMA}.withholding_settings
     WHERE app_id=$1 AND tenant_id=$2
       AND (practitioner_id = $3 OR practitioner_id IS NULL)
     ORDER BY (practitioner_id IS NULL) ASC
     LIMIT 1`,
    [appId, tenantId, practitionerId],
  )
  return rows[0] ? Number(rows[0].withholding_pct) : 0
}

export async function listWithholdingSettings(client, appId, tenantId) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.withholding_settings
     WHERE app_id=$1 AND tenant_id=$2
     ORDER BY (practitioner_id IS NULL) DESC, created_at ASC`,
    [appId, tenantId],
  )
  return rows
}

// Upsert the tenant default (practitionerId null) or a per-practitioner override.
export async function upsertWithholdingSetting(client, appId, tenantId, { practitionerId, withholdingPct, metadata }) {
  const idxPredicate = practitionerId == null
    ? 'WHERE practitioner_id IS NULL'
    : 'WHERE practitioner_id IS NOT NULL'
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.withholding_settings
       (app_id, tenant_id, practitioner_id, withholding_pct, metadata)
     VALUES ($1,$2,$3,$4,COALESCE($5,'{}'::jsonb))
     ON CONFLICT (app_id, tenant_id${practitionerId == null ? '' : ', practitioner_id'}) ${idxPredicate}
     DO UPDATE SET withholding_pct = EXCLUDED.withholding_pct,
                   metadata        = EXCLUDED.metadata,
                   updated_at      = now()
     RETURNING *`,
    [appId, tenantId, practitionerId ?? null, withholdingPct, metadata ?? {}],
  )
  return rows[0]
}

// ── Payout schedules CRUD ───────────────────────────────────────────────
export async function insertSchedule(client, appId, tenantId, s) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.payout_schedules
       (app_id, tenant_id, practitioner_id, period, anchor_day, next_run_at, is_active, metadata)
     VALUES ($1,$2,$3,$4,COALESCE($5,1),$6,COALESCE($7,TRUE),COALESCE($8,'{}'::jsonb))
     RETURNING *`,
    [appId, tenantId, s.practitionerId, s.period, s.anchorDay ?? 1,
     s.nextRunAt, s.isActive ?? true, s.metadata ?? {}],
  )
  return rows[0]
}

export async function listSchedules(client, appId, tenantId, { practitionerId, isActive } = {}) {
  const filters = ['app_id = $1', 'tenant_id = $2']
  const params  = [appId, tenantId]
  if (practitionerId)       { filters.push(`practitioner_id = $${params.length + 1}`); params.push(practitionerId) }
  if (isActive != null)     { filters.push(`is_active = $${params.length + 1}`);       params.push(isActive) }
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.payout_schedules WHERE ${filters.join(' AND ')} ORDER BY next_run_at ASC`,
    params,
  )
  return rows
}

export async function findScheduleById(client, appId, tenantId, id) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.payout_schedules WHERE app_id=$1 AND tenant_id=$2 AND id=$3`,
    [appId, tenantId, id],
  )
  return rows[0] ?? null
}

export async function updateSchedule(client, appId, tenantId, id, patch) {
  const map = {
    period:     'period',
    anchorDay:  'anchor_day',
    nextRunAt:  'next_run_at',
    isActive:   'is_active',
    metadata:   'metadata',
  }
  const sets = []
  const params = [appId, tenantId, id]
  for (const [key, col] of Object.entries(map)) {
    if (patch[key] !== undefined) { sets.push(`${col} = $${params.length + 1}`); params.push(patch[key]) }
  }
  if (!sets.length) return findScheduleById(client, appId, tenantId, id)
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.payout_schedules SET ${sets.join(', ')}
     WHERE app_id=$1 AND tenant_id=$2 AND id=$3 RETURNING *`,
    params,
  )
  return rows[0] ?? null
}

export async function deleteSchedule(client, appId, tenantId, id) {
  const { rows } = await client.query(
    `DELETE FROM ${SCHEMA}.payout_schedules WHERE app_id=$1 AND tenant_id=$2 AND id=$3 RETURNING id`,
    [appId, tenantId, id],
  )
  return rows[0] ?? null
}
