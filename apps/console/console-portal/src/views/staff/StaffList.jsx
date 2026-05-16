import { useEffect, useState } from 'react'
import { useApp } from '../../context/AppContext'
import { api } from '../../lib/api'
import { adaptUser } from '../../lib/adapters'
import { PLATFORM_APP, PLATFORM_TENANT } from '../../lib/auth'
import { relTime } from '../../lib/utils'
import { icons } from '../../lib/icons'
import { RoleBadge, TwoFABadge, Avatar } from '../../lib/ui'

function InviteStaffModal() {
  const { closeModal, toast } = useApp()
  return (
    <>
      <div className="p-6 border-b border-line">
        <div className="flex items-center justify-between">
          <div className="font-display text-[22px]">Invitar miembro del staff</div>
          <button onClick={closeModal} className="text-ink3 hover:text-ink">{icons.close}</button>
        </div>
      </div>
      <form className="p-6 space-y-4" onSubmit={e => { e.preventDefault(); closeModal(); toast('Invitación enviada') }}>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="label mb-1.5">Nombre</div>
            <input className="input" placeholder="Nombre Apellido" required />
          </div>
          <div>
            <div className="label mb-1.5">Email corporativo</div>
            <input type="email" className="input" placeholder="persona@voragine.app" required />
          </div>
          <div className="col-span-2">
            <div className="label mb-1.5">Rol</div>
            <select className="select">
              <option value="STAFF">STAFF — acceso operativo</option>
              <option value="SUPER_ADMIN">SUPER_ADMIN — puede gestionar otros staff</option>
            </select>
          </div>
        </div>
        <div className="bg-paper2 border border-line rounded-lg p-3 text-[12.5px] text-ink2 flex gap-2">
          <span className="text-ink3 mt-0.5">{icons.info}</span>
          <div>El invitado recibirá un enlace de activación válido 72h. Deberá configurar contraseña y activar <strong>2FA</strong> obligatorio antes del primer acceso.</div>
        </div>
        <div className="flex items-center justify-end gap-2 pt-2">
          <button type="button" onClick={closeModal} className="btn btn-ghost">Cancelar</button>
          <button type="submit" className="btn btn-primary">Enviar invitación</button>
        </div>
      </form>
    </>
  )
}

export default function StaffList() {
  const { openModal } = useApp()
  const [staff, setStaff] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get(`/api/users/?appId=${PLATFORM_APP}&tenantId=${PLATFORM_TENANT}&role=staff,super_admin`)
      .then((list) => setStaff(list.map(adaptUser)))
      .catch(() => setStaff([]))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="p-10 text-center text-ink3">Cargando…</div>

  return (
    <div className="p-8 max-w-6xl fade-up">
      <div className="flex items-start justify-between gap-6 mb-8">
        <div>
          <div className="text-[12px] uppercase tracking-[0.18em] text-ink3 mb-2">Plataforma</div>
          <h1 className="font-display text-[44px] leading-none tracking-tight">
            <span className="italic font-normal">Staff</span> interno
          </h1>
          <p className="text-ink3 mt-3 max-w-xl">
            Personas de Hulkstein con acceso al back-office. 2FA obligatorio. Solo Super Admin puede gestionar altas y bajas.
          </p>
        </div>
        <button onClick={() => openModal(<InviteStaffModal />)} className="btn btn-primary shrink-0">
          {icons.plus}Invitar staff
        </button>
      </div>

      <div className="bg-white border border-line rounded-xl shadow-card overflow-hidden">
        <table className="t">
          <thead>
            <tr><th>Persona</th><th>Rol</th><th>2FA</th><th>Último acceso</th><th /></tr>
          </thead>
          <tbody>
            {staff.map(s => (
              <tr key={s.id}>
                <td>
                  <div className="flex items-center gap-3">
                    <Avatar name={s.name} color={s.avatar} />
                    <div>
                      <div className="font-medium">{s.name}</div>
                      <div className="text-xs text-ink3">{s.email}</div>
                    </div>
                  </div>
                </td>
                <td><RoleBadge role={s.role} /></td>
                <td><TwoFABadge enabled={s.twofa} /></td>
                <td className="text-[13px] text-ink3">{relTime(s.last)}</td>
                <td className="text-right"><button className="text-ink3 hover:text-ink p-1">{icons.more}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
