import { useEffect, useState } from 'react'
import { useApp } from '../../../shell/lib/context'
import { api } from '../../../shell/lib/api'
import { adaptUser } from '../../../shell/lib/adapters'
import { relTime } from '../../../shell/lib/utils'
import { icons } from '../../../shell/lib/icons'
import { RoleBadge, TwoFABadge, Avatar } from '../../../shell/lib/ui'

function RoleChangeModal({ user, onDone }) {
  const { closeModal, toast } = useApp()
  const [role, setRole]   = useState(user.role === 'OWNER' ? 'owner' : 'admin')
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState(null)

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      await api.patch(`/api/users/${user.id}/role`, { role })
      toast('Rol actualizado')
      onDone?.()
      closeModal()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="p-6 border-b border-line">
        <div className="flex items-center justify-between">
          <div className="font-display text-[22px]">Cambiar rol de {user.name}</div>
          <button onClick={closeModal} className="text-ink3 hover:text-ink">{icons.close}</button>
        </div>
      </div>
      <form className="p-6 space-y-4" onSubmit={submit}>
        <div>
          <div className="label mb-1.5">Rol actual</div>
          <RoleBadge role={user.role} />
        </div>
        <div>
          <div className="label mb-1.5">Nuevo rol</div>
          <select className="select" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="admin">admin</option>
            <option value="owner">owner</option>
            <option value="user">user</option>
          </select>
        </div>
        {error && <div className="bg-dangerbg border border-line rounded-lg p-3 text-[12.5px] text-danger">{error}</div>}
        <div className="flex items-center justify-end gap-2 pt-2">
          <button type="button" onClick={closeModal} className="btn btn-ghost">Cancelar</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </form>
    </>
  )
}

function RevokeModal({ user, onDone }) {
  const { closeModal, toast, myTenant } = useApp()
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState(null)

  async function doRevoke() {
    setBusy(true); setError(null)
    try {
      await api.delete(`/api/users/${user.id}`)
      toast(`${user.name} ha perdido acceso al tenant`, 'warn')
      onDone?.()
      closeModal()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="p-6 border-b border-line">
        <div className="flex items-center justify-between">
          <div className="font-display text-[22px] text-danger">Revocar acceso a {user.name}</div>
          <button onClick={closeModal} className="text-ink3 hover:text-ink">{icons.close}</button>
        </div>
      </div>
      <div className="p-6 space-y-4">
        <div className="text-[13.5px] text-ink2">
          La persona perderá acceso al tenant <strong>{myTenant?.display_name}</strong> de inmediato.
        </div>
        {error && <div className="bg-dangerbg border border-line rounded-lg p-3 text-[12.5px] text-danger">{error}</div>}
        <div className="flex items-center justify-end gap-2 pt-2">
          <button onClick={closeModal} className="btn btn-ghost">Cancelar</button>
          <button onClick={doRevoke} className="btn btn-danger" disabled={busy}>{busy ? 'Revocando…' : 'Revocar acceso'}</button>
        </div>
      </div>
    </>
  )
}

export default function TenantAdmins() {
  const { role, identity, openModal, myTenant, toast } = useApp()
  const isOwner = role === 'owner'
  const [admins, setAdmins] = useState([])
  const [loading, setLoading] = useState(true)
  const [refresh, setRefresh] = useState(0)
  const refreshFn = () => setRefresh((k) => k + 1)

  useEffect(() => {
    if (!identity?.tenantId) return
    setLoading(true)
    api.get(`/api/users/?appId=${identity.appId}&tenantId=${identity.tenantId}`)
      .then((l) => setAdmins(l.map(adaptUser)))
      .catch(() => setAdmins([]))
      .finally(() => setLoading(false))
  }, [identity, refresh])

  if (loading) return <div className="p-10 text-center text-ink3">Cargando…</div>

  const tenantName = myTenant?.display_name ?? '—'

  return (
    <div className="p-8 max-w-6xl fade-up">
      <div className="flex items-start justify-between gap-6 mb-8">
        <div>
          <div className="text-[12px] uppercase tracking-[0.18em] text-ink3 mb-2">{tenantName}</div>
          <h1 className="font-display text-[44px] leading-none tracking-tight">
            <span className="italic font-normal">Administradores</span>
          </h1>
          <p className="text-ink3 mt-3 max-w-xl">
            {admins.length} personas con acceso{isOwner
              ? ' · como Owner puedes cambiar roles y revocar.'
              : ' · como Admin puedes revocar a otros Admins.'}
          </p>
        </div>
        <button
          onClick={() => toast('Invitaciones disponibles próximamente', 'warn')}
          className="btn btn-primary shrink-0"
        >
          {icons.plus}Invitar administrador
        </button>
      </div>

      <div className="bg-white border border-line rounded-xl shadow-card overflow-hidden mb-6">
        <table className="t">
          <thead>
            <tr><th>Persona</th><th>Rol</th><th>2FA</th><th>Último acceso</th><th className="text-right">Acciones</th></tr>
          </thead>
          <tbody>
            {admins.length === 0 && (
              <tr><td colSpan={5} className="text-center text-ink3 py-6">Sin administradores.</td></tr>
            )}
            {admins.map((a) => {
              const isMe = a.id === identity?.userId
              const isOwnerRow = a.role === 'OWNER'
              const canEdit = !isMe && (isOwner || (role === 'admin' && !isOwnerRow))
              return (
                <tr key={a.id}>
                  <td>
                    <div className="flex items-center gap-3">
                      <Avatar name={a.name} color={a.avatar} />
                      <div>
                        <div className="font-medium flex items-center gap-2">
                          {a.name}
                          {isMe && <span className="badge bg-paper2 text-ink3">Tú</span>}
                        </div>
                        <div className="text-xs text-ink3">{a.email}</div>
                      </div>
                    </div>
                  </td>
                  <td><RoleBadge role={a.role} /></td>
                  <td><TwoFABadge enabled={a.twofa} /></td>
                  <td className="text-[13px] text-ink3">{a.last ? relTime(a.last) : '—'}</td>
                  <td className="text-right">
                    {canEdit ? (
                      <div className="flex items-center justify-end gap-1">
                        {isOwner && <button onClick={() => openModal(<RoleChangeModal user={a} onDone={refreshFn} />)} className="btn btn-ghost btn-sm">Cambiar rol</button>}
                        <button onClick={() => openModal(<RevokeModal user={a} onDone={refreshFn} />)} className="btn btn-ghost btn-sm text-danger">Revocar</button>
                      </div>
                    ) : <span className="text-[12px] text-ink3">—</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="bg-white border border-line rounded-xl shadow-card overflow-hidden">
        <div className="px-5 py-4 border-b border-line">
          <div className="font-display text-[20px]">Invitaciones pendientes</div>
          <div className="text-xs text-ink3 mt-0.5">Próximamente — el flujo de invitaciones está en desarrollo.</div>
        </div>
        <div className="p-10 dotted text-center text-ink3 text-sm">
          Los administradores nuevos por ahora se crean mediante el seed de desarrollo.
        </div>
      </div>
    </div>
  )
}
