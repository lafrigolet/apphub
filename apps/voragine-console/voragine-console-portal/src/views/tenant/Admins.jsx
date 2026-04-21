import { useApp } from '../../context/AppContext'
import { PERSONAS, ADMINS_BY_TENANT, INVITES_BY_TENANT } from '../../data/mock'
import { fmtDate, relTime } from '../../lib/utils'
import { icons } from '../../lib/icons'
import { RoleBadge, TwoFABadge, Avatar } from '../../lib/ui'

function InviteModal() {
  const { closeModal, toast, currentTenant } = useApp()
  const t = currentTenant()
  return (
    <>
      <div className="p-6 border-b border-line">
        <div className="flex items-center justify-between">
          <div className="font-display text-[22px]">Invitar administrador</div>
          <button onClick={closeModal} className="text-ink3 hover:text-ink">{icons.close}</button>
        </div>
      </div>
      <form className="p-6 space-y-4" onSubmit={e => { e.preventDefault(); closeModal(); toast('Invitación enviada') }}>
        <div>
          <div className="label mb-1.5">Email</div>
          <input type="email" className="input" placeholder={`persona@${t.subdomain}.com`} required />
        </div>
        <div>
          <div className="label mb-1.5">Rol</div>
          <select className="select"><option>ADMIN</option></select>
          <div className="text-[11.5px] text-ink3 mt-1.5">El rol OWNER no puede asignarse desde aquí — se gestiona vía transferencia de propiedad.</div>
        </div>
        <div className="bg-paper2 border border-line rounded-lg p-3 text-[12.5px] text-ink2 flex gap-2">
          <span className="text-ink3 mt-0.5">{icons.info}</span>
          <div>La invitación caduca en <strong>7 días</strong>. El invitado recibirá un enlace firmado de un solo uso.</div>
        </div>
        <div className="flex items-center justify-end gap-2 pt-2">
          <button type="button" onClick={closeModal} className="btn btn-ghost">Cancelar</button>
          <button type="submit" className="btn btn-primary">Enviar invitación</button>
        </div>
      </form>
    </>
  )
}

function RoleChangeModal({ name }) {
  const { closeModal, toast } = useApp()
  return (
    <>
      <div className="p-6 border-b border-line">
        <div className="flex items-center justify-between">
          <div className="font-display text-[22px]">Cambiar rol de {name}</div>
          <button onClick={closeModal} className="text-ink3 hover:text-ink">{icons.close}</button>
        </div>
      </div>
      <form className="p-6 space-y-4" onSubmit={e => { e.preventDefault(); closeModal(); toast('Rol actualizado') }}>
        <div>
          <div className="label mb-1.5">Rol actual</div>
          <RoleBadge role="ADMIN" />
        </div>
        <div>
          <div className="label mb-1.5">Nuevo rol</div>
          <select className="select"><option>ADMIN</option></select>
          <div className="text-[11.5px] text-ink3 mt-1.5">Para convertir a esta persona en Owner, usa <strong>Transferir propiedad</strong>.</div>
        </div>
        <div className="flex items-center justify-end gap-2 pt-2">
          <button type="button" onClick={closeModal} className="btn btn-ghost">Cancelar</button>
          <button type="submit" className="btn btn-primary">Guardar</button>
        </div>
      </form>
    </>
  )
}

function RevokeModal({ name }) {
  const { closeModal, toast, currentTenant } = useApp()
  const t = currentTenant()
  return (
    <>
      <div className="p-6 border-b border-line">
        <div className="flex items-center justify-between">
          <div className="font-display text-[22px] text-danger">Revocar acceso a {name}</div>
          <button onClick={closeModal} className="text-ink3 hover:text-ink">{icons.close}</button>
        </div>
      </div>
      <form className="p-6 space-y-4" onSubmit={e => { e.preventDefault(); closeModal(); toast(`${name} ha perdido acceso al tenant`, 'warn') }}>
        <div className="text-[13.5px] text-ink2">
          La persona perderá acceso al tenant <strong>{t.name}</strong> de inmediato. Su cuenta Voragine seguirá existiendo para otros tenants.
        </div>
        <div>
          <div className="label mb-1.5">Motivo (opcional)</div>
          <textarea className="textarea" rows="3" placeholder="Ej: ya no trabaja con nosotros…" />
        </div>
        <div className="flex items-center justify-end gap-2 pt-2">
          <button type="button" onClick={closeModal} className="btn btn-ghost">Cancelar</button>
          <button type="submit" className="btn btn-danger">Revocar acceso</button>
        </div>
      </form>
    </>
  )
}

function mockAdmins(t) {
  return [
    { id: 'o', name: 'Owner del tenant', email: 'owner@' + t.subdomain + '.com', role: 'OWNER', twofa: true,  last: '2026-04-20T12:00:00Z', avatar: '#2F6F4F' },
    { id: 'a', name: 'Admin del tenant', email: 'admin@' + t.subdomain + '.com', role: 'ADMIN', twofa: true,  last: '2026-04-18T10:00:00Z', avatar: '#2C5280' },
  ]
}

export default function TenantAdmins() {
  const { role, openModal, toast, currentTenant } = useApp()
  const t = currentTenant()
  const isOwner = role === 'owner'
  const me = PERSONAS[role]
  const admins = ADMINS_BY_TENANT[t.id] || mockAdmins(t)
  const invites = INVITES_BY_TENANT[t.id] || []

  return (
    <div className="p-8 max-w-6xl fade-up">
      <div className="flex items-start justify-between gap-6 mb-8">
        <div>
          <div className="text-[12px] uppercase tracking-[0.18em] text-ink3 mb-2">{t.name}</div>
          <h1 className="font-display text-[44px] leading-none tracking-tight">
            <span className="italic font-normal">Administradores</span>
          </h1>
          <p className="text-ink3 mt-3 max-w-xl">
            {admins.length} personas con acceso{isOwner
              ? ' · como Owner puedes cambiar roles, revocar y transferir la propiedad.'
              : ' · como Admin puedes invitar y revocar a otros Admins, pero no al Owner.'}
          </p>
        </div>
        <button onClick={() => openModal(<InviteModal />)} className="btn btn-primary shrink-0">
          {icons.plus}Invitar administrador
        </button>
      </div>

      <div className="bg-white border border-line rounded-xl shadow-card overflow-hidden mb-6">
        <table className="t">
          <thead>
            <tr><th>Persona</th><th>Rol</th><th>2FA</th><th>Último acceso</th><th className="text-right">Acciones</th></tr>
          </thead>
          <tbody>
            {admins.map(a => {
              const isMe = a.id === me.id
              const canEdit = (isOwner && !isMe) || (!isOwner && a.role === 'ADMIN' && !isMe)
              const isOwnerRow = a.role === 'OWNER'
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
                  <td className="text-[13px] text-ink3">{relTime(a.last)}</td>
                  <td className="text-right">
                    {isOwnerRow && !isOwner && <span className="text-[12px] text-ink3">No editable</span>}
                    {canEdit && (
                      <div className="flex items-center justify-end gap-1">
                        {isOwner && a.role === 'ADMIN' && (
                          <button onClick={() => openModal(<RoleChangeModal name={a.name} />)} className="btn btn-ghost btn-sm">Cambiar rol</button>
                        )}
                        <button onClick={() => openModal(<RevokeModal name={a.name} />)} className="btn btn-ghost btn-sm text-danger">Revocar</button>
                      </div>
                    )}
                    {isMe && !canEdit && <span className="text-[12px] text-ink3">—</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="bg-white border border-line rounded-xl shadow-card overflow-hidden">
        <div className="px-5 py-4 border-b border-line flex items-center justify-between">
          <div>
            <div className="font-display text-[20px]">Invitaciones pendientes</div>
            <div className="text-xs text-ink3 mt-0.5">
              {invites.length ? `${invites.length} invitaciones en espera` : 'No hay invitaciones pendientes'}
            </div>
          </div>
        </div>
        {invites.length
          ? (
            <table className="t">
              <thead><tr><th>Email</th><th>Rol</th><th>Enviada</th><th>Expira</th><th className="text-right">Acciones</th></tr></thead>
              <tbody>
                {invites.map(i => (
                  <tr key={i.id}>
                    <td className="font-mono text-[13px]">{i.email}</td>
                    <td><RoleBadge role={i.role} /></td>
                    <td className="text-[13px] text-ink3">{fmtDate(i.sent)}</td>
                    <td className="text-[13px] text-ink3">{fmtDate(i.expires)}</td>
                    <td className="text-right">
                      <button onClick={() => toast('Email de invitación reenviado')} className="btn btn-ghost btn-sm">Reenviar</button>
                      <button onClick={() => toast('Invitación cancelada', 'warn')} className="btn btn-ghost btn-sm text-danger">Cancelar</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
          : <div className="p-10 dotted text-center text-ink3 text-sm">Sin invitaciones pendientes. Invita a alguien con el botón superior.</div>
        }
      </div>
    </div>
  )
}
