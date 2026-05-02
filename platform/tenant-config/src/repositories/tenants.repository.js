const FULL_COLUMNS = `
  id, app_id, display_name, subdomain, status,
  legal_name, cif, country, contact_email, contact_phone, address,
  plan, custom_domain, stripe_status, suspend_reason, archived_at,
  volume_month_cents, tx_month, balance_cents,
  default_locale,
  created_at
`

export async function findAll(client, appId) {
  const query = appId
    ? `SELECT ${FULL_COLUMNS}
       FROM platform_tenants.tenants WHERE app_id = $1 ORDER BY created_at`
    : `SELECT ${FULL_COLUMNS}
       FROM platform_tenants.tenants ORDER BY created_at`
  const { rows } = await client.query(query, appId ? [appId] : [])
  return rows
}

export async function findById(client, id) {
  const { rows } = await client.query(
    `SELECT ${FULL_COLUMNS} FROM platform_tenants.tenants WHERE id = $1`,
    [id],
  )
  return rows[0] ?? null
}

export async function findBySubdomain(client, subdomain) {
  const { rows } = await client.query(
    `SELECT ${FULL_COLUMNS} FROM platform_tenants.tenants WHERE subdomain = $1`,
    [subdomain],
  )
  return rows[0] ?? null
}

// Backfill helper: every non-archived tenant. Used on platform-core boot to
// re-publish NGINX server blocks idempotently.
export async function findAllActive(client) {
  const { rows } = await client.query(
    `SELECT ${FULL_COLUMNS} FROM platform_tenants.tenants WHERE status <> 'archived'`,
  )
  return rows
}

export async function create(client, { appId, displayName, subdomain }) {
  const { rows } = await client.query(
    `INSERT INTO platform_tenants.tenants (app_id, display_name, subdomain)
     VALUES ($1, $2, $3)
     RETURNING ${FULL_COLUMNS}`,
    [appId, displayName, subdomain],
  )
  return rows[0]
}

export async function updateStatus(client, id, { status, suspendReason, archivedAt }) {
  const { rows } = await client.query(
    `UPDATE platform_tenants.tenants
     SET status         = $2,
         suspend_reason = CASE WHEN $2 = 'suspended' THEN $3 ELSE NULL END,
         archived_at    = CASE WHEN $2 = 'archived' THEN COALESCE($4, now()) ELSE NULL END
     WHERE id = $1
     RETURNING ${FULL_COLUMNS}`,
    [id, status, suspendReason ?? null, archivedAt ?? null],
  )
  return rows[0] ?? null
}

const ALLOWED_UPDATE_FIELDS = {
  displayName:       'display_name',
  legalName:         'legal_name',
  cif:               'cif',
  country:           'country',
  contactEmail:      'contact_email',
  contactPhone:      'contact_phone',
  address:           'address',
  plan:              'plan',
  customDomain:      'custom_domain',
  stripeStatus:      'stripe_status',
  volumeMonthCents:  'volume_month_cents',
  txMonth:           'tx_month',
  balanceCents:      'balance_cents',
  defaultLocale:     'default_locale',
}

export async function update(client, id, fields) {
  const setters = []
  const values  = []
  let idx = 1
  for (const [key, column] of Object.entries(ALLOWED_UPDATE_FIELDS)) {
    if (fields[key] !== undefined) {
      setters.push(`${column} = $${idx++}`)
      values.push(fields[key])
    }
  }
  if (setters.length === 0) return findById(client, id)
  values.push(id)
  const { rows } = await client.query(
    `UPDATE platform_tenants.tenants SET ${setters.join(', ')}
     WHERE id = $${idx}
     RETURNING ${FULL_COLUMNS}`,
    values,
  )
  return rows[0] ?? null
}
