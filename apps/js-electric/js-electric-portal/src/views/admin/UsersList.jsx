import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../lib/api.js'
import { getIdentity } from '../../lib/auth.js'
import InviteUserModal from '../../components/InviteUserModal.jsx'

const STATUS_KINDS = [
  { id: '',                  label: 'Todos' },
  { id: 'active',            label: 'Activos' },
  { id: 'pending_approval',  label: 'Pendientes' },
  { id: 'revoked',           label: 'Revocados' },
]

const ROLE_FILTERS = [
  { id: '',       label: 'Todos' },
  { id: 'owner',  label: 'Owner' },
  { id: 'admin',  label: 'Admin' },
  { id: 'staff',  label: 'Staff' },
  { id: 'user',   label: 'User' },
]

const STATUS_BADGES = {
  active:           { label: 'Activo',     cls: 'bg-electric-50 text-electric-700 border-electric-200' },
  pending_approval: { label: 'Pendiente',  cls: 'bg-spark-400/15 text-spark-700 border-spark-400/30' },
  revoked:          { label: 'Revocado',   cls: 'bg-red-50 text-red-700 border-red-200' },
}

const ROLE_BADGES = {
  owner: 'bg-ink-900 text-white border-ink-900',
  admin: 'bg-electric-500 text-white border-electric-500',
  staff: 'bg-spark-400 text-ink-900 border-spark-400',
  user:  'bg-ink-900/5 text-ink-700 border-ink-900/10',
}

function deriveStatus(u) {
  if (u.revoked_at) return 'revoked'
  if (u.pending_approval) return 'pending_approval'
  return 'active'
}

export default function UsersList() {
  const identity = getIdentity()
  const [users, setUsers]               = useState([])
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [roleFilter, setRoleFilter]     = useState('')
  const [showInvite, setShowInvite]     = useState(false)

  function refetch() {
    setLoading(true)
    setError('')
    const params = new URLSearchParams({
      appId:    identity.appId,
      tenantId: identity.tenantId,
    })
    api('GET', `/api/users?${params}`)
      .then((j) => setUsers(j.data ?? j ?? []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(refetch, [])

  // Filtro Status + Role client-side (el endpoint solo acepta `role` y
  // `pending=approval`; "Activos vs Revocados" se derivan de columnas).
  const visible = useMemo(() => {
    return users.filter((u) => {
      if (statusFilter && deriveStatus(u) !== statusFilter) return false
      if (roleFilter && u.role !== roleFilter) return false
      return true
    })
  }, [users, statusFilter, roleFilter])

  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="font-display text-3xl font-semibold">Usuarios</h1>
          <p className="text-sm text-ink-700 mt-1">Gestión de cuentas con acceso a la consola admin.</p>
        </div>
        <button onClick={() => setShowInvite(true)}
          className="btn-primary inline-flex items-center justify-center gap-2 bg-ink-900 text-white px-5 py-2.5 rounded-full font-medium text-sm shadow-lift">
          + Invitar usuario
        </button>
      </div>

      <div className="space-y-3 mb-6">
        <FilterRow label="Status">
          {STATUS_KINDS.map((k) => (
            <FilterPill key={k.id} label={k.label} active={statusFilter === k.id} onClick={() => setStatusFilter(k.id)} />
          ))}
        </FilterRow>
        <FilterRow label="Role">
          {ROLE_FILTERS.map((r) => (
            <FilterPill key={r.id} label={r.label} active={roleFilter === r.id} onClick={() => setRoleFilter(r.id)} />
          ))}
        </FilterRow>
      </div>

      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4">{error}</div>
      )}

      <div className="bg-white rounded-2xl border border-ink-900/5 shadow-soft overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-bone/60 text-ink-700/70 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-5 py-3">Email</th>
              <th className="text-left px-5 py-3">Display name</th>
              <th className="text-left px-5 py-3">Role</th>
              <th className="text-left px-5 py-3">Status</th>
              <th className="text-left px-5 py-3">Última acción</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={6} className="px-5 py-12 text-center text-ink-700/60">Cargando…</td></tr>
            )}
            {!loading && visible.length === 0 && (
              <tr><td colSpan={6} className="px-5 py-12 text-center text-ink-700/60">
                Sin usuarios{statusFilter || roleFilter ? ' con esos filtros' : ''}.
              </td></tr>
            )}
            {!loading && visible.map((u) => {
              const isSelf = u.id === identity.userId
              const status = deriveStatus(u)
              const lastAt = u.last_login_at ?? u.updated_at ?? u.created_at
              return (
                <tr key={u.id} className="border-t border-ink-900/5 hover:bg-bone/40">
                  <td className="px-5 py-3 font-medium">
                    {u.email}{isSelf && <span className="ml-2 text-xs text-ink-700/60">(tú)</span>}
                  </td>
                  <td className="px-5 py-3 text-ink-700">{u.display_name ?? '—'}</td>
                  <td className="px-5 py-3">
                    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium border ${ROLE_BADGES[u.role] ?? 'bg-ink-900/5 text-ink-700 border-ink-900/10'}`}>{u.role}</span>
                  </td>
                  <td className="px-5 py-3">
                    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium border ${STATUS_BADGES[status].cls}`}>{STATUS_BADGES[status].label}</span>
                  </td>
                  <td className="px-5 py-3 whitespace-nowrap text-ink-700/80 text-xs">{formatDate(lastAt)}</td>
                  <td className="px-5 py-3 text-right">
                    <Link to={`/admin/users/${u.id}`} className="text-electric-700 font-medium hover:text-electric-900 transition">Ver →</Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="text-sm text-ink-700 mt-3">
        {visible.length > 0 && `${visible.length} ${visible.length === 1 ? 'usuario' : 'usuarios'}${visible.length !== users.length ? ` (filtrado de ${users.length})` : ''}`}
      </div>

      <InviteUserModal open={showInvite} onClose={() => setShowInvite(false)} onCreated={refetch} />
    </div>
  )
}

function FilterRow({ label, children }) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <span className="text-[10px] uppercase tracking-widest text-ink-700/60 font-mono">{label}</span>
      <div className="flex items-center gap-2 flex-wrap">{children}</div>
    </div>
  )
}

function FilterPill({ label, active, onClick }) {
  return (
    <button onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-medium transition border ${active ? 'bg-ink-900 text-white border-ink-900' : 'bg-white text-ink-700 border-ink-900/10 hover:border-ink-900/30'}`}>
      {label}
    </button>
  )
}

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}
