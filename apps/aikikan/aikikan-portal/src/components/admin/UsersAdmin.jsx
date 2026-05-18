// Vista admin: lista de usuarios del tenant aikikan. El admin ve todos
// los usuarios (socios + admins) con el perfil aikido mergeado.
//
// Identidad: platform/auth (`/api/users?appId=&tenantId=&role=`)
// Perfil:    aikikan-server (`/api/aikikan/members`)
//
// Las dos llamadas van en paralelo y se mergean cliente-side por user.id.
// Volúmenes esperados <500 socios — no hace falta paginación todavía.

import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { getIdentity, clearSession } from '../../lib/auth.js'
import { api } from '../../lib/api.js'
import InviteUserModal from './InviteUserModal.jsx'

const APP_ID = 'aikikan'

function roleLabel(role) {
  if (role === 'admin' || role === 'owner') return 'Admin'
  return 'Socio'
}

function statusLabel(u) {
  if (u.revoked_at) return { text: 'Revocado', cls: 'admin-status-cancelled' }
  if (u.pending_activation) return { text: 'Pendiente', cls: 'admin-status-past_due' }
  return { text: 'Activo', cls: 'admin-status-active' }
}

export default function UsersAdmin() {
  const identity = getIdentity()
  const navigate = useNavigate()
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [query, setQuery]     = useState('')
  const [inviteOpen, setInviteOpen] = useState(false)

  function load() {
    setLoading(true); setError(null)
    const q = `appId=${APP_ID}&tenantId=${encodeURIComponent(identity.tenantId)}`
    Promise.all([
      api('GET', `/api/users?${q}&role=user`),
      api('GET', `/api/users?${q}&role=admin,owner`),
      api('GET', '/api/aikikan/members'),
    ])
      .then(([socios, admins, profiles]) => {
        const users = [...(socios ?? []), ...(admins ?? [])]
        const byUser = new Map((profiles ?? []).map((p) => [p.user_id, p]))
        setRows(users.map((u) => ({ ...u, profile: byUser.get(u.id) ?? null })))
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(load, [identity.tenantId])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((u) => {
      const fields = [
        u.email,
        u.display_name,
        u.profile?.dojo_name,
        u.profile?.aikido_grade,
        u.profile?.member_number,
      ]
      return fields.some((f) => (f ?? '').toLowerCase().includes(q))
    })
  }, [rows, query])

  function logout() {
    clearSession()
    navigate('/', { replace: true })
  }

  if (!identity || !['owner', 'admin'].includes(identity.role)) {
    return <div className="admin-error">Acceso restringido a owner/admin.</div>
  }

  return (
    <div className="admin-consola">
      <header className="admin-header">
        <div className="admin-header-logo">AIKI<span>KAN</span> · USUARIOS</div>
        <div className="admin-header-right">
          <Link to="/consola" className="admin-header-logout" style={{ textDecoration: 'none' }}>← Consola</Link>
          <span className="admin-header-user">{identity.email} · {identity.role}</span>
          <button className="admin-header-logout" onClick={logout}>Cerrar sesión</button>
        </div>
      </header>

      <main className="admin-main" style={{ maxWidth: 1280 }}>
        <div className="admin-section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '1.5rem' }}>
          <div>
            <h1 className="admin-section-title">Usuarios</h1>
            <p className="admin-section-subtitle">Socios y admins del tenant aikikan.</p>
          </div>
          <button className="admin-btn admin-btn-primary" onClick={() => setInviteOpen(true)}>
            + Invitar usuario
          </button>
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <input
            type="text"
            className="users-search"
            placeholder="Buscar por email, nombre, dojo, grado…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {loading && <p className="admin-loading">Cargando usuarios…</p>}
        {error   && <p className="admin-error">Error: {error}</p>}

        {!loading && !error && (
          <div className="users-table-wrap">
            <table className="users-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Nombre</th>
                  <th>Rol</th>
                  <th>Dojo</th>
                  <th>Grado</th>
                  <th>Nº socio</th>
                  <th>Estado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => {
                  const st = statusLabel(u)
                  return (
                    <tr key={u.id} className="users-row" onClick={() => navigate(`/consola/usuarios/${u.id}`)}>
                      <td>{u.email}</td>
                      <td>{u.display_name ?? <em className="users-empty">—</em>}</td>
                      <td>{roleLabel(u.role)}</td>
                      <td>{u.profile?.dojo_name ?? <em className="users-empty">—</em>}</td>
                      <td>{u.profile?.aikido_grade ?? <em className="users-empty">—</em>}</td>
                      <td>{u.profile?.member_number ?? <em className="users-empty">—</em>}</td>
                      <td><span className={`admin-status ${st.cls}`}>{st.text}</span></td>
                      <td className="users-row-action">Detalle →</td>
                    </tr>
                  )
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={8} className="users-empty-row">Sin resultados.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {inviteOpen && (
        <InviteUserModal
          tenantId={identity.tenantId}
          onClose={() => setInviteOpen(false)}
          onCreated={() => { setInviteOpen(false); load() }}
        />
      )}
    </div>
  )
}
