// Detalle admin de un usuario. Tres pestañas:
//   1) Perfil — campos aikikan (member_number, grado, dojo, notas)
//      → PATCH /api/aikikan/members/:userId
//   2) Cuenta — rol + revocación
//      → PATCH /api/users/:id/role | DELETE /api/users/:id
//   3) Pagos — historial fees del socio
//      → GET   /api/aikikan/fees/by-user/:userId
//
// La identidad del usuario se carga vía GET /api/users/:id (endpoint
// nuevo de platform/auth). El perfil viene de aikikan-server. Si el row
// de perfil no existe (socio nunca completó), mostramos placeholders.

import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { getIdentity, clearSession } from '../../lib/auth.js'
import { api } from '../../lib/api.js'

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

export default function UserDetail() {
  const identity = getIdentity()
  const navigate = useNavigate()
  const { userId } = useParams()
  const [tab, setTab] = useState('perfil')
  const [user, setUser]       = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  function load() {
    setLoading(true); setError(null)
    Promise.all([
      api('GET', `/api/users/${userId}`),
      api('GET', `/api/aikikan/members/${userId}`).catch((e) => {
        // Si no hay perfil aún (404), devolvemos null para que la UI
        // muestre placeholders en lugar de bloquearse.
        if (String(e.message).toLowerCase().includes('not found')) return null
        throw e
      }),
    ])
      .then(([u, p]) => { setUser(u); setProfile(p) })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(load, [userId])

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
        <div className="admin-header-logo">AIKI<span>KAN</span> · USUARIO</div>
        <div className="admin-header-right">
          <Link to="/consola/usuarios" className="admin-header-logout" style={{ textDecoration: 'none' }}>← Usuarios</Link>
          <span className="admin-header-user">{identity.email} · {identity.role}</span>
          <button className="admin-header-logout" onClick={logout}>Cerrar sesión</button>
        </div>
      </header>

      <main className="admin-main" style={{ maxWidth: 1024 }}>
        {loading && <p className="admin-loading">Cargando usuario…</p>}
        {error   && <p className="admin-error">Error: {error}</p>}

        {!loading && !error && user && (
          <>
            <div style={{ marginBottom: '1.5rem' }}>
              <div className="admin-section-subtitle" style={{ marginBottom: '.3rem' }}>{user.email}</div>
              <h1 className="admin-section-title">
                {user.display_name ?? <em>(sin nombre)</em>}
              </h1>
              <div style={{ display: 'flex', gap: '.5rem', marginTop: '.5rem' }}>
                <span className="admin-status admin-status-inactive">{roleLabel(user.role)}</span>
                {user.revoked_at && <span className="admin-status admin-status-cancelled">Revocado</span>}
                {user.pending_activation && <span className="admin-status admin-status-past_due">Pendiente activación</span>}
              </div>
            </div>

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
              {tab === 'perfil' && (
                <ProfileTab user={user} profile={profile} onSaved={load} />
              )}
              {tab === 'cuenta' && (
                <AccountTab user={user} onChanged={load} />
              )}
              {tab === 'pagos' && (
                <FeesTab userId={userId} />
              )}
            </div>
          </>
        )}
      </main>
    </div>
  )
}

function ProfileTab({ user, profile, onSaved }) {
  const [form, setForm] = useState({
    memberNumber: profile?.member_number ?? '',
    memberSince:  profile?.member_since ? String(profile.member_since).slice(0, 10) : '',
    aikidoGrade:  profile?.aikido_grade ?? '',
    dojoName:     profile?.dojo_name ?? '',
    notes:        profile?.notes ?? '',
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
  const [role, setRole]       = useState(user.role)
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState(null)
  const [notice, setNotice]   = useState(null)
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
