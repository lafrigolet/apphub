export function initials(name) {
  return name.split(' ').filter(Boolean).slice(0, 2).map(s => s[0]).join('').toUpperCase()
}

export function fmtDate(iso, withTime = false) {
  const d = new Date(iso)
  const opts = withTime
    ? { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: 'short', year: 'numeric' }
  return d.toLocaleDateString('es-ES', opts).replace('.', '')
}

export function fmtMoney(n) {
  return '€' + n.toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

export function fmtNumber(n) {
  return n.toLocaleString('es-ES')
}

export function relTime(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'hace ' + s + 's'
  if (s < 3600) return 'hace ' + Math.floor(s / 60) + ' min'
  if (s < 86400) return 'hace ' + Math.floor(s / 3600) + ' h'
  if (s < 86400 * 7) return 'hace ' + Math.floor(s / 86400) + ' d'
  return fmtDate(iso)
}

export function actionLabel(a) {
  const labels = {
    TENANT_CREATED:          'Tenant creado',
    TENANT_UPDATED:          'Tenant actualizado',
    TENANT_SUSPENDED:        'Tenant suspendido',
    TENANT_REACTIVATED:      'Tenant reactivado',
    TENANT_ARCHIVED:         'Tenant archivado',
    TENANT_RESTORED:         'Tenant restaurado',
    INVITE_SENT:             'Invitación enviada',
    INVITE_ACCEPTED:         'Invitación aceptada',
    INVITE_CANCELLED:        'Invitación cancelada',
    ROLE_CHANGED:            'Rol modificado',
    ADMIN_REVOKED:           'Admin revocado',
    OWNERSHIP_TRANSFERRED:   'Propiedad transferida',
    EXPORT_REQUESTED:        'Exportación solicitada',
  }
  return labels[a] || a
}

export function actionColor(a) {
  if (a.includes('SUSPEND') || a.includes('REVOKED') || a.includes('ARCHIVED')) return '#8A6B0A'
  if (a.includes('CREATED') || a.includes('REACTIVATED') || a.includes('ACCEPTED') || a.includes('RESTORED')) return '#2F6F4F'
  return '#2C5280'
}

export function tenantColor(id) {
  const colors = ['#D9512C', '#2F6F4F', '#2C5280', '#8A6B0A', '#8A2C2C', '#A83E1F', '#14131A']
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return colors[h % colors.length]
}
