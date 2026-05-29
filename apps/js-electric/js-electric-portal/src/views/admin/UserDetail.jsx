import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../../lib/api.js'
import { APP_ROLES, getIdentity } from '../../lib/auth.js'

const STATUS_BADGES = {
  active:           { label: 'Activo',     cls: 'bg-electric-50 text-electric-700 border-electric-200' },
  pending_approval: { label: 'Pendiente',  cls: 'bg-spark-400/15 text-spark-700 border-spark-400/30' },
  revoked:          { label: 'Revocado',   cls: 'bg-red-50 text-red-700 border-red-200' },
}

function deriveStatus(u) {
  if (u.revoked_at) return 'revoked'
  if (u.pending_approval) return 'pending_approval'
  return 'active'
}

export default function UserDetail() {
  const { id } = useParams()
  const identity = getIdentity()
  const [user, setUser]           = useState(null)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState('')
  const [toastMsg, setToastMsg]   = useState('')
  const [busy, setBusy]           = useState(false)

  const [displayName, setDisplayName] = useState('')
  const [role, setRole]               = useState('')
  const [rejectReason, setRejectReason] = useState('')

  function load() {
    setLoading(true)
    api('GET', `/api/users/${id}`)
      .then((j) => {
        const u = j.data ?? j
        setUser(u)
        setDisplayName(u.display_name ?? '')
        setRole(u.role ?? 'user')
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(load, [id])

  function showOk(msg) {
    setToastMsg(msg)
    setTimeout(() => setToastMsg(''), 2500)
  }

  async function run(label, fn) {
    setBusy(true)
    setError('')
    try {
      await fn()
      load()
      showOk(label)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <p className="text-ink-700/60">Cargando…</p>
  if (!user)   return <p className="text-red-700">{error || 'Usuario no encontrado'}</p>

  const status = deriveStatus(user)
  const isSelf = user.id === identity.userId

  return (
    <div>
      <Link to="/admin/users" className="text-sm text-ink-700 hover:text-ink-900 transition">← Volver al listado</Link>

      <div className="grid lg:grid-cols-3 gap-6 mt-4">
        {/* Perfil */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-ink-900/5 shadow-soft p-7">
          <div className="flex items-start justify-between mb-6">
            <div>
              <div className="text-xs uppercase tracking-wider text-ink-700/60 mb-1">Usuario</div>
              <h1 className="font-display text-2xl font-semibold">{user.email}</h1>
              {isSelf && <div className="text-xs text-ink-700/70 mt-1">(es tu propia cuenta)</div>}
            </div>
            <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium border ${STATUS_BADGES[status].cls}`}>{STATUS_BADGES[status].label}</span>
          </div>

          <Field label="Display name">
            <div className="flex items-center gap-3">
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)}
                className="field flex-1 px-3 py-2 rounded-lg border border-ink-900/10 bg-bone/50 text-sm" />
              <button disabled={busy || displayName === (user.display_name ?? '')}
                onClick={() => run('Display name actualizado', () => api('PATCH', `/api/users/${user.id}`, { displayName }))}
                className="px-4 py-2 rounded-lg border border-ink-900/10 text-sm font-medium hover:border-ink-900/30 disabled:opacity-40 disabled:cursor-not-allowed transition">
                Guardar
              </button>
            </div>
          </Field>

          <Field label="Email">{user.email}<span className="text-xs text-ink-700/60 ml-2">(no editable)</span></Field>

          <Field label="Rol">
            {isSelf ? (
              <div className="text-sm text-ink-700">{user.role} <span className="text-xs text-ink-700/60 ml-2">(no puedes cambiar tu propio rol)</span></div>
            ) : (
              <div className="flex items-center gap-3">
                <select value={role} onChange={(e) => setRole(e.target.value)}
                  className="px-3 py-2 rounded-lg border border-ink-900/10 bg-bone/50 text-sm">
                  {APP_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <button disabled={busy || role === user.role}
                  onClick={() => run('Rol actualizado', () => api('PATCH', `/api/users/${user.id}/role`, { role }))}
                  className="px-4 py-2 rounded-lg border border-ink-900/10 text-sm font-medium hover:border-ink-900/30 disabled:opacity-40 disabled:cursor-not-allowed transition">
                  Cambiar rol
                </button>
              </div>
            )}
          </Field>

          {user.revoked_at && (
            <Field label="Revocado">
              <span className="text-red-700">{formatDate(user.revoked_at)}</span>
            </Field>
          )}
          <Field label="Creado">{formatDate(user.created_at)}</Field>
          {user.last_login_at && <Field label="Último login">{formatDate(user.last_login_at)}</Field>}
        </div>

        {/* Acciones */}
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-ink-900/5 shadow-soft p-6">
            <h2 className="font-display font-semibold mb-4">Acciones</h2>

            {error && (
              <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{error}</div>
            )}
            {toastMsg && (
              <div className="text-xs text-electric-700 bg-electric-50 border border-electric-200 rounded-lg px-3 py-2 mb-3">✓ {toastMsg}</div>
            )}

            {status === 'pending_approval' && (
              <>
                <ActionButton primary disabled={busy}
                  onClick={() => run('Usuario aprobado', () => api('POST', `/api/users/${user.id}/approve`))}>
                  Aprobar solicitud
                </ActionButton>
                <div className="my-3">
                  <label className="block text-[10px] uppercase tracking-widest text-ink-700/60 mb-1.5">Motivo del rechazo (opcional)</label>
                  <textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={2}
                    className="field w-full px-3 py-2 rounded-lg border border-ink-900/10 bg-bone/50 text-xs resize-none" />
                </div>
                <ActionButton danger disabled={busy}
                  onClick={() => run('Solicitud rechazada', () => api('POST', `/api/users/${user.id}/reject`, { reason: rejectReason || null }))}>
                  Rechazar solicitud
                </ActionButton>
              </>
            )}

            {status === 'active' && !isSelf && (
              <ActionButton disabled={busy}
                onClick={() => run('Invitación reenviada', () => api('POST', `/api/users/${user.id}/resend-invitation`))}>
                Reenviar invitación
              </ActionButton>
            )}

            {status !== 'revoked' && !isSelf && (
              <ActionButton danger disabled={busy}
                onClick={() => {
                  if (!window.confirm(`¿Seguro que quieres revocar acceso a ${user.email}? El usuario no podrá entrar (soft-delete).`)) return
                  run('Acceso revocado', () => api('DELETE', `/api/users/${user.id}`))
                }}>
                Revocar acceso
              </ActionButton>
            )}

            {isSelf && (
              <p className="text-xs text-ink-700/70">No puedes revocarte ni reenviarte invitación a ti mismo.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div className="mb-5">
      <div className="text-[10px] uppercase tracking-widest text-ink-700/60 mb-1.5">{label}</div>
      <div className="text-sm text-ink-900">{children}</div>
    </div>
  )
}

function ActionButton({ children, onClick, disabled, primary, danger }) {
  const palette = danger
    ? 'bg-red-600 text-white hover:bg-red-700'
    : primary
      ? 'bg-ink-900 text-white hover:bg-ink-800'
      : 'bg-electric-500 text-white hover:bg-electric-600'
  return (
    <button onClick={onClick} disabled={disabled}
      className={`w-full mb-2 inline-flex items-center justify-center gap-2 ${palette} px-4 py-2.5 rounded-full font-medium text-sm shadow-soft disabled:opacity-50 disabled:cursor-not-allowed transition`}>
      {children}
    </button>
  )
}

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
