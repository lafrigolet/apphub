import { useEffect, useState } from 'react'
import AdminBar from './AdminBar.jsx'
import { listUsuarios, invitarUsuario, cambiarRol, aprobarUsuario, rechazarUsuario, revocarUsuario } from '../../lib/studio.js'

const ROLES = [['user', 'Alumna'], ['staff', 'Staff'], ['admin', 'Admin'], ['owner', 'Owner']]
const ROL_ES = Object.fromEntries(ROLES)
const fdt = (iso) => iso ? new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) : ''

function estadoDe(u) {
  if (u.revoked_at) return { label: 'Revocado', cls: 'bg-red-500/15 text-red-700' }
  if (u.pending_approval) return { label: 'Pendiente aprobación', cls: 'bg-amber-500/15 text-amber-700' }
  if (u.pending_activation || !u.password_hash) return { label: 'Sin activar', cls: 'bg-sky-500/15 text-sky-700' }
  return { label: 'Activo', cls: 'bg-emerald-500/15 text-emerald-700' }
}

export default function UsersAdmin() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ email: '', displayName: '', role: 'user' })
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  function reload() {
    setLoading(true)
    listUsuarios().then(setUsers).catch((e) => setErr(e.message)).finally(() => setLoading(false))
  }
  useEffect(reload, [])

  async function onInvitar(e) {
    e.preventDefault(); setErr('')
    if (!form.email) { setErr('Email obligatorio'); return }
    setBusy(true)
    try { await invitarUsuario(form); setForm({ email: '', displayName: '', role: 'user' }); reload() }
    catch (e2) { setErr(e2.message ?? 'No se pudo invitar') } finally { setBusy(false) }
  }

  async function accion(fn, ...args) {
    setErr('')
    try { await fn(...args); reload() } catch (e) { setErr(e.message) }
  }

  const pendientes = users.filter((u) => u.pending_approval && !u.revoked_at)
  const activos = users.filter((u) => !u.pending_approval)

  return (
    <div className="min-h-screen bg-piedra text-tinta">
      <AdminBar active="usuarios" />
      <div className="max-w-5xl mx-auto px-5 py-10">
        <p className="eyebrow">Backoffice · Comunidad</p>
        <h1 className="display text-4xl sm:text-5xl mt-2 mb-2">Usuarios</h1>
        <p className="text-tinta/60 mb-8">Alumnas y equipo. Invita, aprueba solicitudes, cambia el rol o revoca el acceso.</p>

        {err && <p className="text-sm text-red-700 bg-red-500/10 rounded-lg px-3 py-2 mb-4">{err}</p>}

        {/* Invitar */}
        <form onSubmit={onInvitar} className="card-zen p-6 mb-8 grid sm:grid-cols-4 gap-4">
          <div className="sm:col-span-4"><span className="eyebrow">Invitar a alguien</span></div>
          <input value={form.email} onChange={set('email')} type="email" placeholder="Email*" className="sm:col-span-2 rounded-xl border border-tinta/15 bg-crema px-4 py-2.5 focus:outline-none focus:border-teal-500" />
          <input value={form.displayName} onChange={set('displayName')} placeholder="Nombre" className="rounded-xl border border-tinta/15 bg-crema px-4 py-2.5 focus:outline-none focus:border-teal-500" />
          <select value={form.role} onChange={set('role')} className="rounded-xl border border-tinta/15 bg-crema px-4 py-2.5 focus:outline-none focus:border-teal-500">
            {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <div className="sm:col-span-4 flex justify-end">
            <button type="submit" disabled={busy} className="btn-zen btn-fill">{busy ? 'Invitando…' : 'Enviar invitación'}</button>
          </div>
        </form>

        {loading ? <p className="text-tinta/50">Cargando…</p> : (
          <>
            {/* Pendientes de aprobación */}
            {pendientes.length > 0 && (
              <div className="mb-8">
                <h2 className="display text-2xl mb-3">Solicitudes pendientes</h2>
                <ul className="space-y-2.5">
                  {pendientes.map((u) => (
                    <li key={u.id} className="card-zen p-4 flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <p className="font-semibold truncate">{u.display_name || u.email}</p>
                        <p className="text-sm text-tinta/55 truncate">{u.email} · solicitó {fdt(u.created_at)}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button onClick={() => accion(aprobarUsuario, u.id)} className="text-sm font-semibold text-crema bg-teal-600 hover:bg-teal-700 rounded-full px-3.5 py-1.5">Aprobar</button>
                        <button onClick={() => { if (window.confirm('¿Rechazar la solicitud?')) accion(rechazarUsuario, u.id) }} className="text-sm font-semibold text-red-700 hover:bg-red-500/10 border border-red-500/30 rounded-full px-3.5 py-1.5">Rechazar</button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Activos / resto */}
            <h2 className="display text-2xl mb-3">Todos ({activos.length})</h2>
            <ul className="space-y-2.5">
              {activos.map((u) => {
                const est = estadoDe(u)
                return (
                  <li key={u.id} className={`card-zen p-4 flex items-center justify-between gap-4 ${u.revoked_at ? 'opacity-60' : ''}`}>
                    <div className="min-w-0">
                      <p className="font-semibold truncate">{u.display_name || u.email}</p>
                      <p className="text-sm text-tinta/55 truncate">{u.email} · alta {fdt(u.created_at)}</p>
                    </div>
                    <div className="flex items-center gap-2.5 shrink-0">
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${est.cls}`}>{est.label}</span>
                      <select value={u.role} onChange={(e) => accion(cambiarRol, u.id, e.target.value)} disabled={!!u.revoked_at}
                        className="text-sm rounded-full border border-tinta/15 bg-crema px-3 py-1.5 focus:outline-none focus:border-teal-500 disabled:opacity-50">
                        {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                      {!u.revoked_at && (
                        <button onClick={() => { if (window.confirm('¿Revocar el acceso de este usuario?')) accion(revocarUsuario, u.id) }}
                          title="Revocar" className="text-sm font-semibold text-red-700 hover:bg-red-500/10 rounded-full px-3 py-1.5">Revocar</button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}
