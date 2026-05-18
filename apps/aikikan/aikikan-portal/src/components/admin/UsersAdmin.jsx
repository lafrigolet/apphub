// Lista de usuarios del tenant aikikan con tabs en acordeón por fila.
//
// Identidad: platform/auth (`/api/users?appId=&tenantId=&role=`)
// Perfil:    aikikan-server (`/api/aikikan/members`)
// Detalle:   3 tabs inline (Perfil, Cuenta, Pagos) — sin ruta separada.
//
// Las dos llamadas iniciales (identidad + perfil) van en paralelo y se
// mergean por user.id. El historial de pagos se carga lazy cuando el
// admin abre el accordeón en la pestaña Pagos.

import { useEffect, useMemo, useState } from 'react'
import { getIdentity } from '../../lib/auth.js'
import { api } from '../../lib/api.js'
import InviteUserModal from './InviteUserModal.jsx'
import ConfirmModal from '../ConfirmModal.jsx'

const APP_ID = 'aikikan'

const GRADE_LABEL = {
  KYU_6: '6º Kyu', KYU_5: '5º Kyu', KYU_4: '4º Kyu', KYU_3: '3º Kyu',
  KYU_2: '2º Kyu', KYU_1: '1º Kyu',
  DAN_1: 'Shodan (1º Dan)', DAN_2: 'Nidan (2º Dan)', DAN_3: 'Sandan (3º Dan)',
  DAN_4: 'Yondan (4º Dan)', DAN_5: 'Godan (5º Dan)',
}
const GRADE_KEYS = Object.keys(GRADE_LABEL)

function roleLabel(role) {
  if (role === 'admin' || role === 'owner') return 'Admin'
  return 'Socio'
}

function statusBadge(u) {
  if (u.revoked_at) return { text: 'Revocado', cls: 'admin-status-cancelled' }
  if (u.pending_activation) return { text: 'Pendiente', cls: 'admin-status-past_due' }
  return { text: 'Activo', cls: 'admin-status-active' }
}

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })
}
function fmtDateTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' })
}
function fmtMoney(cents, currency = 'eur') {
  if (cents == null) return '—'
  return (cents / 100).toLocaleString('es-ES', {
    style: 'currency',
    currency: (currency || 'eur').toUpperCase(),
  })
}

export default function UsersAdmin() {
  const identity = getIdentity()
  const [rows, setRows]       = useState([])
  const [pendingRows, setPendingRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [query, setQuery]     = useState('')
  const [inviteOpen, setInviteOpen] = useState(false)
  const [expandedId, setExpandedId] = useState(null)
  const [rejecting, setRejecting]   = useState(null)   // userId pendiente de confirmación de rechazo

  function load() {
    setLoading(true); setError(null)
    const q = `appId=${APP_ID}&tenantId=${encodeURIComponent(identity.tenantId)}`
    Promise.all([
      api('GET', `/api/users?${q}&role=user`),
      api('GET', `/api/users?${q}&role=admin,owner`),
      api('GET', '/api/aikikan/members'),
      api('GET', `/api/users?${q}&pending=approval`),
    ])
      .then(([socios, admins, profiles, pending]) => {
        const users = [...(socios ?? []), ...(admins ?? [])]
        const byUser = new Map((profiles ?? []).map((p) => [p.user_id, p]))
        setRows(users.map((u) => ({ ...u, profile: byUser.get(u.id) ?? null })))
        setPendingRows(pending ?? [])
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(load, [identity.tenantId])

  async function approve(userId) {
    try {
      await api('POST', `/api/users/${userId}/approve`)
      load()
    } catch (err) {
      alert(`No se pudo aprobar: ${err.message}`)
    }
  }

  async function reject(userId) {
    try {
      await api('POST', `/api/users/${userId}/reject`, { reason: null })
      load()
    } catch (err) {
      alert(`No se pudo rechazar: ${err.message}`)
    }
  }

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

  if (!identity || !['owner', 'admin'].includes(identity.role)) {
    return <div className="admin-error">Acceso restringido a owner/admin.</div>
  }

  function toggle(userId) {
    setExpandedId((prev) => (prev === userId ? null : userId))
  }

  return (
    <>
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

      {!loading && !error && pendingRows.length > 0 && (
        <div className="admin-card" style={{ marginBottom: '1.5rem', borderColor: 'rgba(197,72,46,.3)' }}>
          <div className="admin-card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Solicitudes pendientes ({pendingRows.length})</span>
            <span style={{ fontSize: '.7rem', color: 'rgba(9,9,8,.5)', textTransform: 'none', letterSpacing: 0 }}>
              Auto-registros esperando tu aprobación
            </span>
          </div>
          <table className="users-table" style={{ marginTop: '.5rem' }}>
            <thead>
              <tr>
                <th>Email</th>
                <th>Nombre</th>
                <th>Solicitada</th>
                <th style={{ width: 200, textAlign: 'right' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {pendingRows.map((p) => (
                <tr key={p.id}>
                  <td>{p.email}</td>
                  <td>{p.display_name ?? <em className="users-empty">—</em>}</td>
                  <td style={{ fontSize: '.85rem', color: 'rgba(9,9,8,.55)' }}>
                    {new Date(p.created_at).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' })}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="admin-btn" onClick={() => approve(p.id)} style={{ background: '#2F6F4F', color: '#fff', borderColor: '#2F6F4F', marginRight: '.4rem' }}>
                      Aprobar
                    </button>
                    <button className="admin-btn" onClick={() => setRejecting(p)} style={{ borderColor: '#8A2C2C', color: '#8A2C2C' }}>
                      Rechazar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !error && (
        <div className="users-table-wrap">
          <table className="users-table">
            <thead>
              <tr>
                <th style={{ width: 28 }}></th>
                <th>Email</th>
                <th>Nombre</th>
                <th>Rol</th>
                <th>Dojo</th>
                <th>Grado</th>
                <th>Nº socio</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => {
                const st = statusBadge(u)
                const open = expandedId === u.id
                return (
                  <UserRow
                    key={u.id}
                    user={u}
                    open={open}
                    roleText={roleLabel(u.role)}
                    status={st}
                    onToggle={() => toggle(u.id)}
                    onChanged={load}
                  />
                )
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="users-empty-row">Sin resultados.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {inviteOpen && (
        <InviteUserModal
          tenantId={identity.tenantId}
          onClose={() => setInviteOpen(false)}
          onCreated={() => { setInviteOpen(false); load() }}
        />
      )}

      {rejecting && (
        <ConfirmModal
          title="Rechazar solicitud"
          message={`¿Rechazar la solicitud de ${rejecting.email}? Se borrará el registro y el email quedará libre — la persona podrá volver a solicitar más adelante.`}
          confirmLabel="Rechazar"
          onConfirm={() => reject(rejecting.id)}
          onClose={() => setRejecting(null)}
        />
      )}
    </>
  )
}

function UserRow({ user, open, roleText, status, onToggle, onChanged }) {
  return (
    <>
      <tr className={`users-row ${open ? 'is-open' : ''}`} onClick={onToggle}>
        <td className="users-chev">{open ? '▾' : '▸'}</td>
        <td>{user.email}</td>
        <td>{user.display_name ?? <em className="users-empty">—</em>}</td>
        <td>{roleText}</td>
        <td>{user.profile?.dojo_name ?? <em className="users-empty">—</em>}</td>
        <td>{user.profile?.aikido_grade ?? <em className="users-empty">—</em>}</td>
        <td>{user.profile?.member_number ?? <em className="users-empty">—</em>}</td>
        <td><span className={`admin-status ${status.cls}`}>{status.text}</span></td>
      </tr>
      {open && (
        <tr className="users-accordion">
          <td colSpan={8}>
            <UserAccordionBody user={user} onChanged={onChanged} />
          </td>
        </tr>
      )}
    </>
  )
}

function UserAccordionBody({ user, onChanged }) {
  const [tab, setTab] = useState('perfil')
  return (
    <div className="user-accordion-inner">
      <div className="user-tabs">
        {['perfil', 'cuenta', 'pagos'].map((t) => (
          <button
            key={t}
            className={`user-tab ${tab === t ? 'active' : ''}`}
            onClick={() => setTab(t)}
          >{t === 'perfil' ? 'Perfil' : t === 'cuenta' ? 'Cuenta' : 'Pagos'}</button>
        ))}
      </div>

      <div className="user-tab-body">
        {tab === 'perfil' && <ProfileTab user={user} onSaved={onChanged} />}
        {tab === 'cuenta' && <AccountTab user={user} onChanged={onChanged} />}
        {tab === 'pagos'  && <FeesTab userId={user.id} />}
      </div>
    </div>
  )
}

function ProfileTab({ user, onSaved }) {
  const p = user.profile
  const [form, setForm] = useState({
    memberNumber: p?.member_number ?? '',
    memberSince:  p?.member_since ? String(p.member_since).slice(0, 10) : '',
    aikidoGrade:  p?.aikido_grade ?? '',
    dojoName:     p?.dojo_name ?? '',
    notes:        p?.notes ?? '',
  })
  const [busy, setBusy]     = useState(false)
  const [error, setError]   = useState(null)
  const [notice, setNotice] = useState(null)

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setError(null); setNotice(null)
    try {
      const body = {}
      if (form.memberNumber) body.memberNumber = form.memberNumber
      if (form.memberSince)  body.memberSince  = form.memberSince
      if (form.aikidoGrade)  body.aikidoGrade  = form.aikidoGrade
      if (form.dojoName)     body.dojoName     = form.dojoName
      if (form.notes)        body.notes        = form.notes
      await api('PATCH', `/api/aikikan/members/${user.id}`, body)
      setNotice('Perfil guardado.')
      onSaved?.()
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  return (
    <form onSubmit={submit} className="admin-card" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div className="user-form-grid">
        <label className="user-field">
          <span className="user-field-label">Número de socio</span>
          <input type="text" maxLength={64} value={form.memberNumber} onChange={(e) => setForm({ ...form, memberNumber: e.target.value })} />
        </label>
        <label className="user-field">
          <span className="user-field-label">Alta como socio</span>
          <input type="date" value={form.memberSince} onChange={(e) => setForm({ ...form, memberSince: e.target.value })} />
        </label>
        <label className="user-field">
          <span className="user-field-label">Grado de aikido</span>
          <select value={form.aikidoGrade} onChange={(e) => setForm({ ...form, aikidoGrade: e.target.value })}>
            <option value="">— sin grado —</option>
            {GRADE_KEYS.map((k) => <option key={k} value={k}>{GRADE_LABEL[k]}</option>)}
          </select>
        </label>
        <label className="user-field">
          <span className="user-field-label">Dojo</span>
          <input type="text" maxLength={128} value={form.dojoName} onChange={(e) => setForm({ ...form, dojoName: e.target.value })} />
        </label>
      </div>
      <label className="user-field">
        <span className="user-field-label">Notas internas</span>
        <textarea rows={4} maxLength={1024} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </label>
      {error  && <p className="admin-error" style={{ padding: '.5rem 0' }}>{error}</p>}
      {notice && <p className="admin-notice admin-notice-success">{notice}</p>}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button type="submit" className="admin-btn admin-btn-primary" disabled={busy}>
          {busy ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>
    </form>
  )
}

function AccountTab({ user, onChanged }) {
  const [role, setRole]                 = useState(user.role)
  const [busy, setBusy]                 = useState(false)
  const [error, setError]               = useState(null)
  const [notice, setNotice]             = useState(null)
  const [confirmRevoke, setConfirmRevoke] = useState(false)

  async function saveRole() {
    if (role === user.role) return
    setBusy(true); setError(null); setNotice(null)
    try {
      await api('PATCH', `/api/users/${user.id}/role`, { role })
      setNotice(`Rol cambiado a ${role === 'admin' ? 'Admin' : 'Socio'}.`)
      onChanged?.()
    } catch (err) { setError(err.message); setRole(user.role) }
    finally { setBusy(false) }
  }

  async function revoke() {
    setBusy(true); setError(null); setNotice(null)
    try {
      await api('DELETE', `/api/users/${user.id}`)
      setNotice('Acceso revocado.')
      setConfirmRevoke(false)
      onChanged?.()
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div className="admin-card">
        <div className="admin-card-title">Identidad</div>
        <dl className="admin-dl">
          <div><dt>Email</dt><dd>{user.email}</dd></div>
          <div><dt>Nombre</dt><dd>{user.display_name ?? <em>—</em>}</dd></div>
          <div><dt>Último login</dt><dd>{fmtDateTime(user.last_login_at)}</dd></div>
          <div><dt>Alta</dt><dd>{fmtDate(user.created_at)}</dd></div>
        </dl>
      </div>

      <div className="admin-card">
        <div className="admin-card-title">Rol</div>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <select value={role} onChange={(e) => setRole(e.target.value)} disabled={busy}>
            <option value="user">Socio</option>
            <option value="admin">Admin</option>
          </select>
          <button className="admin-btn admin-btn-primary" disabled={busy || role === user.role} onClick={saveRole}>
            {busy ? 'Guardando…' : 'Aplicar'}
          </button>
        </div>
      </div>

      <div className="admin-card" style={{ borderColor: 'rgba(138,44,44,.3)' }}>
        <div className="admin-card-title">Zona peligrosa</div>
        {user.revoked_at ? (
          <p className="admin-empty">Este usuario ya está revocado ({fmtDateTime(user.revoked_at)}).</p>
        ) : confirmRevoke ? (
          <>
            <p className="admin-warn">
              Vas a revocar el acceso de <strong>{user.email}</strong>. Esto soft-deletea
              al usuario en platform/auth y dispara la limpieza del perfil aikikan.
              Operación reversible solo por staff de plataforma.
            </p>
            <div style={{ display: 'flex', gap: '.5rem' }}>
              <button className="admin-btn" onClick={() => setConfirmRevoke(false)} disabled={busy}>Cancelar</button>
              <button className="admin-btn" style={{ background: '#8A2C2C', color: '#fff' }} disabled={busy} onClick={revoke}>
                {busy ? 'Revocando…' : 'Confirmar revocación'}
              </button>
            </div>
          </>
        ) : (
          <button className="admin-btn" style={{ borderColor: '#8A2C2C', color: '#8A2C2C' }} onClick={() => setConfirmRevoke(true)}>
            Revocar acceso
          </button>
        )}
      </div>

      {error  && <p className="admin-error">{error}</p>}
      {notice && <p className="admin-notice admin-notice-success">{notice}</p>}
    </div>
  )
}

function FeesTab({ userId }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  useEffect(() => {
    setLoading(true); setError(null)
    api('GET', `/api/aikikan/fees/by-user/${userId}`)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [userId])

  if (loading) return <p className="admin-loading">Cargando pagos…</p>
  if (error)   return <p className="admin-error">Error: {error}</p>

  const payments = data?.payments ?? []
  const sub      = data?.subscription ?? null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div className="admin-card">
        <div className="admin-card-title">Suscripción</div>
        {sub ? (
          <dl className="admin-dl">
            <div><dt>Estado</dt><dd><span className={`admin-status admin-status-${sub.status}`}>{sub.status}</span></dd></div>
            <div><dt>Período actual</dt><dd>{fmtDate(sub.current_period_end)}</dd></div>
            <div><dt>Stripe subscription</dt><dd style={{ fontFamily: 'monospace', fontSize: '.8rem' }}>{sub.stripe_subscription_id ?? '—'}</dd></div>
          </dl>
        ) : (
          <p className="admin-empty">Sin suscripción activa.</p>
        )}
      </div>

      <div className="admin-card">
        <div className="admin-card-title">Historial de pagos</div>
        {payments.length === 0 ? (
          <p className="admin-empty">Sin pagos registrados.</p>
        ) : (
          <table className="users-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Productos</th>
                <th>Importe</th>
                <th>Estado</th>
                <th>Sesión Stripe</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td>{fmtDate(p.paid_at ?? p.created_at)}</td>
                  <td>{(p.product_codes ?? []).join(', ')}</td>
                  <td>{fmtMoney(p.amount_cents, p.currency)}</td>
                  <td><span className={`admin-status admin-status-${p.status === 'paid' ? 'active' : p.status === 'pending' ? 'past_due' : 'cancelled'}`}>{p.status}</span></td>
                  <td style={{ fontFamily: 'monospace', fontSize: '.78rem' }}>{p.stripe_session_id ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
