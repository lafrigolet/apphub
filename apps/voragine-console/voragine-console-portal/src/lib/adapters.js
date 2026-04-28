// Translates platform API responses into the shape the imported portal
// UI originally expected (mock-based). Centralizing the mapping keeps the
// view components untouched from a data-shape perspective.

const ROLE_UP = {
  super_admin: 'SUPER_ADMIN',
  staff:       'STAFF',
  owner:       'OWNER',
  admin:       'ADMIN',
  user:        'USER',
}

export function adaptTenant(db) {
  if (!db) return null
  return {
    id:            db.id,
    app_id:        db.app_id,
    name:          db.display_name,
    legal:         db.legal_name || '',
    cif:           db.cif || '',
    country:       db.country || '',
    plan:          db.plan || 'STARTER',
    status:        (db.status || '').toUpperCase(),
    subdomain:     db.subdomain,
    customDomain:  db.custom_domain,
    stripe:        db.stripe_status || 'DISCONNECTED',
    created:       db.created_at ? db.created_at.slice(0, 10) : '',
    owner:         null,
    subTenants:    false,
    volMonth:      Math.round((db.volume_month_cents ?? 0) / 100),
    txMonth:       db.tx_month ?? 0,
    balance:       Math.round((db.balance_cents ?? 0) / 100),
    suspendReason: db.suspend_reason,
    archivedAt:    db.archived_at ? db.archived_at.slice(0, 10) : undefined,
    contactEmail:  db.contact_email,
    contactPhone:  db.contact_phone,
    address:       db.address,
  }
}

export function adaptUser(db) {
  if (!db) return null
  return {
    id:       db.id,
    name:     db.display_name || db.email,
    email:    db.email,
    role:     ROLE_UP[db.role] ?? (db.role || '').toUpperCase(),
    twofa:    false,
    last:     db.last_login_at,
    avatar:   avatarColorFor(db.email),
    tenantId: db.tenant_id,
    appId:    db.app_id,
  }
}

export function adaptAudit(entry, tenantNameById = {}) {
  if (!entry) return null
  return {
    id:         entry.id,
    ts:         entry.ts,
    actor:      entry.actor_user_id || 'system',
    actorRole:  (entry.actor_role || '').toUpperCase(),
    tenant:     entry.tenant_id,
    tenantName: tenantNameById[entry.tenant_id] ?? entry.tenant_id?.slice(0, 8) ?? '—',
    action:     entry.action,
    detail:     entry.detail,
    ip:         entry.ip,
  }
}

const AVATAR_PALETTE = ['#D9512C', '#2F6F4F', '#2C5280', '#8A6B0A', '#A83E1F', '#8A2C2C']
function avatarColorFor(key) {
  const s = String(key ?? '')
  let h = 0
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0
  return AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length]
}
